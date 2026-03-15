/**
 * staffHandler.js
 *
 * Painel unificado da staff via embed + botões + select menus.
 * Substitui todos os subcomandos: /blacklist adicionar/remover/listar/verificar,
 * /anuncios pendentes/historico/configurar, /config ver/alterar, /dashboard
 */

import {
  EmbedBuilder,
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
  getAllSuspiciousUsers, getAnnouncementStats,
  addLog, updateConfig, getWeeklyStats, getAnnouncementsPaginated,
} from "../utils/database.js"
import { logAction } from "../utils/logger.js"
import { COLORS, formatValor, buildStaffPanelC2, buildBlacklistPanelC2 } from "../utils/embedBuilder.js"
import { box, text, C2_FLAG } from "../utils/cv2.js"
import {
  isPixVerificationEnabled, togglePixVerification, buildPixStatusEmbed,
} from "./pixVerificationHandler.js"

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function isStaff(interaction, config) {
  return interaction.member.roles.cache.has(config.roles.staff)
}

function buildMainPanelEmbed(guild, stats) {
  const pending = getPendingAnnouncements()
  const suspicious = getAllSuspiciousUsers()

  return new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle("⚙️  Painel de Gerenciamento — Staff")
    .setThumbnail(guild.iconURL({ dynamic: true }))
    .setDescription("Selecione uma seção abaixo para gerenciar o servidor.")
    .addFields(
      {
        name: "🎫 Tickets",
        value: `Abertos: **${stats.openTickets}** · Fechados: **${stats.closedTickets}** · Total: **${stats.totalTickets}**`,
        inline: false,
      },
      {
        name: "📢 Anúncios",
        value:
          `Pendentes: **${stats.pendingAnnouncements}** ${stats.pendingAnnouncements > 0 ? "⚠️" : "✅"}  ` +
          `Ativos: **${stats.activeAnnouncements}**  Vendidos: **${stats.soldAnnouncements}**`,
        inline: false,
      },
      {
        name: "🤝 Negociações",
        value: `Ativas: **${stats.totalNegotiations - stats.completedNegotiations}**  Concluídas: **${stats.completedNegotiations}**`,
        inline: false,
      },
      {
        name: "🚨 Atenção",
        value:
          `Blacklist: **${stats.blacklistedUsers}** usuários\n` +
          `Suspeitos: **${suspicious.length}** ${suspicious.length > 0 ? "⚠️" : "✅"}\n` +
          `Reservas ativas: **${stats.activeReservations ?? 0}**`,
        inline: false,
      },
    )
    .setFooter({ text: `Atualizado` })
    .setTimestamp()
}

function buildMainPanelComponents(stats) {
  const pending = getPendingAnnouncements()
  const suspicious = getAllSuspiciousUsers()

  // Select menu principal
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

  // Botões de atalho rápido
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

  return [row1, row2]
}

// ─────────────────────────────────────────────
// COMANDO /staff → abre painel principal
// ─────────────────────────────────────────────

export async function handleStaffCommand(interaction, client) {
  const config = client.config

  if (!isStaff(interaction, config)) {
    return interaction.reply({ content: "❌ Você não tem permissão para usar este comando.", flags: MessageFlags.Ephemeral })
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const stats = getStats()
  const suspicious = getAllSuspiciousUsers()
  const pending = getPendingAnnouncements()
  const container = buildStaffPanelC2(interaction.guild, stats, pending.length, suspicious.length)
  const components = buildMainPanelComponents(stats)
  await interaction.editReply({ components: [appendRows(container, ...components)], flags: C2_FLAG })
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
    const suspicious = getAllSuspiciousUsers()
    const pending = getPendingAnnouncements()
    const container = buildStaffPanelC2(interaction.guild, stats, pending.length, suspicious.length)
    const components = buildMainPanelComponents(stats)
    await interaction.editReply({ components: [appendRows(container, ...components)], flags: C2_FLAG })
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

  const blContainer = buildBlacklistPanelC2(blacklist)
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("staff_bl_add").setLabel("Adicionar à BL").setStyle(ButtonStyle.Danger).setEmoji("➕"),
    new ButtonBuilder().setCustomId("staff_bl_remove").setLabel("Remover da BL").setStyle(ButtonStyle.Success).setEmoji("➖"),
    new ButtonBuilder().setCustomId("staff_bl_check").setLabel("Verificar usuário").setStyle(ButtonStyle.Secondary).setEmoji("🔍"),
    new ButtonBuilder().setCustomId("staff_quick_back").setLabel("Voltar").setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
  )
  await interaction.editReply({ components: [appendRows(blContainer, row)], flags: C2_FLAG })
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
    return interaction.editReply({ content: `**${user.tag}** já está na blacklist.` })
  }

  addToBlacklist(user.id, reason, interaction.user.id)
  addLog("blacklist_add", interaction.user.id, user.id, `Motivo: ${reason}`)

  try {
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.DANGER)
          .setTitle("⛔ Você foi adicionado à Blacklist")
          .setDescription(`Você não poderá criar anúncios ou negociar neste servidor.`)
          .addFields({ name: "Motivo", value: reason, inline: false })
          .setTimestamp(),
      ],
    })
  } catch { /* DM fechada */ }

  await logAction(client, "blacklist_add", {
    userId: interaction.user.id,
    targetId: user.id,
    details: `**Usuário:** ${user.tag}\n**Motivo:** ${reason}`,
  })

  await interaction.editReply({
    components: [box(`## ✅ Usuário adicionado à Blacklist\n\n👤 **Usuário:** ${user.tag}   📋 **Motivo:** ${reason}   ➕ **Por:** ${interaction.user.tag}`, 0xFF4444)],
    flags: C2_FLAG,
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
    return interaction.editReply({ content: `**${user.tag}** não está na blacklist.` })
  }

  removeFromBlacklist(user.id)
  addLog("blacklist_remove", interaction.user.id, user.id, `Removido por ${interaction.user.tag}`)

  try {
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.SUCCESS)
          .setTitle("✅ Você foi removido da Blacklist")
          .setDescription("Você pode usar os serviços normalmente agora.")
          .setTimestamp(),
      ],
    })
  } catch { /* DM fechada */ }

  await logAction(client, "blacklist_remove", {
    userId: interaction.user.id,
    targetId: user.id,
    details: `**Usuário:** ${user.tag}\n**Removido por:** ${interaction.user.tag}`,
  })

  await interaction.editReply({
    components: [box(`## ✅ Usuário removido da Blacklist\n\n👤 **Usuário:** ${user.tag}   ➖ **Por:** ${interaction.user.tag}`, 0x00D166)],
    flags: C2_FLAG,
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
      components: [box(`## 🔍 Verificação de Blacklist\n\n✅ **${user.tag}** não está na blacklist.`, 0x00D166)],
      flags: C2_FLAG,
    })
  }

  await interaction.editReply({
    components: [box(
      "## 🔍 Verificação de Blacklist\n\n" +
      `🚫 **${user.tag}** está na blacklist.\n\n` +
      `**Motivo:** ${entry.reason}   **Por:** <@${entry.created_by}>   **Data:** ${new Date(entry.created_at).toLocaleDateString("pt-BR")}`,
      0xFF4444
    )],
    flags: C2_FLAG,
  })
}

// ─────────────────────────────────────────────
// PAINEL: ANÚNCIOS
// ─────────────────────────────────────────────

async function showAnnouncementsPanel(interaction, client) {
  const pending = getPendingAnnouncements()
  const annStats = getAnnouncementStats()

  const annContent =
    "## 📢 Gerenciamento de Anúncios\n\n" +
    "Visualize e gerencie os anúncios do servidor.\n\n" +
    `📋 **Pendentes:** **${annStats.pending}** ${annStats.pending > 0 ? "⚠️" : ""}   ` +
    `✅ **Ativos:** **${annStats.approved}**   ` +
    `💸 **Vendidos:** **${annStats.sold}**\n` +
    `❌ **Recusados:** **${annStats.rejected}**   📦 **Total:** **${annStats.total}**`
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

  await interaction.editReply({ components: [boxWithRows(annContent, 0xFFA500, [row])], flags: C2_FLAG })
}

async function showPendingAnnouncements(interaction, client) {
  const pending = getPendingAnnouncements()

  if (pending.length === 0) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("staff_quick_back").setLabel("Voltar ao Painel").setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
    )
    return interaction.editReply({
      components: [boxWithRows("## 📋 Anúncios Pendentes\n\n✅ Nenhum anúncio aguardando aprovação no momento.", 0x00D166, [row])],
      flags: C2_FLAG,
    })
  }

  const pendLines = pending.slice(0, 8).map(a => {
    const date = new Date(a.created_at).toLocaleString("pt-BR")
    return `**#${a.id} — ${a.nick}** — Vendedor: <@${a.user_id}> · R$ ${formatValor(a.valor)} · ${date}`
  }).join("\n")
  const pendFooter = pending.length > 8 ? `\n\n-# Mostrando 8 de ${pending.length}` : ""
  const pendContent = `## 📋 Anúncios Pendentes — ${pending.length} aguardando\n\n${pendLines}${pendFooter}`
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("staff_quick_back").setLabel("Voltar ao Painel").setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
  )
  await interaction.editReply({ components: [boxWithRows(pendContent, 0xFFA500, [row])], flags: C2_FLAG })
}

export async function handleAnnouncementsButton(interaction, action, client) {
  const config = client.config
  if (!isStaff(interaction, config)) return interaction.reply({ content: "Sem permissão.", flags: MessageFlags.Ephemeral })

  await interaction.deferUpdate()

  if (action === "pending") await showPendingAnnouncements(interaction, client)
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

  const histLines = pageItems.map(a => {
    const status = statusLabels[a.status] || a.status
    const date = new Date(a.created_at).toLocaleDateString("pt-BR")
    return `**#${a.id} — ${a.nick}** [${status}] — <@${a.user_id}> · R$ ${formatValor(a.valor)} · ${date}`
  }).join("\n")
  const histFooter = totalPages > 1 ? `\n\n-# Página ${page + 1} de ${totalPages} · Total: ${total}` : ""
  const histContent =
    `## 📜 Histórico de Anúncios\n\n` +
    `**Total:** ${annStats.total}  ✅ Ativos: ${annStats.approved}  💸 Vendidos: ${annStats.sold}  ❌ Recusados: ${annStats.rejected}\n\n` +
    histLines + histFooter

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

  await interaction.editReply({ components: [appendRows(box(histContent, 0x5865F2), ...rows)], flags: C2_FLAG })
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

  const statsContent =
    `## 📊 Estatísticas do Servidor\n\n` +
    `**🎫 Tickets**\n` +
    `> Total: **${stats.totalTickets}**  Abertos: **${stats.openTickets}** ${bar(stats.openTickets, totalTickets)}  Fechados: **${stats.closedTickets}** ${bar(stats.closedTickets, totalTickets)}\n\n` +
    `**📢 Anúncios**\n` +
    `> Total: **${stats.totalAnnouncements}**  Ativos: **${stats.activeAnnouncements}**  Pendentes: **${stats.pendingAnnouncements}**  Vendidos: **${stats.soldAnnouncements}**\n\n` +
    `**🤝 Negociações**\n` +
    `> Total: **${stats.totalNegotiations}**  Concluídas: **${stats.completedNegotiations}**  Blacklist: **${stats.blacklistedUsers}**\n\n` +
    `-# Solicitado por ${interaction.user.tag}`

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("staff_stats_weekly").setLabel("Relatório Semanal").setStyle(ButtonStyle.Primary).setEmoji("📈"),
    new ButtonBuilder().setCustomId("staff_quick_back").setLabel("Voltar ao Painel").setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
  )

  await interaction.editReply({ components: [boxWithRows(statsContent, 0x5865F2, [row])], flags: C2_FLAG })
}

async function showWeeklyReport(interaction, client) {
  const stats = getWeeklyStats()
  const topSeller = stats.topSeller ? `<@${stats.topSeller[0]}> (${stats.topSeller[1]} vendas)` : "Nenhum"

  const weeklyContent =
    `## 📈 Relatório — Últimos 7 Dias\n\n` +
    `🎫 **Tickets** — Novos: **${stats.newTickets}**  Fechados: **${stats.closedTickets}**\n` +
    `📢 **Anúncios** — Novos: **${stats.newAnnouncements}**  Aprovados: **${stats.approvedAds}**  Vendidos: **${stats.soldCount}**\n` +
    `💰 **Volume** — R$ **${stats.totalRevenue}** em **${stats.completedNegs}** venda(s)\n` +
    `⭐ **Avaliações** — **${stats.newRatings}** novas  Média: **${stats.avgRating}**\n` +
    `🏆 **Top Vendedor** — ${topSeller}`

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("staff_quick_back").setLabel("Voltar ao Painel").setStyle(ButtonStyle.Secondary).setEmoji("◀️"),
  )

  await interaction.editReply({ components: [boxWithRows(weeklyContent, 0x7289DA, [row])], flags: C2_FLAG })
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
  const cfgContent =
    `## ⚙️ Configurações do Bot\n\n` +
    `**Max Anúncios Ativos:** ${config.limits?.maxActiveAnnouncements ?? 3}\n` +
    `**Expiração Anúncio (dias):** ${config.limits?.announcementExpirationDays ?? 30}\n` +
    `**Max Negociações/Usuário:** ${config.limits?.maxNegotiationsPerUser ?? 5}\n` +
    `**Limite Intermediário (R$):** ${config.limits?.escrowValueThreshold ?? 500}\n` +
    `**Verificação PIX:** ${pixEnabled ? "✅ Ativa" : "❌ Inativa"}\n\n` +
    `-# Altere via botões abaixo`
    
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("staff_config_edit").setLabel("✏️ Alterar Config").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`staff_config_pix_${pixEnabled ? "off" : "on"}`).setLabel(`${pixEnabled ? "Desativar" : "Ativar"} PIX`).setStyle(pixEnabled ? ButtonStyle.Danger : ButtonStyle.Success),
    new ButtonBuilder().setCustomId("staff_quick_back").setLabel("◀ Voltar").setStyle(ButtonStyle.Secondary),
  )
  await interaction.editReply({ components: [boxWithRows(cfgContent, 0x7289DA, [row])], flags: C2_FLAG })
}

export async function handleConfigButton(interaction, action, client) {
  const config = client.config
  if (!isStaff(interaction, config)) return interaction.reply({ content: "Sem permissão.", flags: MessageFlags.Ephemeral })

  // Toggle PIX Verification
  // action can be: 'pix_toggle' (from status panel), 'pix_on' or 'pix_off' (from config panel button)
  if (action === "pix_toggle" || action === "pix_on" || action === "pix_off") {
    const currentlyEnabled = isPixVerificationEnabled(client)
    // pix_on forces enable, pix_off forces disable, pix_toggle flips
    const newState = action === "pix_on" ? true : action === "pix_off" ? false : !currentlyEnabled
    togglePixVerification(newState)
    // Update in-memory config too
    if (!client.config.features) client.config.features = {}
    client.config.features.pixVerification = newState

    await interaction.update({
      embeds: [buildPixStatusEmbed(newState)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`staff_config_pix_${newState ? "off" : "on"}`)
          .setLabel(newState ? "🔴 Desativar Verificação PIX" : "🟢 Ativar Verificação PIX")
          .setStyle(newState ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("staff_config_back")
          .setLabel("↩ Voltar")
          .setStyle(ButtonStyle.Secondary),
      )],
    })
    return
  }

  if (action === "back") {
    // Redireciona de volta ao painel de config
    await interaction.deferUpdate()
    return showConfigPanel(interaction, client)
  }

  if (action === "pix_status") {
    const enabled = isPixVerificationEnabled(client)
    await interaction.reply({
      embeds: [buildPixStatusEmbed(enabled)],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("staff_config_pix_toggle")
          .setLabel(enabled ? "🔴 Desativar" : "🟢 Ativar")
          .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("staff_config_back")
          .setLabel("↩ Voltar")
          .setStyle(ButtonStyle.Secondary),
      )],
      flags: MessageFlags.Ephemeral,
    })
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
            "limits.maxActiveAnnouncements / limits.escrowValueThreshold / ..."
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
  }

  if (!allowedKeys[chave]) {
    return interaction.editReply({
      content:
        `❌ Chave inválida.\n**Chaves permitidas:**\n${Object.keys(allowedKeys).map((k) => `\`${k}\``).join(", ")}`,
    })
  }

  const tipo = allowedKeys[chave]
  const valorParsed = tipo === "int" ? parseInt(valor) : (valor.includes(",") ? parseFloat(valor.replace(/\./g, "").replace(",", ".")) : parseFloat(valor))

  if (isNaN(valorParsed) || valorParsed < 0) {
    return interaction.editReply({ content: "❌ Valor inválido. Use apenas números positivos." })
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
    components: [box(
      `## ✅ Configuração Atualizada\n\n` +
      `**Chave:** ${chave}   **Valor Anterior:** ${String(oldValue)}   **Novo Valor:** ${String(valorParsed)}`,
      0x00D166
    )],
    flags: C2_FLAG,
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
    susContent = "## 🔍 Usuários Suspeitos\n\n✅ Nenhum usuário suspeito detectado."
  } else {
    const susLines = pageItems.map(({ uid, flags }) => {
      const flagText = flags.map((f) => {
        if (f.type === "many_rejections") return `⚠️ ${f.count} rejeições`
        if (f.type === "shared_uuid") return `⚠️ UUID compartilhado (${f.sellers.length} vendedores)`
        if (f.type === "many_cancelled_negotiations") return `⚠️ ${f.count} negociações canceladas`
        return `⚠️ ${f.type}`
      }).join("  ")
      return `**<@${uid}>** — ${flagText}`
    }).join("\n")
    const susFooter = totalPages > 1 ? `\n\n-# Página ${page + 1} de ${totalPages} · Total: ${suspicious.length}` : ""
    susContent = `## 🔍 Usuários Suspeitos\n\n**${suspicious.length}** usuário(s) com atividade suspeita.\n\n${susLines}${susFooter}`
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

  await interaction.editReply({ components: [boxWithRows(susContent, suspicious.length > 0 ? 0xFF4444 : 0x00D166, [row])], flags: C2_FLAG })
}
