/**
 * staffHandler.js
 *
 * Painel unificado da staff via embed + botões + select menus.
 * Substitui todos os subcomandos: /blacklist adicionar/remover/listar/verificar,
 * /anuncios pendentes/historico/configurar, /config ver/alterar, /dashboard
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from "discord.js"
import {
  addToBlacklist, removeFromBlacklist, getBlacklist, getBlacklistEntry,
  isBlacklisted, getStats, getPendingAnnouncements,
  getAnnouncement, getUserAverageRating, getUserSuspiciousActivity,
  getAllSuspiciousUsers, getAnnouncementStats,
  addLog, updateConfig, getWeeklyStats, getAnnouncementsPaginated,
} from "../utils/database.js"
import { logAction } from "../utils/logger.js"
import { COLORS, formatValor, container, text, separator, createRow, createButton, CV2, CV2_EPHEMERAL } from "../utils/components.js"
import { isStaff as _isStaff } from "../utils/validator.js"
import {
  isPixVerificationEnabled, togglePixVerification, buildPixStatusContainer,
} from "./pixVerificationHandler.js"

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const isStaff = (interaction, config) => _isStaff(interaction.member, config.roles?.staff)

function buildMainPanel(guild, stats) {
  const pending    = getPendingAnnouncements()
  const suspicious = getAllSuspiciousUsers()

  const select = new StringSelectMenuBuilder()
    .setCustomId("staff_panel_section")
    .setPlaceholder("Selecione uma seção...")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("🚫 Blacklist")
        .setDescription("Gerenciar usuários banidos")
        .setValue("blacklist"),
      new StringSelectMenuOptionBuilder()
        .setLabel("📢 Anúncios")
        .setDescription("Ver pendentes, histórico e configurações")
        .setValue("announcements"),
      new StringSelectMenuOptionBuilder()
        .setLabel("📊 Estatísticas")
        .setDescription("Stats completas e relatório semanal")
        .setValue("stats"),
      new StringSelectMenuOptionBuilder()
        .setLabel("⚙️ Configurações")
        .setDescription("Alterar limites e parâmetros do bot")
        .setValue("config"),
      new StringSelectMenuOptionBuilder()
        .setLabel("🔍 Suspeitos")
        .setDescription(`Ver usuários suspeitos (${suspicious.length})`)
        .setValue("suspicious"),
    )

  const row1 = new ActionRowBuilder().addComponents(select)

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("staff_quick_pending")
      .setLabel(`Pendentes (${pending.length})`)
      .setStyle(pending.length > 0 ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setEmoji("📋"),
    new ButtonBuilder()
      .setCustomId("staff_quick_blacklist_add")
      .setLabel("+ Blacklist")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🚫"),
    new ButtonBuilder()
      .setCustomId("staff_quick_blacklist_check")
      .setLabel("Verificar BL")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔍"),
    new ButtonBuilder()
      .setCustomId("staff_quick_weekly")
      .setLabel("Rel. Semanal")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📈"),
  )

  const c = container(COLORS.PRIMARY)
    .addTextDisplayComponents(text(
      `## ⚙️  Painel de Gerenciamento — Staff
` +
      `${guild.name} · Selecione uma seção abaixo.

` +
      `🎫 **Tickets** · Abertos: **${stats.openTickets}** · Fechados: **${stats.closedTickets}** · Total: **${stats.totalTickets}**
` +
      `📢 **Anúncios** · Pendentes: **${stats.pendingAnnouncements}** ${stats.pendingAnnouncements > 0 ? "⚠️" : "✅"} · Ativos: **${stats.activeAnnouncements}** · Vendidos: **${stats.soldAnnouncements}**
` +
      `🤝 **Negociações** · Ativas: **${stats.totalNegotiations - stats.completedNegotiations}** · Concluídas: **${stats.completedNegotiations}**
` +
      `🚨 **Atenção** · Blacklist: **${stats.blacklistedUsers}** · Suspeitos: **${suspicious.length}** ${suspicious.length > 0 ? "⚠️" : "✅"} · Reservas: **${stats.activeReservations ?? 0}**`
    ))
    .addSeparatorComponents(separator())
    .addActionRowComponents(row1)
    .addActionRowComponents(row2)

  return { flags: CV2, components: [c] }
}

// ─────────────────────────────────────────────
// COMANDO /staff → abre painel principal
// ─────────────────────────────────────────────

export async function handleStaffCommand(interaction, client) {
  const config = client.config

  if (!isStaff(interaction, config)) {
    return interaction.reply({
      flags: CV2_EPHEMERAL,
      components: [container(COLORS.DANGER).addTextDisplayComponents(text("❌ Você não tem permissão para usar este comando."))],
    })
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const stats = getStats()
  await interaction.editReply(buildMainPanel(interaction.guild, stats))
}

// ─────────────────────────────────────────────
// SELECT MENU: staff_panel_section
// ─────────────────────────────────────────────

export async function handleStaffPanelSection(interaction, client) {
  const config = client.config
  if (!isStaff(interaction, config)) return interaction.reply({ content: "Sem permissão.", flags: MessageFlags.Ephemeral })

  const section = interaction.values[0]
  await interaction.deferUpdate()

  if (section === "blacklist") await showBlacklistPanel(interaction, client)
  else if (section === "announcements") await showAnnouncementsPanel(interaction, client)
  else if (section === "stats") await showStatsPanel(interaction, client)
  else if (section === "config") await showConfigPanel(interaction, client)
  else if (section === "suspicious") await showSuspiciousPanel(interaction, client)
}

// ─────────────────────────────────────────────
// BOTÕES RÁPIDOS DO PAINEL
// ─────────────────────────────────────────────

export async function handleStaffQuickButton(interaction, action, client) {
  const config = client.config
  if (!isStaff(interaction, config)) return interaction.reply({ content: "Sem permissão.", flags: MessageFlags.Ephemeral })

  if (action === "pending") {
    await interaction.deferUpdate()
    await showPendingAnnouncements(interaction, client)
  } else if (action === "blacklist_add") {
    await showBlacklistAddModal(interaction, client)
  } else if (action === "blacklist_check") {
    await showBlacklistCheckModal(interaction, client)
  } else if (action === "weekly") {
    await interaction.deferUpdate()
    await showWeeklyReport(interaction, client)
  } else if (action === "back") {
    await interaction.deferUpdate()
    const stats = getStats()
    await interaction.editReply(buildMainPanel(interaction.guild, stats))
  } else if (action.startsWith("sus_next_")) {
    await interaction.deferUpdate()
    const page = parseInt(action.split("_")[2]) + 1
    await showSuspiciousPanel(interaction, client, page)
  } else if (action.startsWith("sus_prev_")) {
    await interaction.deferUpdate()
    const page = Math.max(0, parseInt(action.split("_")[2]) - 1)
    await showSuspiciousPanel(interaction, client, page)
  }
}

// ─────────────────────────────────────────────
// PAINEL: BLACKLIST
// ─────────────────────────────────────────────

async function showBlacklistPanel(interaction, client) {
  const blacklist = getBlacklist()

  const blLines = blacklist.slice(0, 10).map((entry) => {
    const date = new Date(entry.created_at).toLocaleDateString("pt-BR")
    return `<@${entry.user_id}> — ${entry.reason} · por <@${entry.created_by}> · ${date}`
  })

  const descTop = blacklist.length === 0
    ? "A blacklist está vazia."
    : `**${blacklist.length}** usuário(s) bloqueados atualmente.`
  const footerNote = blacklist.length > 10 ? `\n-# Mostrando 10 de ${blacklist.length} usuários` : ""
  const blText = `## 🚫 Gerenciamento de Blacklist\n${descTop}${blLines.length ? "\n" + blLines.join("\n") : ""}${footerNote}`

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("staff_bl_add")
      .setLabel("Adicionar à BL")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("➕"),
    new ButtonBuilder()
      .setCustomId("staff_bl_remove")
      .setLabel("Remover da BL")
      .setStyle(ButtonStyle.Success)
      .setEmoji("➖"),
    new ButtonBuilder()
      .setCustomId("staff_bl_check")
      .setLabel("Verificar usuário")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔍"),
    new ButtonBuilder()
      .setCustomId("staff_quick_back")
      .setLabel("Voltar")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("◀️"),
  )

  await interaction.editReply({
    flags: CV2,
    components: [container(COLORS.DANGER).addTextDisplayComponents(text(blText)).addActionRowComponents(row)],
  })
}

// ─────────────────────────────────────────────
// BLACKLIST: MODAIS E AÇÕES
// ─────────────────────────────────────────────

async function showBlacklistAddModal(interaction, client) {
  const modal = new ModalBuilder()
    .setCustomId("staff_bl_add_submit")
    .setTitle("Adicionar à Blacklist")

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("user_id")
        .setLabel("ID ou @menção do usuário")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 123456789012345678")
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("Motivo")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Descreva o motivo da blacklist...")
        .setRequired(true)
        .setMaxLength(500)
    ),
  )

  await interaction.showModal(modal)
}

async function showBlacklistCheckModal(interaction, client) {
  const modal = new ModalBuilder()
    .setCustomId("staff_bl_check_submit")
    .setTitle("Verificar Blacklist")

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("user_id")
        .setLabel("ID do usuário para verificar")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 123456789012345678")
        .setRequired(true)
    ),
  )

  await interaction.showModal(modal)
}

async function showBlacklistRemoveModal(interaction, client) {
  const modal = new ModalBuilder()
    .setCustomId("staff_bl_remove_submit")
    .setTitle("Remover da Blacklist")

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("user_id")
        .setLabel("ID do usuário para remover")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 123456789012345678")
        .setRequired(true)
    ),
  )

  await interaction.showModal(modal)
}

export async function handleBlacklistButton(interaction, action, client) {
  const config = client.config
  if (!isStaff(interaction, config)) return interaction.reply({ content: "Sem permissão.", flags: MessageFlags.Ephemeral })

  if (action === "add") await showBlacklistAddModal(interaction, client)
  else if (action === "remove") await showBlacklistRemoveModal(interaction, client)
  else if (action === "check") await showBlacklistCheckModal(interaction, client)
}

// ─────────────────────────────────────────────
// BLACKLIST: PROCESSAR MODAIS
// ─────────────────────────────────────────────

export async function handleBlacklistAddSubmit(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const rawId = interaction.fields.getTextInputValue("user_id").replace(/[^0-9]/g, "")
  const reason = interaction.fields.getTextInputValue("reason")

  if (!rawId) {
    return interaction.editReply({ content: "ID inválido. Use apenas números ou copie o ID do Discord." })
  }

  let user
  try {
    user = await client.users.fetch(rawId)
  } catch {
    return interaction.editReply({ content: "Usuário não encontrado. Verifique o ID." })
  }

  if (isBlacklisted(user.id)) {
    return interaction.editReply({ content: `**${user.username}** já está na blacklist.` })
  }

  addToBlacklist(user.id, reason, interaction.user.id)
  addLog("blacklist_add", interaction.user.id, user.id, `Motivo: ${reason}`)

  try {
    await user.send({
      flags: CV2,
      components: [container(COLORS.DANGER).addTextDisplayComponents(text(
        `## ⛔ Você foi adicionado à Blacklist\nVocê não poderá criar anúncios ou negociar neste servidor.\n**Motivo:** ${reason}`
      ))],
    })
  } catch { /* DM fechada */ }

  await logAction(client, "blacklist_add", {
    userId: interaction.user.id,
    targetId: user.id,
    details: `**Usuário:** ${user.username} (${user.id})\n**Motivo:** ${reason}`,
  })

  await interaction.editReply({
    flags: CV2_EPHEMERAL,
    components: [container(COLORS.DANGER).addTextDisplayComponents(text(
      `## ✅ Usuário adicionado à Blacklist\n**Usuário:** ${user.username} (${user.id})\n**Motivo:** ${reason}\n**Adicionado por:** ${interaction.user.username}`
    ))],
  })
}

export async function handleBlacklistRemoveSubmit(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const rawId = interaction.fields.getTextInputValue("user_id").replace(/[^0-9]/g, "")

  if (!rawId) return interaction.editReply({ content: "ID inválido." })

  let user
  try {
    user = await client.users.fetch(rawId)
  } catch {
    return interaction.editReply({ content: "Usuário não encontrado." })
  }

  if (!isBlacklisted(user.id)) {
    return interaction.editReply({ content: `**${user.username}** não está na blacklist.` })
  }

  removeFromBlacklist(user.id)
  addLog("blacklist_remove", interaction.user.id, user.id, `Removido por ${interaction.user.username}`)

  try {
    await user.send({
      flags: CV2,
      components: [container(COLORS.SUCCESS).addTextDisplayComponents(text(
        `## ✅ Você foi removido da Blacklist\nVocê pode usar os serviços normalmente agora.`
      ))],
    })
  } catch { /* DM fechada */ }

  await logAction(client, "blacklist_remove", {
    userId: interaction.user.id,
    targetId: user.id,
    details: `**Usuário:** ${user.username} (${user.id})\n**Removido por:** ${interaction.user.username}`,
  })

  await interaction.editReply({
    flags: CV2_EPHEMERAL,
    components: [container(COLORS.SUCCESS).addTextDisplayComponents(text(
      `## ✅ Usuário removido da Blacklist\n**Usuário:** ${user.username} (${user.id})\n**Removido por:** ${interaction.user.username}`
    ))],
  })
}

export async function handleBlacklistCheckSubmit(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const rawId = interaction.fields.getTextInputValue("user_id").replace(/[^0-9]/g, "")

  if (!rawId) return interaction.editReply({ content: "ID inválido." })

  let user
  try {
    user = await client.users.fetch(rawId)
  } catch {
    return interaction.editReply({ content: "Usuário não encontrado." })
  }

  const entry = getBlacklistEntry(user.id)

  if (!entry) {
    return interaction.editReply({
      flags: CV2_EPHEMERAL,
      components: [container(COLORS.SUCCESS).addTextDisplayComponents(text(
        `## 🔍 Verificação de Blacklist\n✅ **${user.username}** não está na blacklist.`
      ))],
    })
  }

  const blDate = new Date(entry.created_at).toLocaleDateString("pt-BR")
  await interaction.editReply({
    flags: CV2_EPHEMERAL,
    components: [container(COLORS.DANGER).addTextDisplayComponents(text(
      `## 🔍 Verificação de Blacklist\n🚫 **${user.username}** está na blacklist.\n**Motivo:** ${entry.reason}\n**Adicionado por:** <@${entry.created_by}> · **Data:** ${blDate}`
    ))],
  })
}

// ─────────────────────────────────────────────
// PAINEL: ANÚNCIOS
// ─────────────────────────────────────────────

async function showAnnouncementsPanel(interaction, client) {
  const pending = getPendingAnnouncements()
  const annStats = getAnnouncementStats()

  const annText =
    `## 📢 Gerenciamento de Anúncios\nVisualize e gerencie os anúncios do servidor.\n` +
    `**Resumo:**\n📋 Pendentes: **${annStats.pending}** ${annStats.pending > 0 ? "⚠️" : ""}\n` +
    `✅ Ativos: **${annStats.approved}**\n💸 Vendidos: **${annStats.sold}**\n` +
    `❌ Recusados: **${annStats.rejected}**\n📦 Total: **${annStats.total}**`

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("staff_ann_pending")
      .setLabel(`Ver Pendentes (${pending.length})`)
      .setStyle(pending.length > 0 ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setEmoji("📋"),
    new ButtonBuilder()
      .setCustomId("staff_ann_history")
      .setLabel("Histórico")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📜"),
    new ButtonBuilder()
      .setCustomId("staff_quick_back")
      .setLabel("Voltar")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("◀️"),
  )

  await interaction.editReply({
    flags: CV2,
    components: [container(COLORS.WARNING).addTextDisplayComponents(text(annText)).addActionRowComponents(row)],
  })
}

async function showPendingAnnouncements(interaction, client, page = 0) {
  const PAGE_SIZE = 5
  const all = getPendingAnnouncements()
  const totalPages = Math.max(1, Math.ceil(all.length / PAGE_SIZE))
  const safePage = Math.min(Math.max(0, page), totalPages - 1)
  const pending = all.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  if (all.length === 0) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("staff_quick_back")
        .setLabel("Voltar ao Painel")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("◀️"),
    )

    return interaction.editReply({
      flags: CV2,
      components: [container(COLORS.SUCCESS).addTextDisplayComponents(text(
        "## 📋 Anúncios Pendentes\n✅ Nenhum anúncio aguardando aprovação no momento."
      )).addActionRowComponents(row)],
    })
  }

  const pendingLines = pending.map((a) => {
    const date = new Date(a.created_at).toLocaleString("pt-BR")
    return `**#${a.id} — ${a.nick}** · Vendedor: <@${a.user_id}> · R$ ${formatValor(a.valor)}\n${date}`
  })
  const footerNote = totalPages > 1
    ? `\n-# Página ${safePage + 1} de ${totalPages} · Total: ${all.length} pendente(s)`
    : `\n-# Total: ${all.length} pendente(s)`
  const pendingText = `## 📋 Anúncios Pendentes — ${all.length} aguardando\n${pendingLines.join("\n―\n")}${footerNote}`

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`staff_ann_pendprev_${safePage}`)
      .setLabel("◀ Anterior")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage === 0),
    new ButtonBuilder()
      .setCustomId(`staff_ann_pendinfo`)
      .setLabel(`${safePage + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`staff_ann_pendnext_${safePage}`)
      .setLabel("Próximo ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId("staff_quick_back")
      .setLabel("Voltar ao Painel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("◀️"),
  )

  await interaction.editReply({
    flags: CV2,
    components: [container(COLORS.WARNING).addTextDisplayComponents(text(pendingText)).addActionRowComponents(row)],
  })
}

export async function handleAnnouncementsButton(interaction, action, client) {
  const config = client.config
  if (!isStaff(interaction, config)) return interaction.reply({ content: "Sem permissão.", flags: MessageFlags.Ephemeral })

  await interaction.deferUpdate()

  if (action === "pending") await showPendingAnnouncements(interaction, client)
  else if (action.startsWith("pendnext_")) {
    const page = parseInt(action.split("_")[1]) + 1
    await showPendingAnnouncements(interaction, client, page)
  }
  else if (action.startsWith("pendprev_")) {
    const page = Math.max(0, parseInt(action.split("_")[1]) - 1)
    await showPendingAnnouncements(interaction, client, page)
  }
  else if (action === "history") await showAnnouncementHistory(interaction, client, 0)
  else if (action.startsWith("histnext_")) {
    const page = parseInt(action.split("_")[1]) + 1
    await showAnnouncementHistory(interaction, client, page)
  }
  else if (action.startsWith("histprev_")) {
    const page = Math.max(0, parseInt(action.split("_")[1]) - 1)
    await showAnnouncementHistory(interaction, client, page)
  }
}

async function showAnnouncementHistory(interaction, client, page = 0) {
  // FIX BUG-10: Removido o import dinâmico desnecessário.
  // getAnnouncementsPaginated já está disponível via import estático no topo do arquivo.
  const { rows: pageItems, total, totalPages } = getAnnouncementsPaginated(page, 12)

  const annStats = getAnnouncementStats()

  const statusLabels = {
    pending: "⏳ Pendente",
    approved: "✅ Ativo",
    rejected: "❌ Recusado",
    sold: "💸 Vendido",
    expired: "⌛ Expirado",
  }

  const histLines = pageItems.map((a) => {
    const status = statusLabels[a.status] || a.status
    const date = new Date(a.created_at).toLocaleDateString("pt-BR")
    return `**#${a.id} — ${a.nick}** [${status}]\nVendedor: <@${a.user_id}> · R$ ${formatValor(a.valor)} · ${date}`
  }).join("\n\u2015\n")

  const footerNote = totalPages > 1 ? `\n-# Página ${page + 1} de ${totalPages} · Total: ${total}` : ""
  const histText =
    `## 📜 Histórico de Anúncios\n` +
    `**Total:** ${annStats.total} anúncio(s) — ✅ Ativos: ${annStats.approved}  💸 Vendidos: ${annStats.sold}  ❌ Recusados: ${annStats.rejected}\n\n` +
    histLines + footerNote

  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`staff_ann_histprev_${page}`)
        .setLabel("◀ Anterior")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0),
      new ButtonBuilder()
        .setCustomId(`staff_ann_histinfo`)
        .setLabel(`${page + 1} / ${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true),
      new ButtonBuilder()
        .setCustomId(`staff_ann_histnext_${page}`)
        .setLabel("Próximo ▶")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1),
      new ButtonBuilder()
        .setCustomId("staff_quick_back")
        .setLabel("Voltar ao Painel")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("◀️"),
    ),
  ]

  await interaction.editReply({
    flags: CV2,
    components: [container(COLORS.PRIMARY).addTextDisplayComponents(text(histText)).addActionRowComponents(rows[0])],
  })
}

// ─────────────────────────────────────────────
// PAINEL: ESTATÍSTICAS
// ─────────────────────────────────────────────

async function showStatsPanel(interaction, client) {
  const stats = getStats()

  const maxBar = 10
  function bar(value, max) {
    if (!max) return "░".repeat(maxBar)
    const filled = Math.min(Math.round((value / max) * maxBar), maxBar)
    return "█".repeat(filled) + "░".repeat(maxBar - filled)
  }

  const totalTickets = stats.totalTickets || 1

  const statsText =
    `## 📊 Estatísticas do Servidor\n` +
    `**🎫 Tickets**\n` +
    `Total: **${stats.totalTickets}**\n` +
    `Abertos:  ${bar(stats.openTickets, totalTickets)} ${stats.openTickets}\n` +
    `Fechados: ${bar(stats.closedTickets, totalTickets)} ${stats.closedTickets}\n\n` +
    `**📢 Anúncios**\n` +
    `Total: **${stats.totalAnnouncements}** — Ativos: **${stats.activeAnnouncements}**  Pendentes: **${stats.pendingAnnouncements}**  Vendidos: **${stats.soldAnnouncements}**\n\n` +
    `**🤝 Negociações**\n` +
    `Total: **${stats.totalNegotiations}** — Concluídas: **${stats.completedNegotiations}**  Blacklist: **${stats.blacklistedUsers}**\n` +
    `-# Solicitado por ${interaction.user.username}`

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("staff_stats_weekly")
      .setLabel("Relatório Semanal")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("📈"),
    new ButtonBuilder()
      .setCustomId("staff_quick_back")
      .setLabel("Voltar ao Painel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("◀️"),
  )

  await interaction.editReply({
    flags: CV2,
    components: [container(COLORS.PRIMARY).addTextDisplayComponents(text(statsText)).addActionRowComponents(row)],
  })
}

async function showWeeklyReport(interaction, client) {
  const stats = getWeeklyStats()
  const topSeller = stats.topSeller ? `<@${stats.topSeller[0]}> (${stats.topSeller[1]} vendas)` : "Nenhum"

  const weeklyText =
    `## 📈 Relatório — Últimos 7 Dias\n` +
    `🎫 **Tickets** — Novos: **${stats.newTickets}**  Fechados: **${stats.closedTickets}**\n` +
    `📢 **Anúncios** — Novos: **${stats.newAnnouncements}**  Aprovados: **${stats.approvedAds}**  Vendidos: **${stats.soldCount}**\n` +
    `💰 **Volume** — R$ **${stats.totalRevenue}** em **${stats.completedNegs}** venda(s)\n` +
    `⭐ **Avaliações** — **${stats.newRatings}** novas · Média: **${stats.avgRating}**\n` +
    `🏆 **Top Vendedor** — ${topSeller}`

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("staff_quick_back")
      .setLabel("Voltar ao Painel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("◀️"),
  )

  await interaction.editReply({
    flags: CV2,
    components: [container(COLORS.INFO).addTextDisplayComponents(text(weeklyText)).addActionRowComponents(row)],
  })
}

export async function handleStatsButton(interaction, action, client) {
  const config = client.config
  if (!isStaff(interaction, config)) return interaction.reply({ content: "Sem permissão.", flags: MessageFlags.Ephemeral })

  await interaction.deferUpdate()

  if (action === "weekly") await showWeeklyReport(interaction, client)
}

// ─────────────────────────────────────────────
// PAINEL: CONFIGURAÇÕES
// ─────────────────────────────────────────────

async function showConfigPanel(interaction, client) {
  const config = client.config

  const pixEnabled = isPixVerificationEnabled(client)

  const configText =
    `## ⚙️ Configurações do Bot\n` +
    `Canal de Anúncios: <#${config.channels.anuncios}>\n` +
    `Canal de Logs: <#${config.channels.logs}>\n` +
    `Canal de Review: ${config.channels.review ? `<#${config.channels.review}>` : "⚠️ **Não configurado** — anúncios não serão enviados para revisão!"}\n` +
    `Cargo Staff: <@&${config.roles.staff}>\n` +
    `Max Anúncios Ativos: **${config.limits?.maxActiveAnnouncements ?? 3}**\n` +
    `Expiração (dias): **${config.limits?.announcementExpirationDays ?? 30}**\n` +
    `Limite Intermediário (R$): **${config.limits?.escrowValueThreshold ?? 500}**\n` +
    `Max Negociações/Usuário: **${config.limits?.maxNegotiationsPerUser ?? 5}**\n` +
    `-# Use o botão abaixo para alterar valores`

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("staff_config_edit")
      .setLabel("Alterar Configuração")
      .setStyle(ButtonStyle.Primary)
      .setEmoji("✏️"),
    new ButtonBuilder()
      .setCustomId("staff_config_pix_status")
      .setLabel(`${pixEnabled ? "🟢" : "🔴"} Verificação PIX`)
      .setStyle(pixEnabled ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("staff_quick_back")
      .setLabel("Voltar ao Painel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("◀️"),
  )

  await interaction.editReply({
    flags: CV2,
    components: [container(COLORS.INFO).addTextDisplayComponents(text(configText)).addActionRowComponents(row)],
  })
}

export async function handleConfigButton(interaction, action, client) {
  const config = client.config
  if (!isStaff(interaction, config)) return interaction.reply({ content: "Sem permissão.", flags: MessageFlags.Ephemeral })

  // Toggle PIX Verification
  if (action === "pix_toggle") {
    const currentlyEnabled = isPixVerificationEnabled(client)
    const newState = !currentlyEnabled
    togglePixVerification(newState)
    // Update in-memory config too
    if (!client.config.features) client.config.features = {}
    client.config.features.pixVerification = newState

    const sc = buildPixStatusContainer(newState)
      .addActionRowComponents(createRow(
        createButton({ customId: "staff_config_pix_toggle", label: newState ? "🔴 Desativar Verificação PIX" : "🟢 Ativar Verificação PIX", style: newState ? ButtonStyle.Danger : ButtonStyle.Success }),
        createButton({ customId: "staff_config_back", label: "↩ Voltar", style: ButtonStyle.Secondary }),
      ))
    await interaction.update({ flags: CV2, components: [sc] })
    return
  }

  if (action === "back") {
    // Redireciona de volta ao painel de config
    await interaction.deferUpdate()
    return showConfigPanel(interaction, client)
  }

  if (action === "pix_status") {
    const enabled = isPixVerificationEnabled(client)
    const pc = buildPixStatusContainer(enabled)
      .addActionRowComponents(createRow(
        createButton({ customId: "staff_config_pix_toggle", label: enabled ? "🔴 Desativar" : "🟢 Ativar", style: enabled ? ButtonStyle.Danger : ButtonStyle.Success }),
        createButton({ customId: "staff_config_back", label: "↩ Voltar", style: ButtonStyle.Secondary }),
      ))
    await interaction.reply({ flags: CV2_EPHEMERAL, components: [pc] })
    return
  }

  if (action === "edit") {
    const modal = new ModalBuilder()
      .setCustomId("staff_config_submit")
      .setTitle("Alterar Configuração")

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("chave")
          .setLabel("Chave (ex: limits.maxActiveAnnouncements)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(
            "limits.maxActiveAnnouncements / channels.review / ..."
          )
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("valor")
          .setLabel("Novo valor (apenas números)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Ex: 5")
          .setRequired(true)
      ),
    )

    await interaction.showModal(modal)
  }
}

export async function handleConfigSubmit(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const chave = interaction.fields.getTextInputValue("chave").trim()
  const valor = interaction.fields.getTextInputValue("valor").trim()

  const allowedKeys = {
    "limits.maxActiveAnnouncements": "int",
    "limits.announcementExpirationDays": "int",
    "limits.maxNegotiationsPerUser": "int",
    "limits.escrowValueThreshold": "float",
    "antiScam.maxSameAccountAds": "int",
    "antiScam.suspiciousValueThreshold": "float",
    "channels.review": "string",
  }

  if (!allowedKeys[chave]) {
    return interaction.editReply({
      content:
        `❌ Chave inválida.\n**Chaves permitidas:**\n${Object.keys(allowedKeys).map((k) => `\`${k}\``).join(", ")}`,
    })
  }

  const tipo = allowedKeys[chave]

  let valorParsed
  if (tipo === "string") {
    // Para IDs de canal: aceitar apenas dígitos
    valorParsed = valor.replace(/[^0-9]/g, "")
    if (!valorParsed) {
      return interaction.editReply({ content: "❌ Valor inválido. Para canais, informe apenas o ID numérico do canal (ex: 1234567890123456789)." })
    }
  } else {
    valorParsed = tipo === "int" ? parseInt(valor) : (valor.includes(",") ? parseFloat(valor.replace(/\./g, "").replace(",", ".")) : parseFloat(valor))
    if (isNaN(valorParsed) || valorParsed < 0) {
      return interaction.editReply({ content: "❌ Valor inválido. Use apenas números positivos." })
    }
  }

  const keys = chave.split(".")
  let obj = client.config
  for (let i = 0; i < keys.length - 1; i++) {
    if (!obj[keys[i]]) obj[keys[i]] = {}
    obj = obj[keys[i]]
  }
  const oldValue = obj[keys[keys.length - 1]]
  obj[keys[keys.length - 1]] = valorParsed
  updateConfig(chave, valorParsed)

  await logAction(client, "config_changed", {
    userId: interaction.user.id,
    details: `**Chave:** ${chave}\n**Antes:** ${oldValue}\n**Depois:** ${valorParsed}`,
  })

  await interaction.editReply({
    flags: CV2_EPHEMERAL,
    components: [container(COLORS.SUCCESS).addTextDisplayComponents(text(
      `## ✅ Configuração Atualizada\n**Chave:** ${chave}\n**Valor Anterior:** ${oldValue}\n**Novo Valor:** ${valorParsed}`
    ))],
  })
}

// ─────────────────────────────────────────────
// PAINEL: SUSPEITOS
// ─────────────────────────────────────────────

async function showSuspiciousPanel(interaction, client, page = 0) {
  const suspicious = getAllSuspiciousUsers()
  const PAGE_SIZE = 8
  const totalPages = Math.max(1, Math.ceil(suspicious.length / PAGE_SIZE))
  const pageItems = suspicious.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  let susContent
  if (suspicious.length === 0) {
    susContent = "## 🔍 Usuários Suspeitos\n✅ Nenhum usuário suspeito detectado."
  } else {
    const susLines = pageItems.map(({ uid, flags }) => {
      const flagText = flags.map((f) => {
        if (f.type === "many_rejections") return `⚠️ ${f.count} rejeições`
        if (f.type === "shared_uuid") return `⚠️ UUID compartilhado (${f.sellers.length} vendedores)`
        if (f.type === "many_cancelled_negotiations") return `⚠️ ${f.count} negociações canceladas`
        return `⚠️ ${f.type}`
      }).join(" | ")
      return `<@${uid}> — ${flagText}`
    }).join("\n")
    const footerNote = totalPages > 1 ? `\n-# Página ${page + 1} de ${totalPages} · Total: ${suspicious.length}` : ""
    susContent = `## 🔍 Usuários Suspeitos\n**${suspicious.length}** usuário(s) com atividade suspeita detectada.\n\n${susLines}${footerNote}`
  }

  const navButtons = totalPages > 1 ? [
    new ButtonBuilder()
      .setCustomId(`staff_sus_prev_${page}`)
      .setLabel("◀ Anterior")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === 0),
    new ButtonBuilder()
      .setCustomId(`staff_sus_info`)
      .setLabel(`${page + 1} / ${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId(`staff_sus_next_${page}`)
      .setLabel("Próximo ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages - 1),
  ] : []

  const row = new ActionRowBuilder().addComponents(
    ...navButtons,
    new ButtonBuilder()
      .setCustomId("staff_quick_back")
      .setLabel("Voltar ao Painel")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("◀️"),
  )

  await interaction.editReply({
    flags: CV2,
    components: [container(suspicious.length > 0 ? COLORS.DANGER : COLORS.SUCCESS)
      .addTextDisplayComponents(text(susContent))
      .addActionRowComponents(row)],
  })
}
