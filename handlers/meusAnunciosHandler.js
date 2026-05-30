/**
 * meusAnunciosHandler.js
 *
 * Painel de gerenciamento dos anúncios do usuário via embed + select menus + modais.
 * Substitui: /editar, /bump, /autobump ativar/desativar/status, /reservar, /cancelarreserva
 */

import {
  ActionRowBuilder,
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
  getUserActiveNegotiations,
} from "../utils/database.js"
import {
  CV2, CV2_EPHEMERAL, container, text, separator, section, thumbnail,
  createRow, createButton, createLinkButton, buildPublicAnnouncement,
  formatValor, parseMoney, COLORS,
} from "../utils/components.js"
import { logAction } from "../utils/logger.js"
import { fileLog } from "../utils/fileLogger.js"
import { getPlayerUUID, getSkinUrls } from "../utils/minecraftAPI.js"
import { notifyFavoritersOnBump, notifyFavoritersOnPriceDrop } from "./favoritosHandler.js"
import { handlePhotoEditButton } from "./photoEdit.js"

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
    const c = container(COLORS.INFO)
      .addTextDisplayComponents(text("## 📋 Meus Anúncios\nVocê não tem nenhum anúncio registrado.\nUse o painel de tickets para criar um anúncio."))
    return interaction.editReply({ flags: CV2, components: [c] })
  }

  const panel = buildMeusAnunciosPanel(interaction.user, all)
  await interaction.editReply({ flags: CV2, components: [panel] })
}

function buildMeusAnunciosPanel(user, all) {
  const active = all.filter((a) => a.status === "approved")
  const pending = all.filter((a) => a.status === "pending")
  const sold = all.filter((a) => a.status === "sold")
  const totalValue = sold.reduce((s, a) => s + parseFloat(a.valor || 0), 0)

  let items = ""
  for (const a of all.slice(0, 10)) {
    const status = STATUS_LABEL[a.status] || a.status
    const date = new Date(a.created_at).toLocaleDateString("pt-BR")
    const bump = a.bumped_at ? `  ·  Bump: <t:${Math.floor(new Date(a.bumped_at).getTime() / 1000)}:R>` : ""
    const abStatus = a.status === "approved" ? getAutoBumpStatus(a.id) : null
    const abIcon = abStatus?.active ? "  🔔" : ""
    items += `**#${a.id} — ${a.nick} ${status}${abIcon}**\nR$ ${formatValor(a.valor)}  ·  ${date}${bump}\n`
  }
  if (all.length > 10) items += `\n-# Mostrando 10 de ${all.length}`

  const c = container(COLORS.PRIMARY)
    .addSectionComponents(section(
      `## 📋 Meus Anúncios\n**Total:** ${all.length}  ·  Ativos: **${active.length}**  ·  Pendentes: **${pending.length}**  ·  Vendidos: **${sold.length}**\n💰 Valor total vendido: **R$ ${formatValor(totalValue)}**`,
      thumbnail(user.displayAvatarURL({ extension: "webp", forceStatic: false }), user.username || "Avatar")
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(items))

  if (active.length > 0) {
    const options = active.slice(0, 25).map((a) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`#${a.id} — ${a.nick}`)
        .setDescription(`R$ ${formatValor(a.valor)}`)
        .setValue(String(a.id))
    )
    const select = new StringSelectMenuBuilder()
      .setCustomId("meusanuncios_select")
      .setPlaceholder("Selecione um anúncio ativo para gerenciar...")
      .addOptions(options)
    c.addActionRowComponents(new ActionRowBuilder().addComponents(select))
  }

  c.addActionRowComponents(createRow(
    createButton({ customId: "meusanuncios_refresh", label: "Atualizar", style: ButtonStyle.Secondary })
  ))

  return c
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
  const panel = buildAnuncioDetailPanel(announcement)
  await interaction.editReply({ flags: CV2, components: [panel], embeds: [], content: null })
}

function buildAnuncioDetailPanel(a) {
  const reservation = getActiveReservation(a.id)
  const autoBump = getAutoBumpStatus(a.id)
  const status = STATUS_LABEL[a.status] || a.status
  const isActive = a.status === "approved"
  const isDeletable = a.status !== "sold"

  const bumped = a.bumped_at
    ? `<t:${Math.floor(new Date(a.bumped_at).getTime() / 1000)}:R>`
    : "Nunca"

  const reserveText = reservation
    ? `Reservado para <@${reservation.buyer_id}> até <t:${Math.floor(new Date(reservation.expires_at).getTime() / 1000)}:R>`
    : "Sem reserva"

  const avatarUrl = a.uuid ? getSkinUrls(a.uuid).avatar : null

  const detailLines =
    `## 📢 Anúncio #${a.id} — ${a.nick}\n` +
    `**Status:** ${status}  ·  **Valor:** R$ ${formatValor(a.valor)}\n` +
    `**Nick:** ${a.nick}  ·  **VIPs:** ${a.vips || "Nenhum"}\n` +
    `**Capas:** ${a.capas || "Nenhuma"}  ·  **Tags:** ${a.tags || "Nenhuma"}\n` +
    `**Último Bump:** ${bumped}  ·  **Auto-Bump:** ${autoBump?.active ? "✅ Ativo" : "❌ Inativo"}\n` +
    `**Reserva:** ${reserveText}`

  const c = container(COLORS.PRIMARY)
  if (avatarUrl) {
    c.addSectionComponents(section(detailLines, thumbnail(avatarUrl, a.nick || "Skin")))
  } else {
    c.addTextDisplayComponents(text(detailLines))
  }

  // Bump cooldown
  const lastBump = a.bumped_at || a.approved_at || a.created_at
  const hoursSince = (Date.now() - new Date(lastBump).getTime()) / (1000 * 60 * 60)
  const bumpAvailable = hoursSince >= 24 && isActive
  const bumpHoursLeft = bumpAvailable ? 0 : Math.ceil(24 - hoursSince)

  c.addActionRowComponents(
    createRow(
      createButton({ customId: `man_edit_${a.id}`,       label: "✏️ Editar Dados",    style: ButtonStyle.Primary,    disabled: !isActive }),
      createButton({ customId: `man_editextras_${a.id}`, label: "✏️ Editar Extras",   style: ButtonStyle.Primary,    disabled: !isActive }),
      createButton({ customId: `man_bump_${a.id}`,       label: bumpAvailable ? "📤 Bump" : `📤 Bump (${bumpHoursLeft}h)`, style: ButtonStyle.Secondary, disabled: !bumpAvailable }),
      createButton({ customId: `man_reserve_${a.id}`,   label: reservation ? "🔒 Cancelar Reserva" : "🔒 Reservar", style: reservation ? ButtonStyle.Danger : ButtonStyle.Success, disabled: !isActive }),
      createButton({ customId: `man_photo_${a.id}`,      label: "📷 Trocar Foto",     style: ButtonStyle.Secondary, disabled: !(["approved", "pending"].includes(a.status)) }),
    ),
    createRow(
      createButton({ customId: autoBump?.active ? `man_autobump_off_${a.id}` : `man_autobump_on_${a.id}`, label: autoBump?.active ? "🔕 Desativar Auto-Bump" : "🔔 Ativar Auto-Bump", style: autoBump?.active ? ButtonStyle.Danger : ButtonStyle.Success, disabled: !isActive }),
      createButton({ customId: "meusanuncios_back", label: "◀️ Voltar", style: ButtonStyle.Secondary }),
      ...(isDeletable ? [createButton({ customId: `man_delete_${a.id}`, label: "🗑️ Deletar", style: ButtonStyle.Danger })] : []),
    ),
  )

  return c
}

// ─────────────────────────────────────────────
// BOTÕES DE AÇÃO DO ANÚNCIO
// ─────────────────────────────────────────────

export async function handleManageAnuncioButton(interaction, action, announcementId, client) {
  const announcement = getAnnouncement(announcementId)

  if (!announcement || announcement.user_id !== interaction.user.id) {
    return interaction.reply({ content: "Anúncio não encontrado ou não é seu.", flags: MessageFlags.Ephemeral })
  }

  if (action === "photo") {
    return handlePhotoEditButton(interaction, announcementId, client)

  } else if (action === "edit") {
    await showEditModal(interaction, announcement)

  } else if (action === "editextras") {
    await showEditExtrasModal(interaction, announcement)

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
    const panel = buildAnuncioDetailPanel(getAnnouncement(announcementId))
    await interaction.editReply({ flags: CV2, components: [panel], embeds: [], content: null })
    await interaction.followUp({
      content: `✅ Auto-bump ativado para **${announcement.nick}**! Será bumped a cada 24h automaticamente.`,
      flags: MessageFlags.Ephemeral,
    })

  } else if (action === "autobump_off") {
    await interaction.deferUpdate()
    disableAutoBump(announcementId)
    addLog("autobump_disabled", interaction.user.id, announcementId.toString(), announcement.nick)
    const panel = buildAnuncioDetailPanel(getAnnouncement(announcementId))
    await interaction.editReply({ flags: CV2, components: [panel], embeds: [], content: null })
    await interaction.followUp({
      content: `❌ Auto-bump desativado para **${announcement.nick}**.`,
      flags: MessageFlags.Ephemeral,
    })

  } else if (action === "delete") {
    await interaction.deferUpdate()
    const dc = container(COLORS.DANGER)
      .addTextDisplayComponents(text(`## ⚠️ Confirmar Exclusão\nTem certeza que deseja **deletar** o anúncio #${announcementId} — **${announcement.nick}**?\nEsta ação não pode ser desfeita.`))
      .addActionRowComponents(createRow(
        createButton({ customId: `man_deleteconfirm_${announcementId}`, label: "✅ Sim, deletar", style: ButtonStyle.Danger }),
        createButton({ customId: `man_deletecanceled_${announcementId}`, label: "❌ Cancelar", style: ButtonStyle.Secondary }),
      ))
    await interaction.editReply({ flags: CV2, components: [dc], embeds: [], content: null })

  } else if (action === "deleteconfirm") {
    await interaction.deferUpdate()
    if (announcement.status === "sold") {
      return interaction.editReply({ content: "❌ Não é possível deletar um anúncio já vendido.", components: [], embeds: [] })
    }

    // FIX BUG-9: Verificar se há negociações ativas antes de deletar o anúncio.
    // Deletar um anúncio com negociação ativa deixava os canais de negociação órfãos.
    try {
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
    const panel = buildMeusAnunciosPanel(interaction.user, all)
    const sc = container(COLORS.SUCCESS)
      .addTextDisplayComponents(text(`✅ Anúncio **#${announcementId} — ${announcement.nick}** deletado com sucesso.`))
    await interaction.editReply({ flags: CV2, components: [sc, panel], embeds: [], content: null })

  } else if (action === "deletecanceled") {
    await interaction.deferUpdate()
    const fresh = getAnnouncement(announcementId)
    if (!fresh) {
      const all = getUserAllAnnouncements(interaction.user.id)
      const panel = buildMeusAnunciosPanel(interaction.user, all)
      return interaction.editReply({ flags: CV2, components: [panel], embeds: [], content: null })
    }
    const panel = buildAnuncioDetailPanel(fresh)
    await interaction.editReply({ flags: CV2, components: [panel], embeds: [], content: null })
  }
}

// VOLTAR para lista
export async function handleMeusAnunciosBack(interaction, client) {
  await interaction.deferUpdate()
  const all = getUserAllAnnouncements(interaction.user.id)
  const panel = buildMeusAnunciosPanel(interaction.user, all)
  await interaction.editReply({ flags: CV2, components: [panel], embeds: [], content: null })
}

// REFRESH
export async function handleMeusAnunciosRefresh(interaction, client) {
  await interaction.deferUpdate()
  const all = getUserAllAnnouncements(interaction.user.id)
  const panel = buildMeusAnunciosPanel(interaction.user, all)
  await interaction.editReply({ flags: CV2, components: [panel], embeds: [], content: null })
}

// ─────────────────────────────────────────────
// EDITAR ANÚNCIO
// ─────────────────────────────────────────────

async function showEditModal(interaction, announcement) {
  const modal = new ModalBuilder()
    .setCustomId(`man_edit_submit_${announcement.id}`)
    .setTitle(`Editar #${announcement.id} — Dados`)

  const valorInput = new TextInputBuilder()
    .setCustomId("valor")
    .setLabel("Valor (R$)")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Ex: 150.00")
    .setRequired(false)
    .setMaxLength(10)
  if (announcement.valor) valorInput.setValue(String(parseFloat(announcement.valor).toFixed(2)))

  const vipsInput = new TextInputBuilder()
    .setCustomId("vips")
    .setLabel("VIPs/Ranks")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Ex: VIP+, MVP++")
    .setRequired(false)
    .setMaxLength(100)
  if (announcement.vips && announcement.vips !== "Nenhum") vipsInput.setValue(announcement.vips)

  const capasInput = new TextInputBuilder()
    .setCustomId("capas")
    .setLabel("Capas")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Ex: Minecon 2016, Migratoria")
    .setRequired(false)
    .setMaxLength(100)
  if (announcement.capas && announcement.capas !== "Nenhuma") capasInput.setValue(announcement.capas)

  const bansInput = new TextInputBuilder()
    .setCustomId("bans")
    .setLabel("Banimentos")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Ex: Nunca foi banido")
    .setRequired(false)
    .setMaxLength(300)
  if (announcement.bans) bansInput.setValue(announcement.bans)

  modal.addComponents(
    new ActionRowBuilder().addComponents(valorInput),
    new ActionRowBuilder().addComponents(vipsInput),
    new ActionRowBuilder().addComponents(capasInput),
    new ActionRowBuilder().addComponents(bansInput),
  )
  await interaction.showModal(modal)
}

async function showEditExtrasModal(interaction, announcement) {
  const modal = new ModalBuilder()
    .setCustomId(`man_editextras_submit_${announcement.id}`)
    .setTitle(`Editar #${announcement.id} — Extras`)

  const tagsInput = new TextInputBuilder()
    .setCustomId("tags")
    .setLabel("Tags Especiais")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Ex: [MVP], [LEGEND]")
    .setRequired(false)
    .setMaxLength(100)
  if (announcement.tags) tagsInput.setValue(announcement.tags)

  const medalhasInput = new TextInputBuilder()
    .setCustomId("medalhas")
    .setLabel("Medalhas")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Ex: Top 10 Bedwars")
    .setRequired(false)
    .setMaxLength(100)
  if (announcement.medalhas) medalhasInput.setValue(announcement.medalhas)

  const winsInput = new TextInputBuilder()
    .setCustomId("wins_level")
    .setLabel("Wins / Level")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Ex: 5000 wins, Level 250")
    .setRequired(false)
    .setMaxLength(100)
  if (announcement.wins_level) winsInput.setValue(announcement.wins_level)

  const cosInput = new TextInputBuilder()
    .setCustomId("cosmeticos")
    .setLabel("Cosmeticos")
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Ex: Todas as dancas, 50+ skins")
    .setRequired(false)
    .setMaxLength(500)
  if (announcement.cosmeticos) cosInput.setValue(announcement.cosmeticos)

  modal.addComponents(
    new ActionRowBuilder().addComponents(tagsInput),
    new ActionRowBuilder().addComponents(medalhasInput),
    new ActionRowBuilder().addComponents(winsInput),
    new ActionRowBuilder().addComponents(cosInput),
  )
  await interaction.showModal(modal)
}
export async function handleEditSubmit(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const isExtras = params[0] === "extras"
  const announcementId = parseInt(isExtras ? params[1] : params[0])
  const announcement = getAnnouncement(announcementId)
  const config = client.config

  if (!announcement) return interaction.editReply({ content: "Anuncio nao encontrado." })

  if (announcement.user_id !== interaction.user.id && !interaction.member.roles.cache.has(config.roles.staff)) {
    return interaction.editReply({ content: "Voce so pode editar seus proprios anuncios." })
  }

  if (!["approved", "pending"].includes(announcement.status)) {
    return interaction.editReply({ content: "Este anuncio nao pode ser editado (vendido/expirado/recusado)." })
  }

  const changes = {}

  if (isExtras) {
    const tags = interaction.fields.getTextInputValue("tags").trim()
    const oldTags = announcement.tags || ""
    if (tags !== oldTags) changes.tags = tags || null

    const medalhas = interaction.fields.getTextInputValue("medalhas").trim()
    const oldMedalhas = announcement.medalhas || ""
    if (medalhas !== oldMedalhas) changes.medalhas = medalhas || null

    const wins_level = interaction.fields.getTextInputValue("wins_level").trim()
    const oldWins = announcement.wins_level || ""
    if (wins_level !== oldWins) changes.wins_level = wins_level || null

    const cosmeticos = interaction.fields.getTextInputValue("cosmeticos").trim()
    const oldCos = announcement.cosmeticos || ""
    if (cosmeticos !== oldCos) changes.cosmeticos = cosmeticos || null
  } else {
    const valorRaw = interaction.fields.getTextInputValue("valor").trim()
    if (valorRaw) {
      const num = parseMoney(valorRaw)
      if (num === null || num <= 0 || num > 999999) return interaction.editReply({ content: "Valor invalido. Use ex: 300 ou 1.500,00" })
      const newValor = num.toFixed(2)
      if (newValor !== String(announcement.valor)) changes.valor = newValor
    }

    const vips = interaction.fields.getTextInputValue("vips").trim()
    const newVips = vips || "Nenhum"
    if (newVips !== (announcement.vips || "Nenhum")) changes.vips = newVips

    const capas = interaction.fields.getTextInputValue("capas").trim()
    const newCapas = capas || "Nenhuma"
    if (newCapas !== (announcement.capas || "Nenhuma")) changes.capas = newCapas

    const bans = interaction.fields.getTextInputValue("bans").trim()
    const newBans = bans || ""
    if (newBans !== (announcement.bans || "")) changes.bans = newBans
  }

  if (Object.keys(changes).length === 0) {
    return interaction.editReply({ content: "Nenhum campo foi alterado." })
  }

  updateAnnouncement(announcementId, changes)

  if (changes.valor && announcement.status === "approved") {
    notifyFavoritersOnPriceDrop(client, getAnnouncement(announcementId), announcement.valor).catch(() => {})
  }

  for (const [campo, newValue] of Object.entries(changes)) {
    const oldValue = announcement[campo] ?? "N/A"
    addEditLog(announcementId, interaction.user.id, { campo, oldValue, newValue })
    addLog("announcement_edited", interaction.user.id, announcementId.toString(), `Campo: ${campo} | ${oldValue} -> ${newValue}`)
  }

  // Atualizar embed no canal de anuncios se ativo
  if (announcement.status === "approved" && announcement.message_id) {
    try {
      const announcementChannel = await client.channels.fetch(config.channels.anuncios)
      const message = await announcementChannel.messages.fetch(announcement.message_id)
      const updated = getAnnouncement(announcementId)
      const seller = await client.users.fetch(updated.user_id)
      const sellerRating = getUserAverageRating(updated.user_id)
      const pub = buildPublicAnnouncement(updated, seller, sellerRating)
      await message.edit(pub)
    } catch (e) {
      fileLog.error({ err: e?.message }, "[EDITAR] Erro ao atualizar embed")
    }
  }

  await logAction(client, "announcement_edited", {
    userId: interaction.user.id,
    targetId: announcementId.toString(),
    details: Object.entries(changes).map(([k, v]) => `**${k}:** ${announcement[k] ?? "N/A"} -> ${v}`).join("\n"),
  })

  const changeText = Object.entries(changes).map(([k, v]) => `**${k}:** ${announcement[k] ?? "N/A"} -> **${v ?? "(removido)"}**`).join("\n")
  const sc = container(COLORS.SUCCESS)
    .addTextDisplayComponents(text(`## Anuncio Editado\nAnuncio **#${announcementId}** atualizado com sucesso.\n\n${changeText}`))
  await interaction.editReply({ flags: CV2, components: [sc] })
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

    const pub = buildPublicAnnouncement(announcement, seller, sellerRating)
    const newMsg = await announcementChannel.send(pub)
    announcement.message_id = newMsg.id
    bumpAnnouncement(announcement.id)
    updateAnnouncement(announcement.id, { message_id: newMsg.id })
    notifyFavoritersOnBump(client, getAnnouncement(announcement.id)).catch(() => {})

    // Atualizar painel
    const fresh = getAnnouncement(announcement.id)
    const panel = buildAnuncioDetailPanel(fresh)
    await interaction.editReply({ flags: CV2, components: [panel], embeds: [], content: null })

    await interaction.followUp({
      content: `📤 Seu anúncio de **${announcement.nick}** foi bumped com sucesso!`,
      flags: MessageFlags.Ephemeral,
    })
  } catch (e) {
    fileLog.error({ err: e?.message }, "[BUMP] Erro")
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
    const seller = await client.users.fetch(announcement.user_id)
    const sellerRating = getUserAverageRating(announcement.user_id)
    const pub = buildPublicAnnouncement(announcement, seller, sellerRating, { reserved: true })
    await msg.edit(pub)
  } catch { /* ok */ }

  try {
    const dmC = container(COLORS.SUCCESS)
      .addTextDisplayComponents(text(
        `## 🔒 Conta Reservada Para Você!\n${interaction.user.username} reservou a conta **${announcement.nick}** para você por ${hours} hora(s)!\n\n**Valor:** R$ ${formatValor(announcement.valor)}\n**Expira:** <t:${expiresAt}:R>`
      ))
    await buyer.send({ components: [dmC] })
  } catch { /* DM fechada */ }

  addLog("reservation_created", interaction.user.id, announcementId.toString(), `Para: ${buyerId} por ${hours}h`)

  const rc = container(COLORS.SUCCESS)
    .addTextDisplayComponents(text(
      `## 🔒 Anúncio Reservado\nA conta **${announcement.nick}** foi reservada para ${buyer} por ${hours} hora(s).\n**Expira em:** <t:${expiresAt}:R>  ·  **Reservado para:** ${buyer.username}`
    ))
  await interaction.editReply({ flags: CV2, components: [rc] })
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
    const seller = await client.users.fetch(announcement.user_id)
    const sellerRating = getUserAverageRating(announcement.user_id)
    const pub = buildPublicAnnouncement(announcement, seller, sellerRating)
    await msg.edit(pub)
  } catch { /* ok */ }

  addLog("reservation_cancelled", interaction.user.id, announcement.id.toString(), "Cancelado manualmente")

  // Atualizar painel
  const fresh = getAnnouncement(announcement.id)
  const panel = buildAnuncioDetailPanel(fresh)
  await interaction.editReply({ flags: CV2, components: [panel], embeds: [], content: null })

  await interaction.followUp({
    content: `✅ Reserva da conta **${announcement.nick}** cancelada. Anúncio disponível novamente.`,
    flags: MessageFlags.Ephemeral,
  })
}
