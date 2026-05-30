/**
 * ajuda.js — Comando /ajuda
 *
 * Exibe painel de ajuda com todos os comandos
 */

import { SlashCommandBuilder, MessageFlags } from "discord.js"
import { CV2_EPHEMERAL, container, text, separator, COLORS } from "../utils/components.js"

export const data = new SlashCommandBuilder()
  .setName("ajuda")
  .setDescription("Exibe o painel de ajuda com todos os comandos")

export async function execute(interaction) {
  const c = container(COLORS.PRIMARY)
    .addTextDisplayComponents(text(
      `## 📖 Central de Ajuda\nBem-vindo! Veja abaixo todos os comandos disponíveis.`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### 🎫 Tickets de Suporte\n` +
      `\`/ticket\` — Envie o painel de tickets no canal atual *(admin)*\n` +
      `\`/setuppainel #canal\` — Configura o painel de tickets *(admin)*\n\n` +
      `**Tipos disponíveis:**\n` +
      `• **Suporte** — Dúvidas gerais e problemas\n` +
      `• **Dúvidas** — Perguntas sobre o servidor\n` +
      `• **Denúncia** — Reportar um usuário`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### 📢 Anúncios\n` +
      `\`/setupanuncio #canal\` — Configura o painel de anúncios *(admin)*\n` +
      `Clique em **📢 Anunciar Conta** no painel para vender sua conta\n` +
      `\`/buscar\` — Pesquisar contas (nick, preço, VIP, capa)\n` +
      `\`/meusanuncios\` — Gerenciar seus anúncios\n` +
      `\`/verificarconta <nick>\` — Ver histórico de um nick`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### 🤝 Compras\n` +
      `Clique em **Tenho Interesse** em um anúncio\n` +
      `\`/minhascompras\` — Histórico de compras`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### ⭐ Reputação\n` +
      `\`/perfil [@usuario]\` — Ver perfil completo\n` +
      `\`/reputacao [@usuario]\` — Ver avaliações\n` +
      `\`/ranking\` — Top vendedores`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### 🔔 Alertas\n` +
      `\`/alertas\` — Criar alertas de interesse\n` +
      `\`/meusfavoritos\` — Ver anúncios favoritados\n` +
      `\`/notificar\` — Ativar/desativar notificações de novos anúncios`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `### 📊 Informações\n` +
      `\`/stats\` — Estatísticas do servidor\n` +
      `\`/staff\` — Painel da staff *(staff)*\n\n` +
      `-# Dúvidas? Abra um ticket de suporte`
    ))

  await interaction.reply({ flags: CV2_EPHEMERAL, components: [c] })
}
