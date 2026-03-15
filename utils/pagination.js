/**
 * utils/pagination.js — v2  (Components v2)
 *
 * Paginação migrada para ContainerBuilder.
 * A interface externa é mantida compatível:
 *   createPaginatedEmbed()  → retorna { container, rows, stateId, ... }
 *   handlePageButton()      → atualiza via interaction.editReply(components: [...])
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} from "discord.js"
import { saveTempModalData, getTempModalData, updateTempModalData } from "./database.js"
import { build, text, sep, C2_FLAG } from "./cv2.js"

/**
 * Cria container paginado com estado persistido no banco.
 */
export function createPaginatedEmbed({
  items,
  itemsPerPage = 5,
  currentPage = 0,
  title,
  color = 0x5865F2,
  description = "",
  formatItem,
  stateId = null,
}) {
  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage))
  const page = Math.max(0, Math.min(currentPage, totalPages - 1))
  const start = page * itemsPerPage
  const pageItems = items.slice(start, start + itemsPerPage)

  // Build markdown content
  let content = `## ${title}\n\n`
  if (description) content += description + "\n\n"
  for (const item of pageItems) {
    const f = formatItem(item)
    if (Array.isArray(f)) {
      for (const field of f) content += `**${field.name}**\n${field.value}\n\n`
    } else if (f) {
      content += `**${f.name}**\n${f.value}\n\n`
    }
  }
  content += `-# Página ${page + 1} de ${totalPages} · Total: ${items.length}`

  const newStateId = savePaginationState({ items, itemsPerPage, title, color, description, currentPage: page, __pagination: true })
  const rows = buildPaginationRows(newStateId, page, totalPages)

  const container = build(
    [text(content), ...(rows.length ? [sep()] : [])],
    color,
  )
  // Rows go as separate components after the container when needed
  return { container, rows, stateId: newStateId, totalPages, currentPage: page }
}

export function savePaginationState(state) {
  return saveTempModalData({ __pagination: true, ...state })
}

export function getPaginationState(stateId) {
  const data = getTempModalData(stateId)
  if (!data || !data.__pagination) return null
  return data
}

function buildPaginationRows(stateId, currentPage, totalPages) {
  if (totalPages <= 1) return []
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`page_prev_${stateId}`)
        .setLabel("◀ Anterior")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 0),
      new ButtonBuilder()
        .setCustomId(`page_info_${stateId}`)
        .setLabel(`${currentPage + 1} / ${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`page_next_${stateId}`)
        .setLabel("Próximo ▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage >= totalPages - 1),
    ),
  ]
}

export async function handlePageButton(interaction, direction, stateId, formatItem) {
  await interaction.deferUpdate()

  const state = getPaginationState(stateId)
  if (!state) {
    return interaction.followUp({
      content: "❌ Estado da página expirou. Use o comando novamente.",
      flags: MessageFlags.Ephemeral,
    })
  }

  const totalPages = Math.ceil(state.items.length / state.itemsPerPage)
  const newPage = direction === "next"
    ? Math.min(state.currentPage + 1, totalPages - 1)
    : Math.max(state.currentPage - 1, 0)

  updateTempModalData(stateId, { ...state, currentPage: newPage })

  let content = `## ${state.title}\n\n`
  if (state.description) content += state.description + "\n\n"

  const start = newPage * state.itemsPerPage
  const pageItems = state.items.slice(start, start + state.itemsPerPage)
  for (const item of pageItems) {
    const f = formatItem(item)
    if (Array.isArray(f)) {
      for (const field of f) content += `**${field.name}**\n${field.value}\n\n`
    } else if (f) {
      content += `**${f.name}**\n${f.value}\n\n`
    }
  }
  content += `-# Página ${newPage + 1} de ${totalPages} · Total: ${state.items.length}`

  const rows = buildPaginationRows(stateId, newPage, totalPages)
  const container = build(
    [text(content), ...(rows.length ? [sep()] : [])],
    state.color ?? 0x5865F2,
  )

  await interaction.editReply({
    components: [appendRows(container, ...rows)],
    flags: C2_FLAG,
  })
}
