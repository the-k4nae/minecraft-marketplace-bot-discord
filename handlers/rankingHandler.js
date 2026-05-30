/**
 * rankingHandler.js — Handler do comando /ranking (CV2)
 *
 * Responsabilidade: Exibir rankings de vendedores
 * Cache de 60 segundos para performance
 */

import { getRankingBySales, getRankingByRating, getRankingByAnns } from "../utils/database.js"
import {
  CV2_EPHEMERAL, container, text, separator, section, thumbnail,
  formatValor, COLORS,
} from "../utils/components.js"

// Cache em memória: {tipo -> {data, expiry}}
const rankingCache = new Map()
const RANKING_TTL = 60_000 // 60 segundos

function getRankingData(tipo) {
  const cached = rankingCache.get(tipo)
  if (cached && Date.now() < cached.expiry) return cached.data

  let rows
  if (tipo === "sales")       rows = getRankingBySales()
  else if (tipo === "rating") rows = getRankingByRating()
  else                        rows = getRankingByAnns()

  rankingCache.set(tipo, { data: rows, expiry: Date.now() + RANKING_TTL })
  return rows
}

export async function handleRankingCommand(interaction) {
  await interaction.deferReply()

  const tipo = interaction.options.getString("tipo") || "sales"
  const rows = getRankingData(tipo)

  if (!rows || !rows.length) {
    return interaction.editReply({ content: "Nenhum dado disponível para o ranking." })
  }

  const titles = {
    sales: "🏆 Ranking — Mais Vendas",
    rating: "⭐ Ranking — Melhor Avaliação",
    announcements: "📢 Ranking — Mais Anúncios",
  }

  const medals = ["🥇", "🥈", "🥉"]
  let description = ""

  for (let i = 0; i < rows.length; i++) {
    const u = rows[i]
    const pos = medals[i] ?? `**${i + 1}.**`
    const ratingText = u.ratingCount > 0
      ? "★".repeat(Math.round(u.rating)) + "☆".repeat(5 - Math.round(u.rating))
      : "N/A"

    if (tipo === "sales") {
      description += `${pos} <@${u.user_id}> — **${u.sales}** venda(s) · R$ ${formatValor(u.totalValue ?? 0)} · ${ratingText}\n`
    } else if (tipo === "rating") {
      description += `${pos} <@${u.user_id}> — ${ratingText} (${u.rating}) · ${u.ratingCount} aval. · ${u.sales} vendas\n`
    } else {
      description += `${pos} <@${u.user_id}> — **${u.total}** anúncio(s) · ${u.sales} vendidos · ${ratingText}\n`
    }
  }

  const guildIcon = interaction.guild.iconURL({ extension: "webp", forceStatic: false, size: 128 })

  const c = container(COLORS.GOLD)
  c.addSectionComponents(
    section(
      `## ${titles[tipo] ?? "Ranking"}\n-# Cache atualizado a cada 60s`,
      guildIcon ? thumbnail(guildIcon, "Servidor") : undefined
    )
  )
  c.addSeparatorComponents(separator())
  c.addTextDisplayComponents(text(description.trim()))

  await interaction.editReply({ components: [c] })
}
