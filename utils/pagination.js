import { ButtonStyle, MessageFlags } from "discord.js"
import { saveTempModalData, getTempModalData, updateTempModalData } from "./database.js"
import { CV2_EPHEMERAL, container, text, separator, createRow, createButton, COLORS } from "./components.js"

/**
 * Cria container CV2 paginado com estado persistido no banco.
 * FIX M-8: O estado é salvo UMA vez e atualizado in-place (não cria novo registro a cada clique).
 *
 * @param {Object} opts
 * @param {Array} opts.items
 * @param {number} opts.itemsPerPage
 * @param {number} opts.currentPage
 * @param {string} opts.title
 * @param {number} opts.color - COLORS.X integer
 * @param {string} opts.description
 * @param {Function} opts.formatItem - (item) => string (markdown text)
 * @returns {{ components: Array, stateId: string, totalPages: number, currentPage: number }}
 */
export function createPaginatedEmbed({
  items,
  itemsPerPage = 5,
  currentPage = 0,
  title,
  color = COLORS.PRIMARY,
  description = "",
  formatItem,
}) {
  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage))
  const page = Math.max(0, Math.min(currentPage, totalPages - 1))
  const start = page * itemsPerPage
  const pageItems = items.slice(start, start + itemsPerPage)

  const c = container(color)
  c.addTextDisplayComponents(text(`## ${title}`))
  if (description) c.addTextDisplayComponents(text(description))
  c.addSeparatorComponents(separator())

  for (const item of pageItems) {
    c.addTextDisplayComponents(text(formatItem(item)))
  }

  c.addTextDisplayComponents(text(`-# Página ${page + 1} de ${totalPages} · Total: ${items.length}`))

  // FIX M-8: criar ou reusar estado
  const state = { items, itemsPerPage, title, color, description, currentPage: page, __pagination: true }
  const newStateId = savePaginationState(state)

  const rows = buildPaginationRows(newStateId, page, totalPages)
  for (const row of rows) c.addActionRowComponents(row)

  return { components: [c], stateId: newStateId, totalPages, currentPage: page }
}

/**
 * Salva o estado da paginação no banco para sobreviver restarts.
 * FIX M-8: Se stateId existente for passado, atualiza in-place.
 */
export function savePaginationState(state) {
  return saveTempModalData({ __pagination: true, ...state })
}

/**
 * Recupera estado salvo.
 */
export function getPaginationState(stateId) {
  const data = getTempModalData(stateId)
  if (!data || !data.__pagination) return null
  return data
}

/**
 * Cria as rows de botões de navegação.
 */
function buildPaginationRows(stateId, currentPage, totalPages) {
  if (totalPages <= 1) return []
  return [
    createRow(
      createButton({ customId: `page_prev_${stateId}`, label: "◀ Anterior", style: ButtonStyle.Secondary, disabled: currentPage === 0 }),
      createButton({ customId: `page_info_${stateId}`, label: `${currentPage + 1} / ${totalPages}`, style: ButtonStyle.Secondary, disabled: true }),
      createButton({ customId: `page_next_${stateId}`, label: "Próximo ▶", style: ButtonStyle.Secondary, disabled: currentPage >= totalPages - 1 }),
    ),
  ]
}

/**
 * Handler de botão de página.
 * FIX M-8: Atualiza o registro existente in-place em vez de criar novo.
 */
export async function handlePageButton(interaction, direction, stateId, formatItem) {
  await interaction.deferUpdate()

  const state = getPaginationState(stateId)
  if (!state) {
    return interaction.followUp({ content: "❌ Estado da página expirou. Use o comando novamente.", flags: MessageFlags.Ephemeral })
  }

  const totalPages = Math.ceil(state.items.length / state.itemsPerPage)
  const newPage = direction === "next"
    ? Math.min(state.currentPage + 1, totalPages - 1)
    : Math.max(state.currentPage - 1, 0)

  // FIX M-8: Atualizar in-place (mesmo stateId, sem criar novo registro)
  updateTempModalData(stateId, { ...state, currentPage: newPage })

  const c = container(state.color ?? COLORS.PRIMARY)
  c.addTextDisplayComponents(text(`## ${state.title}`))
  if (state.description) c.addTextDisplayComponents(text(state.description))
  c.addSeparatorComponents(separator())

  const start = newPage * state.itemsPerPage
  const pageItems = state.items.slice(start, start + state.itemsPerPage)
  for (const item of pageItems) c.addTextDisplayComponents(text(formatItem(item)))

  c.addTextDisplayComponents(text(`-# Página ${newPage + 1} de ${totalPages} · Total: ${state.items.length}`))

  // Botões com mesmo stateId
  const rows = buildPaginationRows(stateId, newPage, totalPages)
  for (const row of rows) c.addActionRowComponents(row)

  await interaction.editReply({ flags: CV2_EPHEMERAL, components: [c] })
}
