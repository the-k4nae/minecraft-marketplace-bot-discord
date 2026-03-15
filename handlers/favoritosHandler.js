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
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  EmbedBuilder, MessageFlags,
} from "discord.js"
import {
  addFavorite, removeFavorite, isFavorited,
  getUserFavorites, countFavoriters, getAnnouncement,
  addLog,
} from "../utils/database.js"
import { COLORS, formatValor, buildFavoritosPanelC2 } from "../utils/embedBuilder.js"
import { box, C2_FLAG, C2_EPHEMERAL } from "../utils/cv2.js"
import { getSkinUrls } from "../utils/minecraftAPI.js"
import { checkCooldown } from "../utils/cooldown.js"

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
    return interaction.editReply({
      components: [box("## ❤️ Meus Favoritos\n\nVocê não tem nenhum anúncio favoritado.\n\nClique no botão **❤️ Favoritar** em qualquer anúncio para salvar aqui.\n\n-# Use /meufavoritos para ver seus favoritos", 0x7289DA)],
      flags: C2_EPHEMERAL,
    })
  }

  await sendFavoritesPage(interaction, favorites, 0)
}

async function sendFavoritesPage(interaction, favorites, page) {
  const totalPages = Math.ceil(favorites.length / PAGE_SIZE)
  const slice = favorites.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const available = favorites.filter(f => f.status === "approved").length
  const sold      = favorites.filter(f => f.status === "sold").length

  const favLines = slice.map((fav, i) => {
    const emoji  = STATUS_EMOJI[fav.status] ?? "❓"
    const status = STATUS_LABEL[fav.status] ?? fav.status
    const price  = `R$ ${formatValor(fav.valor)}`
    const when   = `<t:${Math.floor(new Date(fav.created_at).getTime() / 1000)}:R>`
    return `**${page * PAGE_SIZE + i + 1}.** ${emoji} **${fav.nick}** — ${price}\n> Status: ${status} · Favoritado ${when}`
  }).join("\n\n")
  const favContent =
    `## ❤️ Meus Favoritos (${favorites.length})\n\n` +
    `🟢 **${available}** disponível(is) · 🔴 **${sold}** vendido(s)\n\n` +
    favLines +
    `\n\n-# Página ${page + 1}/${totalPages} · ${favorites.length} favorito(s) no total`

  const rows = []

  // Botões de detalhes para cada anúncio da página
  if (slice.length) {
    const detailRow = new ActionRowBuilder().addComponents(
      ...slice.map((fav, i) =>
        new ButtonBuilder()
          .setCustomId(`fav_detail_${fav.announcement_id}_${page}`)
          .setLabel(`${page * PAGE_SIZE + i + 1}. ${fav.nick.substring(0, 10)}`)
          .setStyle(fav.status === "approved" ? ButtonStyle.Success : ButtonStyle.Secondary)
          .setDisabled(fav.status !== "approved")
      )
    )
    rows.push(detailRow)
  }

  // Paginação
  if (totalPages > 1) {
    const navRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`fav_page_${page - 1}`)
        .setLabel("◀ Anterior")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`fav_page_${page + 1}`)
        .setLabel("Próxima ▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId("fav_refresh")
        .setLabel("🔄 Atualizar")
        .setStyle(ButtonStyle.Primary),
    )
    rows.push(navRow)
  } else {
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("fav_refresh")
        .setLabel("🔄 Atualizar")
        .setStyle(ButtonStyle.Primary),
    ))
  }

  await interaction.editReply({ components: [appendRows(buildFavoritosPanelC2(interaction.user, favorites), ...rows)], flags: C2_FLAG })
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

  const detailContent =
    `## ❤️ ${announcement.nick}\n\n` +
    `Anúncio **#${announcement.id}** — favoritado por **${favCount}** pessoa(s)\n\n` +
    `💰 **Valor:** R$ ${formatValor(announcement.valor)}   🔨 **Bans:** ${announcement.bans || "Não informado"}\n` +
    `🎭 **Capas:** ${announcement.capas || "Nenhuma"}   ⭐ **VIPs:** ${announcement.vips || "Nenhum"}\n` +
    `🏷️ **Tags:** ${announcement.tags || "Nenhuma"}   🏆 **Cosméticos:** ${announcement.cosmeticos || "Nenhum"}\n\n` +
    `-# Anúncio #${announcement.id}`

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`interest_${announcementId}`)
      .setLabel("🤝 Tenho Interesse")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`fav_toggle_${announcementId}`)
      .setLabel("💔 Desfavoritar")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`fav_page_${page}`)
      .setLabel("↩ Voltar")
      .setStyle(ButtonStyle.Secondary),
  )

  await interaction.editReply({ components: [box(detailContent, 0xFFD700), ...(row ? [row] : [])], flags: C2_EPHEMERAL })
}

// ─────────────────────────────────────────────
// NOTIFICAÇÃO DE BUMP PARA FAVORITADORES
// Chamado pelo scheduler/anuncioHandler quando um anúncio é bumped
// ─────────────────────────────────────────────

export async function notifyFavoritersOnBump(client, announcement) {
  const { getFavoriters } = await import("../utils/database.js")
  const favoriters = getFavoriters(announcement.id)
  if (!favoriters.length) return

  const embed = new EmbedBuilder()
    .setColor(COLORS.GOLD)
    .setTitle("🔔 Anúncio Favoritado Atualizado!")
    .setDescription(
      `O anúncio de **${announcement.nick}** que você favoritou acaba de ser bumped!\n` +
      `Ele está no topo do canal de anúncios agora.`
    )
    .addFields(
      { name: "💰 Valor", value: `R$ ${formatValor(announcement.valor)}`, inline: true },
      { name: "📢 Canal", value: `<#${client.config.channels.anuncios}>`, inline: true },
    )
    .setThumbnail(getSkinUrls(announcement.uuid ?? announcement.nick).avatar)
    .setFooter({ text: "Use /meufavoritos para ver todos os seus favoritos" })
    .setTimestamp()

  let notified = 0
  for (const userId of favoriters) {
    try {
      const user = await client.users.fetch(userId)
      await user.send({ embeds: [embed] })
      notified++
    } catch { /* DM fechada */ }
  }

  if (notified > 0)
    console.log(`[FAVORITOS] ${notified} usuário(s) notificado(s) do bump de #${announcement.id} (${announcement.nick})`)
}

// ─────────────────────────────────────────────
// NOTIFICAÇÃO DE BAIXA DE PREÇO
// Chamado quando o vendedor edita o valor do anúncio para menos
// ─────────────────────────────────────────────

export async function notifyFavoritersOnPriceDrop(client, announcement, oldValor) {
  const { getFavoriters } = await import("../utils/database.js")
  const favoriters = getFavoriters(announcement.id)
  if (!favoriters.length) return

  const oldPrice = Number(oldValor)
  const newPrice = Number(announcement.valor)
  if (newPrice >= oldPrice) return // não é baixa

  const drop = ((oldPrice - newPrice) / oldPrice * 100).toFixed(0)

  const embed = new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle("📉 Baixa de Preço em Anúncio Favoritado!")
    .setDescription(
      `O anúncio de **${announcement.nick}** que você favoritou teve uma **baixa de preço de ${drop}%**!`
    )
    .addFields(
      { name: "Preço Anterior", value: `~~R$ ${formatValor(oldPrice)}~~`, inline: true },
      { name: "Novo Preço",     value: `**R$ ${formatValor(newPrice)}**`,  inline: true },
      { name: "Economia",       value: `R$ ${formatValor(oldPrice - newPrice)} (${drop}% menos)`, inline: true },
      { name: "Canal",          value: `<#${client.config.channels.anuncios}>`, inline: false },
    )
    .setThumbnail(getSkinUrls(announcement.uuid ?? announcement.nick).avatar)
    .setFooter({ text: "Use /meufavoritos para ver todos os seus favoritos" })
    .setTimestamp()

  for (const userId of favoriters) {
    try {
      const user = await client.users.fetch(userId)
      await user.send({ embeds: [embed] })
    } catch { /* DM fechada */ }
  }
}

/**
 * Gera o botão de favoritar para ser incluído nos embeds de anúncio público.
 * @param {number} announcementId
 * @param {string|null} userId - se fornecido, indica se já está favoritado
 */
export function buildFavoriteButton(announcementId, alreadyFaved = false) {
  return new ButtonBuilder()
    .setCustomId(`fav_toggle_${announcementId}`)
    .setLabel(alreadyFaved ? "💔 Desfavoritar" : "❤️ Favoritar")
    .setStyle(alreadyFaved ? ButtonStyle.Danger : ButtonStyle.Secondary)
}
