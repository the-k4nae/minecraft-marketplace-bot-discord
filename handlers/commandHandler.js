/**
 * commandHandler.js — v5 (Refatorado)
 *
 * Agora contém apenas comandos que não têm handler dedicado:
 * - /verificarconta (Minecraft API)
 * - /ajuda (Help)
 *
 * Os seguintes comandos foram movidos para handlers separados:
 * - /stats → statsHandler.js
 * - /ranking → rankingHandler.js
 * - /perfil, /reputacao → perfilHandler.js
 * - /buscar → buscaHandler.js
 */

import { MessageFlags } from "discord.js"
import { getActiveReservation, getAnnouncementsByNick } from "../utils/database.js"
import { getPlayerUUID, getSkinUrls } from "../utils/minecraftAPI.js"
import { CV2, CV2_EPHEMERAL, container, text, separator, section, thumbnail, COLORS, formatValor } from "../utils/components.js"
import { checkCooldown } from "../utils/cooldown.js"

// ─────────────────────────────────────────────
// /verificarconta
// ─────────────────────────────────────────────

export async function handleVerificarContaCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const nick = interaction.options.getString("nick")

  const cd = checkCooldown(interaction.user.id, "verificarconta", 30_000)
  if (cd.onCooldown) {
    return interaction.editReply({ content: `⏳ Aguarde ${Math.ceil(cd.remaining / 1000)}s antes de usar este comando novamente.` })
  }

  // Validação de input
  if (!nick || nick.length < 3 || nick.length > 16) {
    return interaction.editReply({ content: "❌ Nickname inválido. Use um nickname válido do Minecraft (3-16 caracteres)." })
  }

  const playerData = await getPlayerUUID(nick)
  if (!playerData) {
    return interaction.editReply({ content: `❌ O nickname **"${nick}"** não existe no Minecraft.` })
  }

  const skinUrls = getSkinUrls(playerData.uuid)

  const allAds = getAnnouncementsByNick(playerData.name)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

  const sellers = [...new Set(allAds.map((a) => a.user_id))]

  let body = `**UUID:** ${playerData.uuid}\n**NameMC:** [Ver perfil](https://namemc.com/profile/${playerData.uuid})\n`

  if (allAds.length > 0) {
    body += `\n⚠️ Esta conta foi anunciada **${allAds.length}** vez(es) aqui.\n`

    const statusLabels = { pending: "⏳", approved: "✅", rejected: "❌", sold: "💰", expired: "⌛" }
    const historyText = allAds.slice(0, 8).map((a) =>
      `#${a.id} — R$ ${formatValor(a.valor)} ${statusLabels[a.status] ?? ""} por <@${a.user_id}> — <t:${Math.floor(new Date(a.created_at).getTime() / 1000)}:d>`
    ).join("\n")
    body += `\n**Histórico**\n${historyText}\n`

    const activeAd = allAds.find((a) => a.status === "approved")
    if (activeAd) {
      const reservation = getActiveReservation(activeAd.id)
      if (reservation) {
        body += `\n🔒 **Conta Reservada**\nEsta conta está **reservada** no momento.\nReserva expira: <t:${Math.floor(new Date(reservation.expires_at).getTime() / 1000)}:R>\n`
      }
    }

    if (sellers.length > 1) {
      body += `\n🚨 **Alerta: Múltiplos Vendedores**\nEsta conta foi anunciada por **${sellers.length}** vendedores diferentes! Possível atividade suspeita.\n`
    }
  } else {
    body += `\n✅ Esta conta **nunca** foi anunciada neste servidor.`
  }

  const c = container(allAds.length > 0 ? COLORS.WARNING : COLORS.SUCCESS)
    .addSectionComponents(section(
      `## 🔍 Verificação: ${playerData.name}\n${body}`,
      thumbnail(skinUrls.avatar, playerData.name)
    ))

  await interaction.editReply({ flags: CV2, components: [c] })
}

// ─────────────────────────────────────────────
// /ajuda
// ─────────────────────────────────────────────

export async function handleAjudaCommand(interaction) {
  const c = container(COLORS.PRIMARY)
    .addTextDisplayComponents(text(
      `## 📖 Ajuda — Como usar o sistema\nBem-vindo! Veja abaixo tudo que você pode fazer neste servidor.`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### 🎫 Tickets\n` +
      `\`/ticket\` — Envia o painel de tickets no canal atual *(admin)*\n` +
      `\`/setuppainel #canal\` — Configura o painel de tickets *(admin)*\n\n` +
      `**Tipos de ticket disponíveis:**\n` +
      `• **Suporte** — Dúvidas gerais e problemas\n` +
      `• **Dúvidas** — Perguntas sobre o servidor\n` +
      `• **Denúncia** — Reportar um usuário\n` +
      `• **Anunciar Conta** — Publicar uma conta Minecraft à venda`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### 📢 Anúncios\n` +
      `\`/buscar\` — Pesquisar contas disponíveis (nick, preço, VIP)\n` +
      `\`/meusanuncios\` — Ver e gerenciar seus anúncios ativos\n` +
      `\`/verificarconta <nick>\` — Ver histórico de um nick no servidor`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### 🤝 Compras\n` +
      `Clique em **Tenho Interesse** em qualquer anúncio para iniciar uma negociação.\n` +
      `\`/minhascompras\` — Histórico de contas que você comprou`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### ⭐ Reputação & Perfil\n` +
      `\`/perfil [@usuario]\` — Ver perfil completo\n` +
      `\`/reputacao [@usuario]\` — Ver avaliações de um vendedor\n` +
      `\`/ranking\` — Top vendedores do servidor`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### 🔔 Alertas & Favoritos\n` +
      `\`/alertas\` — Criar alertas para ser notificado quando uma conta aparecer\n` +
      `\`/meufavoritos\` — Ver anúncios que você favoritou\n` +
      `\`/notificar\` — Ativar/desativar notificações`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### 📊 Informações\n` +
      `\`/stats\` — Estatísticas gerais do servidor\n` +
      `\`/staff\` — Painel da staff *(apenas staff)*`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### 🛡️ Segurança\n` +
      `\`/verificarconta\` — Verificar histórico de uma conta`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### 💡 Como vender uma conta?\n` +
      `1. Abra um ticket clicando em **Anunciar Conta** no painel\n` +
      `2. Preencha os dados da conta (nick, valor, etc.)\n` +
      `3. Envie uma **screenshot** da conta\n` +
      `4. Aguarde a aprovação da staff\n` +
      `5. Seu anúncio aparecerá no canal de anúncios!\n\n` +
      `-# Use os comandos com / no chat | Dúvidas? Abra um ticket de suporte`
    ))

  await interaction.reply({ flags: CV2_EPHEMERAL, components: [c] })
}
