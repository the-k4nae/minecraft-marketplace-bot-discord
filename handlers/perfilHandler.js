/**
 * perfilHandler.js — Handlers dos comandos de perfil (CV2)
 *
 * Responsabilidade: /perfil, /reputacao
 */

import { MessageFlags } from "discord.js"
import {
  getUserAverageRating, getUserRatings, isBlacklisted,
  getUserAnnouncementStats, getLatestUserAnnouncement,
} from "../utils/database.js"
import {
  CV2_EPHEMERAL, container, text, separator, section, thumbnail,
  formatValor, hexColor, COLORS,
} from "../utils/components.js"

export async function handlePerfilCommand(interaction) {
  await interaction.deferReply()

  const targetUser = interaction.options.getUser("usuario") || interaction.user

  const annStats       = getUserAnnouncementStats(targetUser.id)
  const ratingData     = getUserAverageRating(targetUser.id)
  const isUserBanned   = isBlacklisted(targetUser.id)
  const latestAnn      = getLatestUserAnnouncement(targetUser.id)

  let trustLevel = "Novo"; let trustColor = 0x808080
  if (isUserBanned) { trustLevel = "⛔ Bloqueado"; trustColor = COLORS.DANGER }
  else if (annStats.sold >= 10 && parseFloat(ratingData.average) >= 4) { trustLevel = "🏆 Vendedor Premium"; trustColor = COLORS.GOLD }
  else if (annStats.sold >= 5  && parseFloat(ratingData.average) >= 3.5) { trustLevel = "✅ Vendedor Confiável"; trustColor = COLORS.SUCCESS }
  else if (annStats.sold >= 1) { trustLevel = "💰 Vendedor"; trustColor = COLORS.PRIMARY }
  else if (annStats.total >= 1) { trustLevel = "📢 Membro Ativo"; trustColor = COLORS.INFO }

  const starsDisplay = ratingData.count > 0
    ? "★".repeat(Math.round(ratingData.average)) + "☆".repeat(5 - Math.round(ratingData.average)) + ` (${ratingData.average}/5)`
    : "Sem avaliações"

  const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null)
  const joinedAt = member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : "Desconhecido"

  const c = container(trustColor)
  c.addSectionComponents(
    section(
      `## 👤 Perfil de ${targetUser.username}\n**Nível:** ${trustLevel}\n**Membro desde:** ${joinedAt}` +
      (isUserBanned ? "\n\n⚠️ **Este usuário está na blacklist!**" : ""),
      thumbnail(targetUser.displayAvatarURL({ extension: "webp", forceStatic: false, size: 128 }), targetUser.username)
    )
  )
  c.addSeparatorComponents(separator())
  c.addTextDisplayComponents(
    text(
      `📦 **Vendas**\nTotal: **${annStats.total}** · Ativos: **${annStats.active}** · Vendidos: **${annStats.sold}**\nFaturado: **R$ ${formatValor(annStats.totalValue ?? 0)}**\n\n` +
      `⭐ **Reputação**\n${starsDisplay}\n${ratingData.count} avaliação(ões)`
    )
  )

  if (latestAnn) {
    const statusLabels = { pending: "⏳ Pendente", approved: "✅ Ativo", sold: "💰 Vendido", rejected: "❌ Recusado", expired: "⌛ Expirado" }
    c.addSeparatorComponents(separator())
    c.addTextDisplayComponents(
      text(`📌 **Último Anúncio**\n**${latestAnn.nick}** — R$ ${formatValor(latestAnn.valor)} ${statusLabels[latestAnn.status] ?? latestAnn.status}`)
    )
  }

  await interaction.editReply({ components: [c] })
}

export async function handleReputacaoCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {})

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

  const repColor = ratingData.count > 0 ? COLORS.GOLD : 0x808080

  const c = container(repColor)
  c.addSectionComponents(
    section(
      `## ⭐ Reputação de ${targetUser.username}`,
      thumbnail(targetUser.displayAvatarURL({ extension: "webp", forceStatic: false, size: 128 }), targetUser.username)
    )
  )
  c.addSeparatorComponents(separator())
  c.addTextDisplayComponents(
    text(
      ratingData.count > 0
        ? `**Avaliação**\n${starsDisplay}\n${barDisplay}`
        : "Nenhuma avaliação recebida ainda."
    )
  )

  if (ratings.length > 0) {
    const recent = ratings.slice(0, 5)
    let recentText = ""
    for (const r of recent) {
      const stars = "★".repeat(r.stars) + "☆".repeat(5 - r.stars)
      const date  = new Date(r.created_at).toLocaleDateString("pt-BR")
      recentText += `${stars} por <@${r.rater_id}> — ${date}`
      if (r.comment) recentText += `\n> ${r.comment}`
      recentText += "\n\n"
    }
    c.addSeparatorComponents(separator())
    c.addTextDisplayComponents(text(`**Últimas Avaliações**\n${recentText.trim()}`))
  }

  if (interaction.deferred) {
    await interaction.editReply({ flags: CV2_EPHEMERAL, components: [c] })
  } else {
    await interaction.reply({ flags: CV2_EPHEMERAL, components: [c] })
  }
}
