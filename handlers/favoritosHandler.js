/**
 * favoritosHandler.js
 *
 * Sistema de favoritos para anúncios.
 *
 * Funcionalidades:
 *  - Botão ❤️ / 💔 em cada anúncio público para favoritar/desfavoritar
 *  - Comando /meufavoritos com lista paginada, status atual de cada anúncio
 *  - DM automática quando anúncio favoritado recebe bump ou baixa de preço
 *  - Contador de favoritos visível no embed do anúncio
 */

import {
  ButtonStyle, MessageFlags,
} from "discord.js"
import {
  addFavorite, removeFavorite, isFavorited,
  getUserFavorites, countFavoriters, getAnnouncement,
  addLog, getFavoriters,
} from "../utils/database.js"
import {
  CV2_EPHEMERAL, container, text, separator, section, thumbnail,
  createRow, createButton, formatValor, COLORS,
} from "../utils/components.js"
import { getSkinUrls } from "../utils/minecraftAPI.js"
import { checkCooldown } from "../utils/cooldown.js"
import { fileLog } from "../utils/fileLogger.js"

// ─────────────────────────────────────────────
// BOTÃO FAVORITAR / DESFAVORITAR
// ─────────────────────────────────────────────

export async function handleFavoriteButton(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const announcementId = parseInt(params[0])
  if (isNaN(announcementId))
    return interaction.editReply({ content: "❌ Anúncio inválido." })

  const announcement = getAnnouncement(announcementId)
  if (!announcement)
    return interaction.editReply({ content: "❌ Anúncio não encontrado." })

  if (announcement.user_id === interaction.user.id)
    return interaction.editReply({ content: "❌ Você não pode favoritar seu próprio anúncio." })

  // Cooldown anti-spam
  const cooldown = checkCooldown(interaction.user.id, `fav_${announcementId}`, 3000)
  if (cooldown.onCooldown)
    return interaction.editReply({ content: `⏰ Aguarde ${cooldown.remaining}s.` })

  const alreadyFav = isFavorited(interaction.user.id, announcementId)

  if (alreadyFav) {
    removeFavorite(interaction.user.id, announcementId)
    addLog("favorite_removed", interaction.user.id, String(announcementId))
    const count = countFavoriters(announcementId)
    return interaction.editReply({
      content: `💔 **${announcement.nick}** removido dos seus favoritos.\n\`${count} pessoa(s) favoritaram este anúncio\``,
    })
  } else {
    const added = addFavorite(interaction.user.id, announcementId)
    if (!added)
      return interaction.editReply({ content: "❌ Erro ao favoritar. Tente novamente." })

    addLog("favorite_added", interaction.user.id, String(announcementId))
    const count = countFavoriters(announcementId)

    // ── Notificar vendedor por DM ────────────────────────────────────────
    try {
      const seller = await client.users.fetch(announcement.user_id)
      const dmC = container(0xFF69B4)
        .addTextDisplayComponents(
          text(
            `## ❤️ Alguém favoritou seu anúncio!\n` +
            `Um usuário adicionou sua conta **${announcement.nick}** aos favoritos.\n` +
            `Isso significa que ele tem interesse — fique atento ao canal de anúncios!\n\n` +
            `**Conta:** ${announcement.nick}\n` +
            `**Valor:** R$ ${formatValor(announcement.valor)}\n` +
            `**Total de favoritos:** ${count} pessoa(s)\n\n` +
            `-# Use /meusanuncios para gerenciar seu anúncio`
          )
        )
      await seller.send({ components: [dmC] })
    } catch { /* DM fechada */ }
    // ────────────────────────────────────────────────────────────────────

    return interaction.editReply({
      content: `❤️ **${announcement.nick}** adicionado aos seus favoritos!\nUse \`/meufavoritos\` para ver todos.\n\`${count} pessoa(s) favoritaram este anúncio\``,
    })
  }
}

// ─────────────────────────────────────────────
// /meufavoritos — listagem paginada
// ─────────────────────────────────────────────

const STATUS_EMOJI = {
  approved: "🟢",
  pending:  "🟡",
  sold:     "🔴",
  expired:  "⚫",
  rejected: "❌",
}

const STATUS_LABEL = {
  approved: "Disponível",
  pending:  "Aguardando aprovação",
  sold:     "Vendido",
  expired:  "Expirado",
  rejected: "Rejeitado",
}

const PAGE_SIZE = 5

export async function handleMeusFavoritosCommand(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const favorites = getUserFavorites(interaction.user.id)

  if (!favorites.length) {
    const c = container(COLORS.INFO)
      .addTextDisplayComponents(
        text(
          `## ❤️ Meus Favoritos\nVocê não tem nenhum anúncio favoritado.\n\nClique no botão **❤️ Favoritar** em qualquer anúncio para salvar aqui.\n\n-# Use /meufavoritos para ver seus favoritos`
        )
      )
    return interaction.editReply({ flags: CV2_EPHEMERAL, components: [c] })
  }

  await sendFavoritesPage(interaction, favorites, 0)
}

async function sendFavoritesPage(interaction, favorites, page) {
  const totalPages = Math.ceil(favorites.length / PAGE_SIZE)
  const slice = favorites.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const available = favorites.filter(f => f.status === "approved").length
  const sold      = favorites.filter(f => f.status === "sold").length

  let listText = `🟢 **${available}** disponível(is) · 🔴 **${sold}** vendido(s)\n\n` +
    slice.map((fav, i) => {
      const emoji  = STATUS_EMOJI[fav.status] ?? "❓"
      const status = STATUS_LABEL[fav.status] ?? fav.status
      const price  = `R$ ${formatValor(fav.valor)}`
      const when   = `<t:${Math.floor(new Date(fav.created_at).getTime() / 1000)}:R>`
      return `**${page * PAGE_SIZE + i + 1}.** ${emoji} **${fav.nick}** — ${price}\n> Status: ${status} · Favoritado ${when}`
    }).join("\n\n")

  const c = container(COLORS.GOLD)
  c.addTextDisplayComponents(
    text(`## ❤️ Meus Favoritos (${favorites.length})\n${listText}\n\n-# Página ${page + 1}/${totalPages} · ${favorites.length} favorito(s) no total`)
  )

  // Botões de detalhes para cada anúncio da página
  if (slice.length) {
    c.addActionRowComponents(
      createRow(
        ...slice.map((fav, i) =>
          createButton({
            customId: `fav_detail_${fav.announcement_id}_${page}`,
            label: `${page * PAGE_SIZE + i + 1}. ${fav.nick.substring(0, 10)}`,
            style: fav.status === "approved" ? ButtonStyle.Success : ButtonStyle.Secondary,
            disabled: fav.status !== "approved",
          })
        )
      )
    )
  }

  // Paginação
  const navButtons = []
  if (totalPages > 1) {
    navButtons.push(
      createButton({ customId: `fav_page_${page - 1}`, label: "◀ Anterior", style: ButtonStyle.Secondary, disabled: page === 0 }),
      createButton({ customId: `fav_page_${page + 1}`, label: "Próxima ▶", style: ButtonStyle.Secondary, disabled: page >= totalPages - 1 }),
    )
  }
  navButtons.push(createButton({ customId: "fav_refresh", label: "🔄 Atualizar", style: ButtonStyle.Primary }))
  c.addActionRowComponents(createRow(...navButtons))

  await interaction.editReply({ flags: CV2_EPHEMERAL, components: [c] })
}

// ─────────────────────────────────────────────
// PAGINAÇÃO DE FAVORITOS
// ─────────────────────────────────────────────

export async function handleFavoritesPage(interaction, params, client) {
  await interaction.deferUpdate()
  const page = parseInt(params[0])
  const favorites = getUserFavorites(interaction.user.id)
  if (!favorites.length) return interaction.editReply({ content: "Sem favoritos.", components: [] })
  await sendFavoritesPage(interaction, favorites, Math.max(0, page))
}

export async function handleFavoritesRefresh(interaction, client) {
  await interaction.deferUpdate()
  const favorites = getUserFavorites(interaction.user.id)
  if (!favorites.length)
    return interaction.editReply({ content: "Você não tem mais favoritos.", components: [] })
  await sendFavoritesPage(interaction, favorites, 0)
}

// ─────────────────────────────────────────────
// DETALHE DE UM ANÚNCIO FAVORITADO
// ─────────────────────────────────────────────

export async function handleFavoriteDetail(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const announcementId = parseInt(params[0])
  const page = parseInt(params[1] ?? "0")

  const announcement = getAnnouncement(announcementId)
  if (!announcement || announcement.status !== "approved")
    return interaction.editReply({ content: "❌ Este anúncio não está mais disponível." })

  const skin = getSkinUrls(announcement.uuid ?? announcement.nick)
  const favCount = countFavoriters(announcementId)

  const c = container(COLORS.GOLD)
  c.addSectionComponents(
    section(
      `## ❤️ ${announcement.nick}\nAnúncio **#${announcement.id}** — favoritado por **${favCount}** pessoa(s)`,
      thumbnail(skin.avatar, announcement.nick)
    )
  )
  c.addSeparatorComponents(separator())
  c.addTextDisplayComponents(
    text(
      `💰 **Valor:** R$ ${formatValor(announcement.valor)}\n` +
      `🔨 **Banimentos:** ${announcement.bans || "Não informado"}\n` +
      `🎭 **Capas:** ${announcement.capas || "Nenhuma"}\n` +
      `⭐ **VIPs:** ${announcement.vips || "Nenhum"}\n` +
      `🏷️ **Tags:** ${announcement.tags || "Nenhuma"}\n` +
      `🏆 **Cosméticos:** ${announcement.cosmeticos || "Nenhum"}`
    )
  )
  c.addActionRowComponents(
    createRow(
      createButton({ customId: `interest_${announcementId}`, label: "🤝 Tenho Interesse", style: ButtonStyle.Success }),
      createButton({ customId: `fav_toggle_${announcementId}`, label: "💔 Desfavoritar", style: ButtonStyle.Danger }),
      createButton({ customId: `fav_page_${page}`, label: "↩ Voltar", style: ButtonStyle.Secondary }),
    )
  )

  await interaction.editReply({ flags: CV2_EPHEMERAL, components: [c] })
}

// ─────────────────────────────────────────────
// NOTIFICAÇÃO DE BUMP PARA FAVORITADORES
// Chamado pelo scheduler/anuncioHandler quando um anúncio é bumped
// ─────────────────────────────────────────────

export async function notifyFavoritersOnBump(client, announcement) {
  const favoriters = getFavoriters(announcement.id)
  if (!favoriters.length) return

  const skin = getSkinUrls(announcement.uuid ?? announcement.nick)

  const dmC = container(COLORS.GOLD)
    .addSectionComponents(
      section(
        `## 🔔 Anúncio Favoritado Atualizado!\n` +
        `O anúncio de **${announcement.nick}** que você favoritou acaba de ser bumped!\n` +
        `Ele está no topo do canal de anúncios agora.\n\n` +
        `💰 **Valor:** R$ ${formatValor(announcement.valor)}\n` +
        `📢 **Canal:** <#${client.config.channels.anuncios}>\n\n` +
        `-# Use /meufavoritos para ver todos os seus favoritos`,
        thumbnail(skin.avatar, announcement.nick)
      )
    )

  let notified = 0
  for (const userId of favoriters) {
    try {
      const user = await client.users.fetch(userId)
      await user.send({ components: [dmC] })
      notified++
    } catch { /* DM fechada */ }
  }

  if (notified > 0)
    fileLog.info({ notified, announcementId: announcement.id, nick: announcement.nick }, "[FAVORITOS] bump DMs sent")
}

// ─────────────────────────────────────────────
// NOTIFICAÇÃO DE BAIXA DE PREÇO
// Chamado quando o vendedor edita o valor do anúncio para menos
// ─────────────────────────────────────────────

export async function notifyFavoritersOnPriceDrop(client, announcement, oldValor) {
  const favoriters = getFavoriters(announcement.id)
  if (!favoriters.length) return

  const oldPrice = Number(oldValor)
  const newPrice = Number(announcement.valor)
  if (newPrice >= oldPrice) return // não é baixa

  const drop = ((oldPrice - newPrice) / oldPrice * 100).toFixed(0)
  const skin = getSkinUrls(announcement.uuid ?? announcement.nick)

  const dmC = container(COLORS.SUCCESS)
    .addSectionComponents(
      section(
        `## 📉 Baixa de Preço em Anúncio Favoritado!\n` +
        `O anúncio de **${announcement.nick}** que você favoritou teve uma **baixa de preço de ${drop}%**!\n\n` +
        `~~R$ ${formatValor(oldPrice)}~~ → **R$ ${formatValor(newPrice)}**\n` +
        `Economia: R$ ${formatValor(oldPrice - newPrice)} (${drop}% menos)\n` +
        `📢 **Canal:** <#${client.config.channels.anuncios}>\n\n` +
        `-# Use /meufavoritos para ver todos os seus favoritos`,
        thumbnail(skin.avatar, announcement.nick)
      )
    )

  for (const userId of favoriters) {
    try {
      const user = await client.users.fetch(userId)
      await user.send({ components: [dmC] })
    } catch { /* DM fechada */ }
  }
}

/**
 * Gera o botão de favoritar para ser incluído nos embeds de anúncio público.
 * @param {number} announcementId
 * @param {string|null} userId - se fornecido, indica se já está favoritado
 */
export function buildFavoriteButton(announcementId, alreadyFaved = false) {
  return createButton({
    customId: `fav_toggle_${announcementId}`,
    label: alreadyFaved ? "💔 Desfavoritar" : "❤️ Favoritar",
    style: alreadyFaved ? ButtonStyle.Danger : ButtonStyle.Secondary,
  })
}
