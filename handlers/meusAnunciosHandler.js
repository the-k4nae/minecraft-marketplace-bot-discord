/**
 * meusAnunciosHandler.js
 *
 * Painel de gerenciamento dos anúncios do usuário via embed + select menus + modais.
 * Substitui: /editar, /bump, /autobump ativar/desativar/status, /reservar, /cancelarreserva
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
  getUserAllAnnouncements, getAnnouncement, updateAnnouncement, addEditLog, addLog,
  getUserAverageRating, bumpAnnouncement,
  enableAutoBump, disableAutoBump, getAutoBumpStatus,
  createReservation, getActiveReservation, cancelReservationByAnnouncement,
  deleteAnnouncement, deleteFavoritesByAnnouncement,
} from "../utils/database.js"
import { COLORS, formatValor, parseMoney, buildMeusAnunciosC2, buildAnuncioDetailC2, buildPublicAnnouncementC2 } from "../utils/embedBuilder.js"
import { box, text, C2_FLAG, C2_EPHEMERAL } from "../utils/cv2.js"
import { logAction } from "../utils/logger.js"
import { getSkinUrls } from "../utils/minecraftAPI.js"
import { buildFavoriteButton, notifyFavoritersOnBump, notifyFavoritersOnPriceDrop } from "./favoritosHandler.js"

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

const STATUS_LABEL = {
  pending: "⏳ Pendente",
  approved: "✅ Ativo",
  rejected: "❌ Recusado",
  sold: "💸 Vendido",
  expired: "⌛ Expirado",
}

// ─────────────────────────────────────────────
// COMANDO /meusanuncios
// ─────────────────────────────────────────────

export async function handleMeusAnunciosCommand(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const all = getUserAllAnnouncements(interaction.user.id)

  if (all.length === 0) {
    return interaction.editReply({
      components: [box("## 📋 Meus Anúncios\n\nVocê não tem nenhum anúncio registrado.\nUse o painel de tickets para criar um anúncio.", 0x7289DA)],
      flags: C2_FLAG,
    })
  }

  const container = buildMeusAnunciosC2(interaction.user, all)
  const components = buildMeusAnunciosComponents(all)
  await interaction.editReply({ components: [appendRows(container, ...components)], flags: C2_FLAG })
}

function buildMeusAnunciosEmbed(user, all) {
  const active = all.filter((a) => a.status === "approved")
  const pending = all.filter((a) => a.status === "pending")
  const sold = all.filter((a) => a.status === "sold")
  const totalValue = sold.reduce((s, a) => s + parseFloat(a.valor || 0), 0)

  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle("📋 Meus Anúncios")
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setDescription(
      `**Total:** ${all.length}  ·  Ativos: **${active.length}**  ·  Pendentes: **${pending.length}**  ·  Vendidos: **${sold.length}**\n` +
      `💰 Valor total vendido: **R$ ${formatValor(totalValue)}**`
    )
    .setTimestamp()

  for (const a of all.slice(0, 10)) {
    const status = STATUS_LABEL[a.status] || a.status
    const date = new Date(a.created_at).toLocaleDateString("pt-BR")
    const bump = a.bumped_at ? `  ·  Bump: <t:${Math.floor(new Date(a.bumped_at).getTime() / 1000)}:R>` : ""
    // FIX #11: mostrar indicador de auto-bump na lista
    const abStatus = a.status === "approved" ? getAutoBumpStatus(a.id) : null
    const abIcon = abStatus?.active ? "  🔔" : ""
    embed.addFields({
      name: `#${a.id} — ${a.nick} ${status}${abIcon}`,
      value: `R$ ${formatValor(a.valor)}  ·  ${date}${bump}`,
      inline: false,
    })
  }

  if (all.length > 10) embed.setFooter({ text: `Mostrando 10 de ${all.length}` })

  return embed
}

function buildMeusAnunciosComponents(all) {
  const active = all.filter((a) => a.status === "approved" || a.status === "pending")
  const approved = all.filter((a) => a.status === "approved")

  const components = []

  // Select de anúncio ativo para gerenciar
  if (approved.length > 0) {
    const options = approved.slice(0, 25).map((a) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`#${a.id} — ${a.nick}`)
        .setDescription(`R$ ${formatValor(a.valor)}`)
        .setValue(String(a.id))
    )

    const select = new StringSelectMenuBuilder()
      .setCustomId("meusanuncios_select")
      .setPlaceholder("Selecione um anúncio ativo para gerenciar...")
      .addOptions(options)

    components.push(new ActionRowBuilder().addComponents(select))
  }

  // Botão de atualizar
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("meusanuncios_refresh")
      .setLabel("Atualizar")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔄"),
  )

  components.push(row)

  return components
}

// ─────────────────────────────────────────────
// SELECT: anúncio selecionado → mostrar ações
// ─────────────────────────────────────────────

export async function handleMeusAnunciosSelect(interaction, client) {
  const announcementId = parseInt(interaction.values[0])
  const announcement = getAnnouncement(announcementId)

  if (!announcement || announcement.user_id !== interaction.user.id) {
    return interaction.reply({ content: "Anúncio não encontrado ou não é seu.", flags: MessageFlags.Ephemeral })
  }

  await interaction.deferUpdate()

  const reservation = getActiveReservation(announcement.id)
  const autoBump = getAutoBumpStatus(announcement.id)
  const container = buildAnuncioDetailC2(announcement, reservation, autoBump)
  const components = buildAnuncioActionsComponents(announcement)
  await interaction.editReply({ components: [appendRows(container, ...components)], flags: C2_FLAG })
}

function buildAnuncioDetailEmbed(a) {
  const reservation = getActiveReservation(a.id)
  const autoBump = getAutoBumpStatus(a.id)
  const status = STATUS_LABEL[a.status] || a.status

  const bumped = a.bumped_at
    ? `<t:${Math.floor(new Date(a.bumped_at).getTime() / 1000)}:R>`
    : "Nunca"

  return new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle(`📢 Anúncio #${a.id} — ${a.nick}`)
    .setThumbnail(getSkinUrls(a.uuid).avatar)
    .addFields(
      { name: "Status", value: status, inline: true },
      { name: "Valor", value: `R$ ${formatValor(a.valor)}`, inline: true },
      { name: "Nick", value: a.nick, inline: true },
      { name: "VIPs", value: a.vips || "Nenhum", inline: true },
      { name: "Capas", value: a.capas || "Nenhuma", inline: true },
      { name: "Tags", value: a.tags || "Nenhuma", inline: true },
      { name: "Último Bump", value: bumped, inline: true },
      { name: "Auto-Bump", value: autoBump?.active ? "✅ Ativo" : "❌ Inativo", inline: true },
      {
        name: "Reserva",
        value: reservation
          ? `Reservado para <@${reservation.buyer_id}> até <t:${Math.floor(new Date(reservation.expires_at).getTime() / 1000)}:R>`
          : "Sem reserva",
        inline: false,
      },
    )
    .setTimestamp()
}

function buildAnuncioActionsComponents(a) {
  const autoBump = getAutoBumpStatus(a.id)
  const reservation = getActiveReservation(a.id)
  const isActive = a.status === "approved"
  const isDeletable = a.status !== "sold" // não pode deletar anúncio já vendido

  // Verificar cooldown de bump (24h)
  const lastBump = a.bumped_at || a.approved_at || a.created_at
  const hoursSince = (Date.now() - new Date(lastBump).getTime()) / (1000 * 60 * 60)
  const bumpAvailable = hoursSince >= 24 && isActive

  // Select Menu para ações (substituí 5-6 botões em 2 rows)
  const options = []
  if (isActive) options.push(
    new StringSelectMenuOptionBuilder().setLabel("✏️ Editar Anúncio").setDescription("Alterar preço ou informações").setValue(`man_edit_${a.id}`),
  )
  if (bumpAvailable) options.push(
    new StringSelectMenuOptionBuilder().setLabel("📤 Dar Bump").setDescription("Subir o anúncio para o topo").setValue(`man_bump_${a.id}`),
  )
  if (isActive) options.push(
    new StringSelectMenuOptionBuilder()
      .setLabel(reservation ? "🔓 Cancelar Reserva" : "🔒 Reservar para Comprador")
      .setDescription(reservation ? "Remover reserva atual" : "Reservar para um usuário específico")
      .setValue(`man_reserve_${a.id}`),
    new StringSelectMenuOptionBuilder()
      .setLabel(autoBump?.active ? "🔕 Desativar Auto-Bump" : "🔔 Ativar Auto-Bump")
      .setDescription(autoBump?.active ? "Desligar bump automático diário" : "Ligar bump automático diário")
      .setValue(autoBump?.active ? `man_autobump_off_${a.id}` : `man_autobump_on_${a.id}`),
  )
  if (isDeletable) options.push(
    new StringSelectMenuOptionBuilder().setLabel("🗑️ Deletar Anúncio").setDescription("Remover anúncio permanentemente").setValue(`man_delete_${a.id}`),
  )

  const backRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("meusanuncios_back").setLabel("◀️ Voltar").setStyle(ButtonStyle.Secondary),
  )

  if (options.length === 0) return [backRow]

  const selectRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`man_actions_${a.id}`)
      .setPlaceholder("⚙️ Ações do anúncio...")
      .addOptions(options)
  )
  return [selectRow, backRow]
}

// ─────────────────────────────────────────────
// BOTÕES DE AÇÃO DO ANÚNCIO
// ─────────────────────────────────────────────

export async function handleManageAnuncioButton(interaction, action, announcementId, client) {
  const announcement = getAnnouncement(announcementId)

  if (!announcement || announcement.user_id !== interaction.user.id) {
    return interaction.reply({ content: "Anúncio não encontrado ou não é seu.", flags: MessageFlags.Ephemeral })
  }

  if (action === "edit") {
    await showEditModal(interaction, announcement)

  } else if (action === "bump") {
    await handleBump(interaction, announcement, client)

  } else if (action === "reserve") {
    const existing = getActiveReservation(announcementId)
    if (existing) {
      await handleCancelReserve(interaction, announcement, client)
    } else {
      await showReserveModal(interaction, announcement)
    }

  } else if (action === "autobump_on") {
    await interaction.deferUpdate()
    enableAutoBump(announcementId, interaction.user.id)
    addLog("autobump_enabled", interaction.user.id, announcementId.toString(), announcement.nick)
    const freshAnn = getAnnouncement(announcementId)
    const detailContainer = buildAnuncioDetailC2(freshAnn, getActiveReservation(freshAnn.id), getAutoBumpStatus(freshAnn.id))
    const components = buildAnuncioActionsComponents(freshAnn)
    await interaction.editReply({ components: [appendRows(detailContainer, ...components)], flags: C2_FLAG })
    await interaction.followUp({
      content: `✅ Auto-bump ativado para **${announcement.nick}**! Será bumped a cada 24h automaticamente.`,
      flags: MessageFlags.Ephemeral,
    })

  } else if (action === "autobump_off") {
    await interaction.deferUpdate()
    disableAutoBump(announcementId)
    addLog("autobump_disabled", interaction.user.id, announcementId.toString(), announcement.nick)
    const freshAnn = getAnnouncement(announcementId)
    const detailContainer = buildAnuncioDetailC2(freshAnn, getActiveReservation(freshAnn.id), getAutoBumpStatus(freshAnn.id))
    const components = buildAnuncioActionsComponents(freshAnn)
    await interaction.editReply({ components: [appendRows(detailContainer, ...components)], flags: C2_FLAG })
    await interaction.followUp({
      content: `❌ Auto-bump desativado para **${announcement.nick}**.`,
      flags: MessageFlags.Ephemeral,
    })

  } else if (action === "delete") {
    // Confirmação antes de deletar
    await interaction.deferUpdate()
    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`man_deleteconfirm_${announcementId}`)
        .setLabel("✅ Sim, deletar")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`man_deletecanceled_${announcementId}`)
        .setLabel("❌ Cancelar")
        .setStyle(ButtonStyle.Secondary),
    )
    await interaction.editReply({
      embeds: [],
      components: [confirmRow],
      content: `⚠️ Tem certeza que deseja **deletar** o anúncio #${announcementId} — **${announcement.nick}**?\nEsta ação não pode ser desfeita.`,
    })

  } else if (action === "deleteconfirm") {
    await interaction.deferUpdate()
    if (announcement.status === "sold") {
      return interaction.editReply({ content: "❌ Não é possível deletar um anúncio já vendido.", components: [], embeds: [] })
    }

    // FIX BUG-9: Verificar se há negociações ativas antes de deletar o anúncio.
    // Deletar um anúncio com negociação ativa deixava os canais de negociação órfãos.
    try {
      const { getUserActiveNegotiations } = await import("../utils/database.js")
      const activeNegs = getUserActiveNegotiations(announcement.user_id)
      const hasActiveNeg = activeNegs.some(n => n.announcement_id === announcementId)
      if (hasActiveNeg) {
        return interaction.editReply({
          content: "❌ Não é possível deletar um anúncio que possui **negociação ativa**. Aguarde a conclusão ou cancelamento da negociação antes de deletar.",
          components: [],
          embeds: [],
        })
      }
    } catch { /* verificação opcional — prosseguir */ }

    // Remover mensagem do canal de anúncios se existir
    if (announcement.message_id && client.config.channels.anuncios) {
      try {
        const annChannel = await client.channels.fetch(client.config.channels.anuncios)
        const msg = await annChannel.messages.fetch(announcement.message_id).catch(() => null)
        if (msg) await msg.delete().catch(() => {})
      } catch { /* ok */ }
    }

    deleteAnnouncement(announcementId)
    deleteFavoritesByAnnouncement(announcementId)
    disableAutoBump(announcementId)
    addLog("announcement_deleted", interaction.user.id, announcementId.toString(), `Nick: ${announcement.nick}`)

    await logAction(client, "announcement_deleted", {
      userId: interaction.user.id,
      details: `**Anúncio #${announcementId}** — ${announcement.nick} deletado pelo próprio vendedor.`,
    })

    // Voltar para lista atualizada
    const all = getUserAllAnnouncements(interaction.user.id)
    const listContainer = buildMeusAnunciosC2(interaction.user, all)
    const components = buildMeusAnunciosComponents(all)
    await interaction.editReply({
      content: `✅ Anúncio **#${announcementId} — ${announcement.nick}** deletado com sucesso.`,
      components: [appendRows(listContainer, ...components)],
      flags: C2_FLAG,
    })

  } else if (action === "deletecanceled") {
    await interaction.deferUpdate()
    const fresh = getAnnouncement(announcementId)
    if (!fresh) {
      const all = getUserAllAnnouncements(interaction.user.id)
      const _lc = buildMeusAnunciosC2(interaction.user, all)
      return interaction.editReply({ components: [_lc, ...buildMeusAnunciosComponents(all)], flags: C2_FLAG })
    }
    const freshContainer = buildAnuncioDetailC2(fresh, getActiveReservation(fresh.id), getAutoBumpStatus(fresh.id))
    const components = buildAnuncioActionsComponents(fresh)
    await interaction.editReply({ components: [appendRows(freshContainer, ...components)], flags: C2_FLAG })
  }
}

// VOLTAR para lista
export async function handleMeusAnunciosBack(interaction, client) {
  await interaction.deferUpdate()
  const all = getUserAllAnnouncements(interaction.user.id)
  const listC = buildMeusAnunciosC2(interaction.user, all)
  const components = buildMeusAnunciosComponents(all)
  await interaction.editReply({ components: [appendRows(listC, ...components)], flags: C2_FLAG })
}

// REFRESH
export async function handleMeusAnunciosRefresh(interaction, client) {
  await interaction.deferUpdate()
  const all = getUserAllAnnouncements(interaction.user.id)
  const listC2 = buildMeusAnunciosC2(interaction.user, all)
  const components = buildMeusAnunciosComponents(all)
  await interaction.editReply({ components: [appendRows(listC2, ...components)], flags: C2_FLAG })
}

// ─────────────────────────────────────────────
// EDITAR ANÚNCIO
// ─────────────────────────────────────────────

async function showEditModal(interaction, announcement) {
  const modal = new ModalBuilder()
    .setCustomId(`man_edit_submit_${announcement.id}`)
    .setTitle(`Editar #${announcement.id} — ${announcement.nick}`)

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("valor")
        .setLabel("Valor (R$) — deixe em branco para manter")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`Atual: R$ ${formatValor(announcement.valor)}`)
        .setRequired(false)
        .setMaxLength(10)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("vips")
        .setLabel("VIPs/Ranks — deixe em branco para manter")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`Atual: ${announcement.vips || "Nenhum"}`)
        .setRequired(false)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("capas")
        .setLabel("Capas — deixe em branco para manter")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder(`Atual: ${announcement.capas || "Nenhuma"}`)
        .setRequired(false)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("bans")
        .setLabel("Banimentos (em branco = manter)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(`Atual: ${announcement.bans || "Nenhum"}`)
        .setRequired(false)
        .setMaxLength(300)
    ),
  )

  await interaction.showModal(modal)
}

export async function handleEditSubmit(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const announcementId = parseInt(params[0])
  const announcement = getAnnouncement(announcementId)
  const config = client.config

  if (!announcement) return interaction.editReply({ content: "Anúncio não encontrado." })

  if (announcement.user_id !== interaction.user.id && !interaction.member.roles.cache.has(config.roles.staff)) {
    return interaction.editReply({ content: "Você só pode editar seus próprios anúncios." })
  }

  if (!["approved", "pending"].includes(announcement.status)) {
    return interaction.editReply({ content: "Este anúncio não pode ser editado (vendido/expirado/recusado)." })
  }

  const changes = {}

  const valorRaw = interaction.fields.getTextInputValue("valor").trim()
  if (valorRaw) {
    const num = parseMoney(valorRaw)
    if (num === null || num <= 0 || num > 999999) return interaction.editReply({ content: "❌ Valor inválido. Use ex: 300 ou 1.500,00" })
    changes.valor = num.toFixed(2)
  }

  const vips = interaction.fields.getTextInputValue("vips").trim()
  if (vips) changes.vips = vips

  const capas = interaction.fields.getTextInputValue("capas").trim()
  if (capas) changes.capas = capas

  const bans = interaction.fields.getTextInputValue("bans").trim()
  if (bans) changes.bans = bans

  if (Object.keys(changes).length === 0) {
    return interaction.editReply({ content: "Nenhum campo foi alterado." })
  }

  updateAnnouncement(announcementId, changes)

  if (changes.valor && announcement.status === "approved") {
    notifyFavoritersOnPriceDrop(client, getAnnouncement(announcementId), announcement.valor).catch(() => {})
  }

  for (const [campo, newValue] of Object.entries(changes)) {
    const oldValue = announcement[campo] || "N/A"
    addEditLog(announcementId, interaction.user.id, { campo, oldValue, newValue })
    addLog("announcement_edited", interaction.user.id, announcementId.toString(), `Campo: ${campo} | ${oldValue} -> ${newValue}`)
  }

  // Atualizar embed no canal de anúncios se ativo
  if (announcement.status === "approved" && announcement.message_id) {
    try {
      const announcementChannel = await client.channels.fetch(config.channels.anuncios)
      const message = await announcementChannel.messages.fetch(announcement.message_id)
      const updated = getAnnouncement(announcementId)
      const seller = await client.users.fetch(updated.user_id)
      const sellerRating = getUserAverageRating(updated.user_id)

      const publicContainer = buildPublicAnnouncementC2(updated, seller, sellerRating)
      // FIX M-3: manter botões de interesse/favoritar ao editar container
      // Componentes fetchados expõem .type diretamente (não .data.type)
      // ComponentType.Container = 17, ComponentType.ActionRow = 1
      const existingRows = message.components.filter(c => (c.type ?? c.data?.type) !== 17)
      const interestRow = existingRows.length > 0 ? existingRows : [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`interest_${announcementId}`).setLabel("Tenho Interesse").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setURL(`https://namemc.com/profile/${updated.uuid}`).setLabel("Ver no NameMC").setStyle(ButtonStyle.Link),
          buildFavoriteButton(announcementId),
        )
      ]
      await message.edit({
        components: [publicContainer, ...interestRow],
        flags: C2_FLAG,
      })
    } catch (e) {
      console.error("[EDITAR] Erro ao atualizar embed:", e.message)
    }
  }

  await logAction(client, "announcement_edited", {
    userId: interaction.user.id,
    targetId: announcementId.toString(),
    details: Object.entries(changes).map(([k, v]) => `**${k}:** ${announcement[k] || "N/A"} → ${v}`).join("\n"),
  })

  const fieldsChanged = Object.entries(changes).map(([k, v]) => ({
    name: k,
    value: `${announcement[k] || "N/A"} → **${v}**`,
    inline: true,
  }))

  const changedText = fieldsChanged.map(f => `**${f.name}:** ${f.value}`).join("\n")
  await interaction.editReply({
    components: [box(`## ✅ Anúncio Editado\n\nAnúncio **#${announcementId}** atualizado com sucesso.\n\n${changedText}`, 0x00D166)],
    flags: C2_EPHEMERAL,
  })
}

// ─────────────────────────────────────────────
// BUMP MANUAL
// ─────────────────────────────────────────────

async function handleBump(interaction, announcement, client) {
  await interaction.deferUpdate()

  const config = client.config

  const lastBump = announcement.bumped_at || announcement.approved_at || announcement.created_at
  const hoursSince = (Date.now() - new Date(lastBump).getTime()) / (1000 * 60 * 60)

  if (hoursSince < 24) {
    const remaining = Math.ceil(24 - hoursSince)
    return interaction.followUp({
      content: `⏰ Você só pode fazer bump a cada 24 horas. Aguarde mais **${remaining}h**.`,
      flags: MessageFlags.Ephemeral,
    })
  }

  try {
    const announcementChannel = await client.channels.fetch(config.channels.anuncios)
    try {
      const old = await announcementChannel.messages.fetch(announcement.message_id)
      await old.delete()
    } catch { /* ok */ }

    const seller = await client.users.fetch(announcement.user_id)
    const sellerRating = getUserAverageRating(announcement.user_id)
    const namemc = `https://namemc.com/profile/${announcement.uuid}`

    const publicContainer = buildPublicAnnouncementC2(announcement, seller, sellerRating)
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`interest_${announcement.id}`).setLabel("Tenho Interesse").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setURL(namemc).setLabel("Ver no NameMC").setStyle(ButtonStyle.Link),
      buildFavoriteButton(announcement.id),
    )

    const newMsg = await announcementChannel.send({ components: [appendRows(publicContainer, row)], flags: C2_FLAG })
    announcement.message_id = newMsg.id
    bumpAnnouncement(announcement.id)
    updateAnnouncement(announcement.id, { message_id: newMsg.id })
    notifyFavoritersOnBump(client, getAnnouncement(announcement.id)).catch(() => {})

    // Atualizar embed do painel
    const fresh = getAnnouncement(announcement.id)
    const bumpDetailC = buildAnuncioDetailC2(fresh, getActiveReservation(fresh.id), getAutoBumpStatus(fresh.id))
    const components = buildAnuncioActionsComponents(fresh)
    await interaction.editReply({ components: [appendRows(bumpDetailC, ...components)], flags: C2_FLAG })

    await interaction.followUp({
      content: `📤 Seu anúncio de **${announcement.nick}** foi bumped com sucesso!`,
      flags: MessageFlags.Ephemeral,
    })
  } catch (e) {
    console.error("[BUMP] Erro:", e)
    await interaction.followUp({ content: "❌ Erro ao fazer bump do anúncio.", flags: MessageFlags.Ephemeral })
  }
}

// ─────────────────────────────────────────────
// RESERVA
// ─────────────────────────────────────────────

async function showReserveModal(interaction, announcement) {
  const modal = new ModalBuilder()
    .setCustomId(`man_reserve_submit_${announcement.id}`)
    .setTitle(`Reservar #${announcement.id} — ${announcement.nick}`)

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("buyer_id")
        .setLabel("ID do Discord do Comprador")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 123456789012345678")
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("hours")
        .setLabel("Duração da Reserva (horas, max 72)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 24")
        .setRequired(true)
        .setMaxLength(3)
    ),
  )

  await interaction.showModal(modal)
}

export async function handleReserveSubmit(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const announcementId = parseInt(params[0])
  const announcement = getAnnouncement(announcementId)

  if (!announcement) return interaction.editReply({ content: "Anúncio não encontrado." })
  if (announcement.user_id !== interaction.user.id) return interaction.editReply({ content: "Apenas o dono pode reservar." })
  if (announcement.status !== "approved") return interaction.editReply({ content: "Apenas anúncios ativos podem ser reservados." })

  const existing = getActiveReservation(announcementId)
  if (existing) return interaction.editReply({ content: `Este anúncio já está reservado para <@${existing.buyer_id}>.` })

  const buyerId = interaction.fields.getTextInputValue("buyer_id").replace(/[^0-9]/g, "")
  const hoursRaw = parseInt(interaction.fields.getTextInputValue("hours"))
  const hours = isNaN(hoursRaw) || hoursRaw < 1 ? 24 : Math.min(hoursRaw, 72)

  let buyer
  try {
    buyer = await client.users.fetch(buyerId)
  } catch {
    return interaction.editReply({ content: "❌ ID do Discord inválido." })
  }

  const reservation = createReservation(announcementId, interaction.user.id, buyerId, hours)
  const expiresAt = Math.floor(new Date(reservation.expires_at).getTime() / 1000)

  // Desativar botão de interesse no canal
  try {
    const config = client.config
    const ch = await client.channels.fetch(config.channels.anuncios)
    const msg = await ch.messages.fetch(announcement.message_id)
    const namemc = `https://namemc.com/profile/${announcement.uuid}`
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`interest_${announcementId}`).setLabel("RESERVADO").setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setURL(namemc).setLabel("Ver no NameMC").setStyle(ButtonStyle.Link),
    )
    await msg.edit({ components: [row] })
  } catch { /* ok */ }

  try {
    await buyer.send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLORS.SUCCESS)
          .setTitle("🔒 Conta Reservada Para Você!")
          .setDescription(`${interaction.user.tag} reservou a conta **${announcement.nick}** para você por ${hours} hora(s)!\n\n**Valor:** R$ ${formatValor(announcement.valor)}\n**Expira:** <t:${expiresAt}:R>`)
          .setTimestamp(),
      ],
    })
  } catch { /* DM fechada */ }

  addLog("reservation_created", interaction.user.id, announcementId.toString(), `Para: ${buyerId} por ${hours}h`)

  await interaction.editReply({
    components: [box(
      `## 🔒 Anúncio Reservado\n\nA conta **${announcement.nick}** foi reservada para ${buyer} por ${hours} hora(s).\n\n` +
      `**Expira:** <t:${expiresAt}:R>   **Reservado para:** ${buyer.tag}`,
      0x00D166
    )],
    flags: C2_EPHEMERAL,
  })
}

async function handleCancelReserve(interaction, announcement, client) {
  await interaction.deferUpdate()

  const reservation = getActiveReservation(announcement.id)
  if (!reservation) {
    return interaction.followUp({ content: "Este anúncio não tem reserva ativa.", flags: MessageFlags.Ephemeral })
  }

  cancelReservationByAnnouncement(announcement.id)

  // Reativar botão no canal
  try {
    const config = client.config
    const ch = await client.channels.fetch(config.channels.anuncios)
    const msg = await ch.messages.fetch(announcement.message_id)
    const namemc = `https://namemc.com/profile/${announcement.uuid}`
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`interest_${announcement.id}`).setLabel("Tenho Interesse").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setURL(namemc).setLabel("Ver no NameMC").setStyle(ButtonStyle.Link),
      buildFavoriteButton(announcement.id),
    )
    await msg.edit({ components: [row] })
  } catch { /* ok */ }

  addLog("reservation_cancelled", interaction.user.id, announcement.id.toString(), "Cancelado manualmente")

  // Atualizar embed do painel
  const fresh = getAnnouncement(announcement.id)
  const cancelResC = buildAnuncioDetailC2(fresh, getActiveReservation(fresh.id), getAutoBumpStatus(fresh.id))
  const components = buildAnuncioActionsComponents(fresh)
  await interaction.editReply({ components: [appendRows(cancelResC, ...components)], flags: C2_FLAG })

  await interaction.followUp({
    content: `✅ Reserva da conta **${announcement.nick}** cancelada. Anúncio disponível novamente.`,
    flags: MessageFlags.Ephemeral,
  })
}

// ─────────────────────────────────────────────
// SELECT MENU: man_actions_<id> → roteamento de ações do anúncio
// ─────────────────────────────────────────────

export async function handleManActionsSelect(interaction, announcementId, client) {
  const value = interaction.values[0]
  const parts = value.split("_")
  const action = parts.slice(1, -1).join("_") // e.g. "edit", "bump", "reserve", "autobump_on/off", "delete"

  await handleManageAnuncioButton(interaction, action, parseInt(parts[parts.length - 1]), client)
}
