/**
 * buscaHandler.js — Handler do comando /buscar (CV2)
 *
 * Responsabilidade: Buscar anúncios com filtros e paginação
 */

import { MessageFlags } from "discord.js"
import { searchAnnouncements, getUserAverageRating } from "../utils/database.js"
import { formatValor, COLORS, CV2_EPHEMERAL } from "../utils/components.js"
import { createPaginatedEmbed, getPaginationState, handlePageButton } from "../utils/pagination.js"
import { checkCooldown } from "../utils/cooldown.js"

// Cache de ratings para evitar N+1 queries — preenchido antes de ordenar/formatar
let _ratingsCache = new Map()

function _getRating(userId) {
  if (_ratingsCache.has(userId)) return _ratingsCache.get(userId)
  const r = getUserAverageRating(userId)
  _ratingsCache.set(userId, r)
  return r
}

// Compartilhado entre busca inicial e paginação — altere em um só lugar
function formatItem(item) {
  const r = _getRating(item.user_id)
  const stars = r.count > 0
    ? "★".repeat(Math.round(r.average)) + "☆".repeat(5 - Math.round(r.average)) + ` (${r.average})`
    : "Sem aval."
  return (
    `**#${item.id} — ${item.nick} | R$ ${formatValor(item.valor)}**\n` +
    `**VIPs:** ${item.vips || "Nenhum"} · **Capas:** ${item.capas || "Nenhuma"}\n` +
    `**Vendedor:** <@${item.user_id}> ${stars}\n` +
    `**Publicado:** <t:${Math.floor(new Date(item.created_at).getTime() / 1000)}:R>`
  )
}

export async function handleBuscarCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  // Limpar cache de ratings a cada nova busca
  _ratingsCache = new Map()

  const cd = checkCooldown(interaction.user.id, "buscar", 5_000)
  if (cd.onCooldown) {
    return interaction.editReply({ content: `⏳ Aguarde ${Math.ceil(cd.remaining / 1000)}s antes de buscar novamente.` })
  }
  const nick     = interaction.options.getString("nick")
  const minPrice = interaction.options.getNumber("preco_min")
  const maxPrice = interaction.options.getNumber("preco_max")
  const vip      = interaction.options.getString("vip")
  const capa     = interaction.options.getString("capa")
  const sort     = interaction.options.getString("ordenar") || "newest"

  // Validação de inputs
  if (minPrice !== null && (minPrice < 0 || minPrice > 999999)) {
    return interaction.editReply({ content: "❌ Preço mínimo inválido. Use valores entre 0 e 999.999." })
  }
  if (maxPrice !== null && (maxPrice < 0 || maxPrice > 999999)) {
    return interaction.editReply({ content: "❌ Preço máximo inválido. Use valores entre 0 e 999.999." })
  }
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    return interaction.editReply({ content: "❌ Preço mínimo não pode ser maior que o máximo." })
  }

  let results = searchAnnouncements({ nick, minPrice, maxPrice, tag: vip, capa, status: "approved" })

  // Ordenação
  if (sort === "cheapest")   results.sort((a, b) => parseFloat(a.valor) - parseFloat(b.valor))
  else if (sort === "expensive") results.sort((a, b) => parseFloat(b.valor) - parseFloat(a.valor))
  else if (sort === "oldest")    results.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
  else if (sort === "rating") {
    // Prefetch ratings para evitar N+1 na ordenação
    _ratingsCache = new Map()
    for (const item of results) _getRating(item.user_id)
    results.sort((a, b) => {
      const ratingA = _getRating(a.user_id)
      const ratingB = _getRating(b.user_id)
      return (ratingB.average || 0) - (ratingA.average || 0)
    })
  }

  if (!results.length) {
    return interaction.editReply({ content: "Nenhum anúncio encontrado com esses filtros." })
  }

  const filters = [
    nick      ? `Nick: ${nick}`        : null,
    minPrice  ? `Min: R$ ${minPrice}`  : null,
    maxPrice  ? `Max: R$ ${maxPrice}`  : null,
    vip       ? `VIP: ${vip}`          : null,
    capa      ? `Capa: ${capa}`        : null,
  ].filter(Boolean)

  const { components } = createPaginatedEmbed({
    items: results,
    itemsPerPage: 5,
    currentPage: 0,
    title: "🔍 Resultados da Busca",
    color: COLORS.PRIMARY,
    description: `**${results.length}** anúncio(s) encontrado(s)` + (filters.length ? ` · ${filters.join(" · ")}` : ""),
    formatItem,
  })

  await interaction.editReply({ flags: CV2_EPHEMERAL, components })
}

export async function handlePaginationButton(interaction, direction, stateId) {
  const state = getPaginationState(stateId)
  if (!state) {
    return interaction.reply({ content: "❌ Sessão expirada. Use o comando novamente.", flags: MessageFlags.Ephemeral })
  }

  await handlePageButton(interaction, direction, stateId, formatItem)
}
