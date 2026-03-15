/**
 * commandHandler.js — v5  (Components v2)
 *
 * Todos os embeds migrados para ContainerBuilder.
 * FIX #14: /ranking usa query SQL otimizada + cache em memória (60s)
 * FIX #11: /buscar usa paginação persistente (sobrevive a restarts)
 */

import { MessageFlags } from "discord.js"
import {
  getStats, getUserAverageRating, getUserRatings, isBlacklisted,
  searchAnnouncements, getDatabase, getActiveReservation,
} from "../utils/database.js"
import { formatValor } from "../utils/embedBuilder.js"
import { build, text, section, thumb, C2_FLAG, C2_EPHEMERAL } from "../utils/cv2.js"
import { createPaginatedEmbed, getPaginationState, handlePageButton } from "../utils/pagination.js"
import { getPlayerUUID, getSkinUrls } from "../utils/minecraftAPI.js"

// ─────────────────────────────────────────────
// /stats
// ─────────────────────────────────────────────

export async function handleStatsCommand(interaction) {
  const stats = getStats()

  const maxBar = 10
  const bar = (value, max) => {
    if (!max) return "░".repeat(maxBar)
    const filled = Math.min(Math.round((value / max) * maxBar), maxBar)
    return "█".repeat(filled) + "░".repeat(maxBar - filled)
  }

  const iconUrl = interaction.guild.iconURL({ dynamic: true, size: 256 })
  const content =
    `## 📊 Estatísticas do Servidor\n\n` +
    `Atualizado em <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
    `**🎫 Tickets**\n` +
    `> Total: **${stats.totalTickets}**  Abertos: **${stats.openTickets}** ${bar(stats.openTickets, stats.totalTickets || 1)}  Fechados: **${stats.closedTickets}** ${bar(stats.closedTickets, stats.totalTickets || 1)}\n\n` +
    `**📢 Anúncios**\n` +
    `> Total: **${stats.totalAnnouncements}**  Ativos: **${stats.activeAnnouncements}**  Pendentes: **${stats.pendingAnnouncements}**  Vendidos: **${stats.soldAnnouncements}**\n\n` +
    `**🤝 Negociações**\n` +
    `> Total: **${stats.totalNegotiations}**  Concluídas: **${stats.completedNegotiations}**  Blacklist: **${stats.blacklistedUsers}**\n\n` +
    `-# Solicitado por ${interaction.user.tag}`

  const children = iconUrl ? [section(content, thumb(iconUrl))] : [text(content)]
  await interaction.reply({ components: [build(children, 0x5865F2)], flags: C2_FLAG })
}

// ─────────────────────────────────────────────
// /reputacao
// ─────────────────────────────────────────────

export async function handleReputacaoCommand(interaction) {
  const targetUser = interaction.options.getUser("usuario") || interaction.user
  const ratingData = getUserAverageRating(targetUser.id)
  const ratings    = getUserRatings(targetUser.id)

  let starsDisplay = "Sem avaliações"
  let barDisplay   = ""
  if (ratingData.count > 0) {
    const avg = parseFloat(ratingData.average)
    starsDisplay = "★".repeat(Math.round(avg)) + "☆".repeat(5 - Math.round(avg))
    barDisplay = `${avg.toFixed(1)}/5.0 (${ratingData.count} avaliação(ões))`

    const dist = [0, 0, 0, 0, 0]
    for (const r of ratings) dist[r.stars - 1]++
    barDisplay += "\n\n**Distribuição:**"
    for (let i = 4; i >= 0; i--) {
      const pct = Math.round((dist[i] / ratingData.count) * 10)
      barDisplay += `\n${i + 1}★ ${"█".repeat(pct)}${"░".repeat(10 - pct)} ${dist[i]}`
    }
  }

  let content =
    `## ⭐ Reputação de ${targetUser.tag}\n\n` +
    `**Avaliação:** ${starsDisplay}\n${barDisplay || "Nenhuma avaliação recebida ainda."}`

  if (ratings.length > 0) {
    const recent = ratings.slice(0, 5)
    let reviewText = "\n\n**Últimas Avaliações:**\n"
    for (const r of recent) {
      const stars = "★".repeat(r.stars) + "☆".repeat(5 - r.stars)
      const date  = new Date(r.created_at).toLocaleDateString("pt-BR")
      reviewText += `${stars} por <@${r.rater_id}> — ${date}`
      if (r.comment) reviewText += `\n> ${r.comment}`
      reviewText += "\n"
    }
    content += reviewText
  }

  const avatarUrl = targetUser.displayAvatarURL({ dynamic: true, size: 256 })
  const color = ratingData.count > 0 ? 0xFFD700 : 0x808080
  await interaction.reply({ components: [build([section(content, thumb(avatarUrl))], color)], flags: C2_FLAG })
}

// ─────────────────────────────────────────────
// /buscar — FIX #11: paginação persistente
// ─────────────────────────────────────────────

export async function handleBuscarCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const nick     = interaction.options.getString("nick")
  const minPrice = interaction.options.getNumber("preco_min")
  const maxPrice = interaction.options.getNumber("preco_max")
  const vip      = interaction.options.getString("vip")
  const sort     = interaction.options.getString("ordenar") || "newest"

  let results = searchAnnouncements({ nick, minPrice, maxPrice, tag: vip, status: "approved" })

  if (sort === "cheapest")   results.sort((a, b) => parseFloat(a.valor) - parseFloat(b.valor))
  else if (sort === "expensive") results.sort((a, b) => parseFloat(b.valor) - parseFloat(a.valor))
  else if (sort === "oldest")    results.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  else if (sort === "rating") {
    results.sort((a, b) => {
      const ratingA = getUserAverageRating(a.user_id)?.average ?? 0
      const ratingB = getUserAverageRating(b.user_id)?.average ?? 0
      return ratingB - ratingA
    })
  }

  if (!results.length) return interaction.editReply({ content: "Nenhum anúncio encontrado com esses filtros." })

  const filters = [
    nick      ? `Nick: ${nick}` : null,
    minPrice  ? `Min: R$ ${minPrice}` : null,
    maxPrice  ? `Max: R$ ${maxPrice}` : null,
    vip       ? `VIP: ${vip}` : null,
  ].filter(Boolean)

  const formatItem = (item) => {
    const r = getUserAverageRating(item.user_id)
    const stars = r.count > 0 ? "★".repeat(Math.round(r.average)) + "☆".repeat(5 - Math.round(r.average)) + ` (${r.average})` : "Sem aval."
    return {
      name: `#${item.id} — ${item.nick} | R$ ${formatValor(item.valor)}`,
      value:
        `**VIPs:** ${item.vips || "Nenhum"} · **Capas:** ${item.capas || "Nenhuma"}\n` +
        `**Vendedor:** <@${item.user_id}> ${stars}\n` +
        `**Publicado:** <t:${Math.floor(new Date(item.created_at).getTime() / 1000)}:R>`,
      inline: false,
    }
  }

  const { container, rows } = createPaginatedEmbed({
    items: results,
    itemsPerPage: 5,
    currentPage: 0,
    title: "🔍 Resultados da Busca",
    color: 0x5865F2,
    description: filters.length ? `**Filtros:** ${filters.join(" · ")}` : "Todos os anúncios ativos",
    formatItem,
  })

  await interaction.editReply({ components: [appendRows(container, ...rows)], flags: C2_EPHEMERAL })
}

// ─────────────────────────────────────────────
// /perfil
// ─────────────────────────────────────────────

export async function handlePerfilCommand(interaction) {
  await interaction.deferReply()
  const targetUser = interaction.options.getUser("usuario") || interaction.user
  const db = getDatabase()

  const annStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold,
      SUM(CASE WHEN status = 'sold' THEN CAST(valor AS REAL) ELSE 0 END) as totalValue
    FROM announcements WHERE user_id = ?
  `).get(targetUser.id) ?? { total: 0, active: 0, sold: 0, totalValue: 0 }

  const ratingData   = getUserAverageRating(targetUser.id)
  const isUserBanned = isBlacklisted(targetUser.id)
  const latestAnn    = db.prepare(`SELECT * FROM announcements WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`).get(targetUser.id)

  let trustLevel = "Novo"; let trustColor = 0x808080
  if (isUserBanned)  { trustLevel = "⛔ Bloqueado"; trustColor = 0xFF4444 }
  else if (annStats.sold >= 10 && parseFloat(ratingData.average) >= 4)   { trustLevel = "🏆 Vendedor Premium";  trustColor = 0xFFD700 }
  else if (annStats.sold >= 5  && parseFloat(ratingData.average) >= 3.5) { trustLevel = "✅ Vendedor Confiável"; trustColor = 0x00D166 }
  else if (annStats.sold >= 1)   { trustLevel = "💰 Vendedor";     trustColor = 0x5865F2 }
  else if (annStats.total >= 1)  { trustLevel = "📢 Membro Ativo"; trustColor = 0x7289DA }

  const starsDisplay = ratingData.count > 0
    ? "★".repeat(Math.round(ratingData.average)) + "☆".repeat(5 - Math.round(ratingData.average)) + ` (${ratingData.average}/5)`
    : "Sem avaliações"

  const member   = interaction.guild.members.cache.get(targetUser.id)
  const joinedAt = member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "Desconhecido"

  const statusLabels = { pending: "⏳", approved: "✅", sold: "💰", rejected: "❌", expired: "⌛" }

  let content =
    `## 👤 Perfil de ${targetUser.tag}\n\n` +
    `**Nível:** ${trustLevel}   **Membro desde:** ${joinedAt}\n` +
    (isUserBanned ? "\n⚠️ **Este usuário está na blacklist!**\n" : "") + "\n" +
    `**📦 Vendas** — Total: **${annStats.total}**  Ativos: **${annStats.active}**  Vendidos: **${annStats.sold}**  Faturado: **R$ ${formatValor(annStats.totalValue ?? 0)}**\n\n` +
    `**⭐ Reputação** — ${starsDisplay}  ${ratingData.count} avaliação(ões)\n\n`

  if (latestAnn) {
    content += `**📌 Último Anúncio** — **${latestAnn.nick}** — R$ ${formatValor(latestAnn.valor)} ${statusLabels[latestAnn.status] ?? latestAnn.status}\n\n`
  }
  content += `-# ID: ${targetUser.id}`

  const avatarUrl = targetUser.displayAvatarURL({ dynamic: true, size: 256 })
  await interaction.editReply({ components: [build([section(content, thumb(avatarUrl))], trustColor)], flags: C2_FLAG })
}

// ─────────────────────────────────────────────
// /ranking — FIX #14: SQL query + cache 60s
// ─────────────────────────────────────────────

const rankingCache = new Map()
const RANKING_TTL  = 60_000

function getRankingData(tipo) {
  const cached = rankingCache.get(tipo)
  if (cached && Date.now() < cached.expiry) return cached.data

  const db = getDatabase()
  let rows

  if (tipo === "sales") {
    rows = db.prepare(`
      SELECT a.user_id,
        SUM(CASE WHEN a.status = 'sold' THEN 1 ELSE 0 END) as sales,
        COUNT(*) as total,
        SUM(CASE WHEN a.status = 'sold' THEN CAST(a.valor AS REAL) ELSE 0 END) as totalValue,
        COALESCE(r.average, 0) as rating, COALESCE(r.cnt, 0) as ratingCount
      FROM announcements a
      LEFT JOIN (SELECT rated_id, ROUND(AVG(stars),1) as average, COUNT(*) as cnt FROM ratings GROUP BY rated_id) r ON r.rated_id = a.user_id
      GROUP BY a.user_id ORDER BY sales DESC, totalValue DESC LIMIT 15
    `).all()
  } else if (tipo === "rating") {
    rows = db.prepare(`
      SELECT r.rated_id as user_id, ROUND(AVG(r.stars),1) as rating, COUNT(*) as ratingCount,
        COALESCE(s.sales,0) as sales, COALESCE(s.totalValue,0) as totalValue, COALESCE(s.total,0) as total
      FROM ratings r
      LEFT JOIN (SELECT user_id, SUM(CASE WHEN status='sold' THEN 1 ELSE 0 END) as sales, SUM(CASE WHEN status='sold' THEN CAST(valor AS REAL) ELSE 0 END) as totalValue, COUNT(*) as total FROM announcements GROUP BY user_id) s ON s.user_id = r.rated_id
      GROUP BY r.rated_id HAVING ratingCount >= 1 ORDER BY rating DESC, ratingCount DESC LIMIT 15
    `).all()
  } else {
    rows = db.prepare(`
      SELECT a.user_id, COUNT(*) as total,
        SUM(CASE WHEN a.status='sold' THEN 1 ELSE 0 END) as sales,
        SUM(CASE WHEN a.status='sold' THEN CAST(a.valor AS REAL) ELSE 0 END) as totalValue,
        COALESCE(r.average,0) as rating, COALESCE(r.cnt,0) as ratingCount
      FROM announcements a
      LEFT JOIN (SELECT rated_id, ROUND(AVG(stars),1) as average, COUNT(*) as cnt FROM ratings GROUP BY rated_id) r ON r.rated_id = a.user_id
      GROUP BY a.user_id ORDER BY total DESC, sales DESC LIMIT 15
    `).all()
  }

  rankingCache.set(tipo, { data: rows, expiry: Date.now() + RANKING_TTL })
  return rows
}

export async function handleRankingCommand(interaction) {
  await interaction.deferReply()
  const tipo = interaction.options.getString("tipo") || "sales"
  const rows = getRankingData(tipo)

  if (!rows.length) return interaction.editReply({ content: "Nenhum dado disponível para o ranking." })

  const titles = { sales: "🏆 Ranking — Mais Vendas", rating: "⭐ Ranking — Melhor Avaliação", announcements: "📢 Ranking — Mais Anúncios" }
  const medals = ["🥇", "🥈", "🥉"]

  let description = `## ${titles[tipo] ?? "Ranking"}\n\n`
  for (let i = 0; i < rows.length; i++) {
    const u = rows[i]
    const pos = medals[i] ?? `**${i + 1}.**`
    const ratingText = u.ratingCount > 0
      ? "★".repeat(Math.round(u.rating)) + "☆".repeat(5 - Math.round(u.rating))
      : "N/A"
    if (tipo === "sales")         description += `${pos} <@${u.user_id}> — **${u.sales}** venda(s) · R$ ${formatValor(u.totalValue ?? 0)} · ${ratingText}\n`
    else if (tipo === "rating")   description += `${pos} <@${u.user_id}> — ${ratingText} (${u.rating}) · ${u.ratingCount} aval. · ${u.sales} vendas\n`
    else                          description += `${pos} <@${u.user_id}> — **${u.total}** anúncio(s) · ${u.sales} vendidos · ${ratingText}\n`
  }
  description += `\n-# Cache atualizado a cada 60s`

  const iconUrl = interaction.guild.iconURL({ dynamic: true, size: 256 })
  const children = iconUrl ? [section(description, thumb(iconUrl))] : [text(description)]
  await interaction.editReply({ components: [build(children, 0xFFD700)], flags: C2_FLAG })
}

// ─────────────────────────────────────────────
// /verificarconta
// ─────────────────────────────────────────────

export async function handleVerificarContaCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const nick = interaction.options.getString("nick")

  const playerData = await getPlayerUUID(nick)
  if (!playerData) return interaction.editReply({ content: `❌ O nickname **"${nick}"** não existe no Minecraft.` })

  const skinUrls = getSkinUrls(playerData.uuid)
  const db       = getDatabase()

  const allAds  = db.prepare(`SELECT * FROM announcements WHERE nick = ? COLLATE NOCASE ORDER BY created_at DESC`).all(playerData.name)
  const sellers = [...new Set(allAds.map((a) => a.user_id))]

  let content =
    `## 🔍 Verificação: ${playerData.name}\n\n` +
    `**UUID:** \`${playerData.uuid}\`   **NameMC:** [Ver perfil](https://namemc.com/profile/${playerData.uuid})\n\n`

  const statusLabels = { pending: "⏳", approved: "✅", rejected: "❌", sold: "💰", expired: "⌛" }

  if (allAds.length > 0) {
    content += `⚠️ Esta conta foi anunciada **${allAds.length}** vez(es) aqui.\n\n`
    content += "**Histórico:**\n"
    content += allAds.slice(0, 8).map((a) =>
      `#${a.id} — R$ ${formatValor(a.valor)} ${statusLabels[a.status] ?? ""} por <@${a.user_id}> — <t:${Math.floor(new Date(a.created_at).getTime() / 1000)}:d>`
    ).join("\n")

    const activeAd = allAds.find((a) => a.status === "approved")
    if (activeAd) {
      const reservation = getActiveReservation(activeAd.id)
      if (reservation) {
        content += `\n\n**🔒 Conta Reservada** — Reserva expira: <t:${Math.floor(new Date(reservation.expires_at).getTime() / 1000)}:R>`
      }
    }

    if (sellers.length > 1) {
      content += `\n\n**🚨 Alerta: Múltiplos Vendedores** — Esta conta foi anunciada por **${sellers.length}** vendedores diferentes! Possível atividade suspeita.`
    }
  } else {
    content += "✅ Esta conta **nunca** foi anunciada neste servidor."
  }

  const color = allAds.length > 0 ? 0xFFA500 : 0x00D166
  await interaction.editReply({
    components: [build([section(content, thumb(skinUrls.avatar))], color)],
    flags: C2_EPHEMERAL,
  })
}

// ─────────────────────────────────────────────
// Paginação: handler do botão page_prev/next
// ─────────────────────────────────────────────

export async function handlePaginationButton(interaction, direction, stateId) {
  const state = getPaginationState(stateId)
  if (!state) return interaction.reply({ content: "❌ Sessão expirada. Use o comando novamente.", flags: MessageFlags.Ephemeral })

  const formatItem = (item) => {
    const r = getUserAverageRating(item.user_id)
    const stars = r.count > 0 ? "★".repeat(Math.round(r.average)) + "☆".repeat(5 - Math.round(r.average)) + ` (${r.average})` : "Sem aval."
    return {
      name: `#${item.id} — ${item.nick} | R$ ${formatValor(item.valor)}`,
      value:
        `**VIPs:** ${item.vips || "Nenhum"} · **Capas:** ${item.capas || "Nenhuma"}\n` +
        `**Vendedor:** <@${item.user_id}> ${stars}\n` +
        `**Publicado:** <t:${Math.floor(new Date(item.created_at).getTime() / 1000)}:R>`,
      inline: false,
    }
  }

  await handlePageButton(interaction, direction, stateId, formatItem)
}
