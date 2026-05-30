/**
 * handlers/anuncioHandler.js — partes migradas para Components V2
 *
 * Mostra apenas as funções que mudam. O resto do arquivo (modais,
 * lógica de validação, etc.) permanece idêntico.
 */

import {
  ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  ButtonStyle, MessageFlags,
} from "discord.js"
import {
  getAnnouncement, approveAnnouncement, rejectAnnouncement,
  getUserAverageRating, matchAlerts, markAlertTriggered,
  getTicket, getTicketById, closeTicket, addLog,
  getTempModalData, deleteTempModalData, updateTempModalData,
  saveTempModalData,
  getUserActiveAnnouncements, isBlacklisted,
  getAnnouncementsByUUID, getAnnouncementsByUUIDRecent, getDuplicateAccountSellers,
  createAnnouncement, updateAnnouncement, updateAnnouncementPhoto,
  saveAnnouncementTemplate, getAnnouncementTemplate, getEditLogs,
} from "../utils/database.js"
import { getPlayerUUID, getSkinUrls } from "../utils/minecraftAPI.js"
import { logAction, sendAntiScamAlert } from "../utils/logger.js"
import { fileLog } from "../utils/fileLogger.js"
import { checkCooldown } from "../utils/cooldown.js"
import {
  CV2, CV2_EPHEMERAL, COLORS,
  createRow, createButton, createLinkButton, limit, toNull,
  container, text, separator, section, thumbnail, mediaGallery,
  buildPublicAnnouncement, buildAnnouncementReview,
  buildApprovalDm, buildRejectionDm,
  errorReply, successReply, warnReply,
  formatValor, parseMoney,
} from "../utils/components.js"
// notifyFavoritersOnBump é chamado em negotiationHandler.handleBumpAnnouncement, não aqui
// Templates de recusa rápida (feature anterior)
import { showRejectionTemplates } from "./rejectionTemplates.js"
import { checkNamedLimit } from "../utils/rateLimiter.js"
import { sanitizeString } from "../utils/validator.js"
import { verifyAnnouncementUUID } from "./uuidVerification.js"

// ── Aprovação ─────────────────────────────────────────────────────────────────

async function approveAnnouncementAction(interaction, announcementId, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config
  const announcement = getAnnouncement(announcementId)

  if (!announcement) return interaction.editReply(errorReply("Anúncio não encontrado."))
  if (announcement.status !== "pending") return interaction.editReply(warnReply("Este anúncio já foi processado."))

  // ── Travar status atomicamente no DB ANTES de qualquer operação async ────
  // O SQL usa AND status = 'pending' — se outro clique chegou primeiro, changes = 0.
  const locked = approveAnnouncement(announcementId, "_pending_send_", interaction.user.id)
  if (!locked) return interaction.editReply(warnReply("Este anúncio já foi processado por outro staff."))
  // ─────────────────────────────────────────────────────────────────────────

  // ── Verificação de UUID em tempo real ────────────────────────────────────
  const uuidCheck = await verifyAnnouncementUUID(announcement)
  if (!uuidCheck.ok) {
    // Reverter o lock pois a aprovação falhou
    updateAnnouncement(announcementId, { status: "pending", message_id: null })
    await sendAntiScamAlert(client, "duplicate_uuid", {
      userId: announcement.user_id,
      targetId: String(announcementId),
      details: uuidCheck.message,
    })
    return interaction.editReply(errorReply(`🚨 **Aprovação Bloqueada — UUID Inválido**\n\n${uuidCheck.message}\n\nRejeite este anúncio. O vendedor deverá recriá-lo com os dados corretos.`))
  }
  if (uuidCheck.warning) {
    await interaction.followUp({ content: `⚠️ **Aviso UUID:** ${uuidCheck.warning}`, flags: MessageFlags.Ephemeral }).catch(() => {})
  }
  // ─────────────────────────────────────────────────────────────────────────

  try {
    const seller       = await client.users.fetch(announcement.user_id)
    const sellerRating = getUserAverageRating(announcement.user_id)

    // Mensagem pública — Components V2
    const publicMessage = buildPublicAnnouncement(announcement, seller, sellerRating)

    const announcementChannel = await client.channels.fetch(config.channels.anuncios)
    const message = await announcementChannel.send(publicMessage)

    // Atualizar o message_id real agora que a mensagem foi enviada
    updateAnnouncement(announcementId, { message_id: message.id })

    // Alertas de interesse
    const matchingAlerts = matchAlerts(announcement)
    for (const alert of matchingAlerts) {
      try {
        const alertUser = await client.users.fetch(alert.user_id)
        const f = alert.filters
        const filtersText = [
          f.nick     ? `Nick: ${f.nick}`         : null,
          f.minPrice ? `Mín: R$ ${f.minPrice}`   : null,
          f.maxPrice ? `Máx: R$ ${f.maxPrice}`   : null,
          f.vip      ? `VIP: ${f.vip}`            : null,
        ].filter(Boolean).join(" · ")

        await alertUser.send({
          flags: CV2,
          components: [
            container(0x00D166)
              .addSectionComponents(
                section(
                  `## 🔔 Alerta Disparado!\nUm anúncio correspondeu ao seu alerta.\n\n` +
                  `**Filtros:** ${filtersText}\n` +
                  `**Nick:** ${announcement.nick}\n` +
                  `**Valor:** R$ ${formatValor(announcement.valor)}\n` +
                  `**Ver:** <#${config.channels.anuncios}>`,
                  thumbnail(getSkinUrls(announcement.uuid || announcement.nick).avatar, announcement.nick)
                )
              )
          ],
        })
        markAlertTriggered(alert.id)
      } catch { /* DM fechada */ }
    }

    addLog("announcement_approved", interaction.user.id, String(announcementId), `Aprovado por ${interaction.user.username}`)

    // DM ao vendedor
    try { await seller.send(buildApprovalDm(announcement, interaction.guild)) } catch { /* DM fechada */ }

    await logAction(client, "announcement_approved", {
      userId: interaction.user.id,
      targetId: String(announcementId),
      details: `**Nick:** ${announcement.nick}\n**Valor:** R$ ${formatValor(announcement.valor)}\n**Vendedor:** <@${announcement.user_id}>`,
      thumbnail: getSkinUrls(announcement.uuid || announcement.nick).body,
    })

    await interaction.editReply(successReply("Anúncio aprovado e publicado!"))
    await autoCloseAnnouncementTicket(announcement, interaction.guild, client, "aprovado", interaction.user.username)
  } catch (err) {
    fileLog.error({ err: err?.message }, "[ANUNCIO] Erro ao aprovar")
    // Se o envio falhou antes de gravar o message_id real, reverter o lock
    const current = getAnnouncement(announcementId)
    if (current?.message_id === "_pending_send_") {
      updateAnnouncement(announcementId, { status: "pending", message_id: null })
    }
    await interaction.editReply(errorReply("Erro ao aprovar anúncio."))
  }
}

// ── Rejeição ──────────────────────────────────────────────────────────────────

export async function handleRejectReasonModal(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const announcementId = parseInt(params[0])
  const reason = interaction.fields.getTextInputValue("reason")
  await rejectAnnouncementAction(interaction, announcementId, client, reason)
}

async function rejectAnnouncementAction(interaction, announcementId, client, reason = "Sem motivo informado") {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const announcement = getAnnouncement(announcementId)
  if (!announcement) return interaction.editReply(errorReply("Anúncio não encontrado."))
  if (announcement.status !== "pending") return interaction.editReply(warnReply("Este anúncio já foi processado."))

  const rejected = rejectAnnouncement(announcementId, interaction.user.id, reason)
  if (!rejected) return interaction.editReply(warnReply("Este anúncio já foi processado por outro staff."))
  addLog("announcement_rejected", interaction.user.id, String(announcementId), `Motivo: ${reason}`)

  await logAction(client, "announcement_rejected", {
    userId: interaction.user.id,
    targetId: String(announcementId),
    details: `**Nick:** ${announcement.nick}\n**Vendedor:** <@${announcement.user_id}>\n**Motivo:** ${reason}`,
  })

  // DM ao vendedor
  try {
    const seller = await client.users.fetch(announcement.user_id)
    await seller.send(buildRejectionDm(announcement, reason, interaction.guild))
  } catch { /* DM fechada */ }

  await interaction.editReply(successReply("Anúncio recusado."))
  await autoCloseAnnouncementTicket(announcement, interaction.guild, client, "recusado", interaction.user.username)
}

// ── Auto-arquivamento do ticket de anúncio ────────────────────────────────────

async function autoCloseAnnouncementTicket(announcement, guild, client, reason, staffName) {
  if (!announcement?.ticket_id) return
  try {
    const ticket = getTicketById(announcement.ticket_id)
    if (!ticket || ticket.status !== "open") return
    closeTicket(ticket.channel_id)
    const ch = await guild.channels.fetch(ticket.channel_id).catch(() => null)
    if (!ch) return
    const color = reason === "aprovado" ? COLORS.SUCCESS : COLORS.DANGER
    const emoji = reason === "aprovado" ? "✅" : "❌"
    await ch.send({
      flags: CV2,
      components: [
        container(color).addTextDisplayComponents(text(
          `## 🔒 Ticket Arquivado\n${emoji} Anúncio de **${announcement.nick}** foi **${reason}** por ${staffName}.\n-# Canal removido em 5s`
        )),
      ],
    })
    setTimeout(() => ch.delete().catch(() => {}), 5000)
  } catch { /* ticket já fechado ou canal inexistente */ }
}

// ── Router de botões ──────────────────────────────────────────────────────────

export async function handleAnnouncementButton(interaction, action, params, client) {
  const config = client.config

  if (action === "announce" && params[0] === "modal") {
    const template = getAnnouncementTemplate(interaction.user.id)
    if (template) {
      return interaction.reply({
        flags: CV2_EPHEMERAL,
        components: [
          container(0x5865F2)
            .addTextDisplayComponents(text(
              `## 📢 Criar Anúncio\nVocê tem um template salvo com os dados de **${template.nick || "anúncio anterior"}**.\n\nComo deseja continuar?`
            ))
            .addActionRowComponents(
              createRow(
                createButton({ customId: "announce_newform", label: "📝 Novo Anúncio", style: ButtonStyle.Secondary }),
                createButton({ customId: "announce_loadtemplate", label: "📋 Usar Template", style: ButtonStyle.Primary }),
              )
            )
        ],
      })
    }
    return showAnnouncementModalForm(interaction)
  }

  if (action === "announce" && params[0] === "newform") {
    return showAnnouncementModalForm(interaction)
  }

  if (action === "announce" && params[0] === "loadtemplate") {
    const template = getAnnouncementTemplate(interaction.user.id)
    if (!template) return interaction.update(errorReply("Template não encontrado. Crie um anúncio normal primeiro."))
    return showAnnouncementModalForm(interaction, template)
  }

  if (action === "announce" && params[0] === "savetemplate") {
    return handleSaveTemplateButton(interaction, params[1])
  }

  if (action === "open" && params[0] === "modal2") {
    const tempId = params.slice(1).join("_")
    const stored = getTempModalData(tempId)
    if (!stored) {
      return interaction.reply(errorReply("Seus dados expiraram (limite de 1 hora). Abra um novo ticket de anúncio para recomeçar."))
    }

    const modal2 = new ModalBuilder()
      .setCustomId(`announce_final_${tempId}`)
      .setTitle("Informações Adicionais")

    modal2.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("tags").setLabel("Tags Especiais").setStyle(TextInputStyle.Short).setPlaceholder("Ex: [MVP], [LEGEND]").setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("medalhas").setLabel("Medalhas").setStyle(TextInputStyle.Short).setPlaceholder("Ex: Top 10 Bedwars").setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("wins_level").setLabel("Wins / Level").setStyle(TextInputStyle.Short).setPlaceholder("Ex: 5000 wins, Level 250").setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("cosmeticos").setLabel("Cosméticos").setStyle(TextInputStyle.Paragraph).setPlaceholder("Ex: Todas as danças, 50+ skins").setRequired(false)),
    )
    return interaction.showModal(modal2)
  }

  if (action === "approve" || action === "reject") {
    const announcementId = parseInt(params[0])
    if (action === "approve") return approveAnnouncementAction(interaction, announcementId, client)
    return showRejectionTemplates(interaction, announcementId)
  }

  // ── Histórico de edições (staff) ──────────────────────────────────────────────────
  if (action === "ann" && params[0] === "editlog") {
    return showEditLogs(interaction, parseInt(params[1]))
  }

  // ── Bump manual (roteado do meusAnunciosHandler) ──────────────────────────
  if (action === "bump") {
    const { handleBumpAnnouncement } = await import("./negotiationHandler.js")
    return handleBumpAnnouncement(interaction, params, client)
  }

  // ── Avaliação ─────────────────────────────────────────────────────────────
  if (action === "rate") {
    const { handleRatingButton } = await import("./negotiationHandler.js")
    return handleRatingButton(interaction, params, client)
  }

  // ── Confirm / cancel close (ticket) ──────────────────────────────────────
  if (action === "confirmclose") {
    const { handleConfirmCloseTicket } = await import("./ticketHandler.js")
    return handleConfirmCloseTicket(interaction, client)
  }

  if (action === "cancelclose") {
    await interaction.update({
      flags: CV2,
      components: [container().addTextDisplayComponents(text("Fechamento cancelado."))],
    })
    return
  }
}

// ── Formulário de anúncio (modal passo 1) ─────────────────────────────────────
// (mantém igual ao original — apenas o reply muda)

export async function showAnnouncementModalForm(interaction, template = null) {
  const modal = new ModalBuilder()
    .setCustomId(`announce_submit_${interaction.channelId}`)
    .setTitle("Anunciar Conta Minecraft")

  const nickInput = new TextInputBuilder().setCustomId("nick").setLabel("Nickname da Conta").setStyle(TextInputStyle.Short)
    .setPlaceholder("Nick exato da conta").setRequired(true).setMaxLength(16)

  const bansInput = new TextInputBuilder().setCustomId("bans").setLabel("Histórico de Banimentos").setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("Ex: Nunca foi banido / Banido em 2020 por...").setRequired(true)
  if (template?.bans) bansInput.setValue(template.bans)

  const capasInput = new TextInputBuilder().setCustomId("capas").setLabel("Capas Disponíveis").setStyle(TextInputStyle.Short)
    .setPlaceholder("Ex: Minecon 2016, Migrator").setRequired(false)
  if (template?.capas && template.capas !== "Nenhuma") capasInput.setValue(template.capas)

  const vipsInput = new TextInputBuilder().setCustomId("vips").setLabel("VIPs / Ranks").setStyle(TextInputStyle.Short)
    .setPlaceholder("Ex: VIP+, MVP++").setRequired(false)
  if (template?.vips && template.vips !== "Nenhum") vipsInput.setValue(template.vips)

  const valorInput = new TextInputBuilder().setCustomId("valor").setLabel("Valor (R$) — Somente números").setStyle(TextInputStyle.Short)
    .setPlaceholder("Ex: 150.00").setRequired(true)
  if (template?.valor) valorInput.setValue(String(parseFloat(template.valor).toFixed(2)))

  modal.addComponents(
    new ActionRowBuilder().addComponents(nickInput),
    new ActionRowBuilder().addComponents(bansInput),
    new ActionRowBuilder().addComponents(capasInput),
    new ActionRowBuilder().addComponents(vipsInput),
    new ActionRowBuilder().addComponents(valorInput),
  )
  await interaction.showModal(modal)
}

// ── Modal passo 1 enviado ──────────────────────────────────────────────────────

export async function handleAnnouncementModal(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config

  // @magicyan/discord — lê todos os campos de uma vez
  const { nick, bans, capas, vips, valor: valorRaw } = {
    nick:     interaction.fields.getTextInputValue("nick").trim(),
    bans:     interaction.fields.getTextInputValue("bans").trim(),
    capas:    interaction.fields.getTextInputValue("capas").trim() || "Nenhuma",
    vips:     interaction.fields.getTextInputValue("vips").trim()  || "Nenhum",
    valor:    interaction.fields.getTextInputValue("valor"),
  }

  const valorNum = parseMoney(valorRaw)
  if (!valorNum || valorNum > 999999) {
    return interaction.editReply(errorReply("Valor inválido. Use apenas números (ex: 150.00 ou 150,00)."))
  }

  if (isBlacklisted(interaction.user.id)) {
    return interaction.editReply(errorReply("Você está na blacklist e não pode criar anúncios."))
  }

  const activeAnns = getUserActiveAnnouncements(interaction.user.id)
  const maxAnns    = config.limits?.maxActiveAnnouncements ?? 3
  if (activeAnns.length >= maxAnns) {
    return interaction.editReply(warnReply(`Você já tem ${activeAnns.length} anúncio(s) ativo(s) (máximo: ${maxAnns}).`))
  }

  // Validar nick via API Mojang
  const playerData = await getPlayerUUID(nick)
  if (!playerData) {
    return interaction.editReply(errorReply(`Nick **${nick}** não encontrado na Mojang. Verifique se está correto.`))
  }
  if (playerData === "RATE_LIMITED") {
    return interaction.editReply(warnReply("API Mojang com rate limit. Tente novamente em 2 minutos."))
  }

  // Verificar UUID duplicado — busca anúncios recentes (90 dias) de QUALQUER status,
  // incluindo rejeitados/expirados/vendidos, para detectar contas que foram anunciadas
  // por outra pessoa mesmo que o anúncio anterior tenha sido removido.
  const recentAnns = getAnnouncementsByUUIDRecent(playerData.uuid)
  if (recentAnns.length > 0) {
    // Anúncios ativos/pendentes de outros vendedores
    const otherActiveAnns = recentAnns.filter(a =>
      a.user_id !== interaction.user.id && ["approved", "pending"].includes(a.status)
    )
    // Anúncios recentes de outros vendedores (qualquer status — inclui rejeitados/expirados)
    const otherRecentAnns = recentAnns.filter(a => a.user_id !== interaction.user.id)

    if (otherActiveAnns.length > 0) {
      // Conta está ativa/pendente em outro vendedor — scam claro
      await sendAntiScamAlert(client, "duplicate_uuid", {
        userId: interaction.user.id,
        details: `Nick **${nick}** (UUID \`${playerData.uuid}\`) já possui anúncio ATIVO de outro usuário (<@${otherActiveAnns[0].user_id}>). Possível scam.`,
      })
    } else if (otherRecentAnns.length > 0) {
      // Conta foi anunciada recentemente por outro vendedor (rejeitado/expirado/vendido)
      // Pode ser legítimo (conta vendida) ou tentativa de re-anunciar conta de outro
      const lastAnn = otherRecentAnns[0]
      const statusLabel = { rejected: "rejeitado", expired: "expirado", sold: "vendido", approved: "ativo", pending: "pendente" }[lastAnn.status] || lastAnn.status
      await sendAntiScamAlert(client, "duplicate_uuid", {
        userId: interaction.user.id,
        details: `Nick **${nick}** (UUID \`${playerData.uuid}\`) foi anunciado recentemente por outro usuário (<@${lastAnn.user_id}>) — anúncio #${lastAnn.id} estava **${statusLabel}**. Verifique se a conta foi legitimamente transferida.`,
      })
    }
  }

  // Salvar dados temporários e solicitar passo 2
  const tempId = saveTempModalData({ nick, bans, capas, vips, valor: valorNum.toFixed(2), uuid: playerData.uuid })

  const skin = getSkinUrls(playerData.uuid)

  await interaction.editReply({
    flags: CV2_EPHEMERAL,
    components: [
      container(0x5865F2)
        .addSectionComponents(
          section(
            `## ✅ Passo 1 Completo!\n` +
            `**Nick:** ${playerData.name}\n` +
            `**UUID:** \`${playerData.uuid}\`\n` +
            `**Valor:** R$ ${formatValor(valorNum)}\n\n` +
            `Agora preencha as informações adicionais (cosméticos, medals, etc.):`,
            thumbnail(skin.avatar, playerData.name)
          )
        )
        .addSeparatorComponents(separator())
        .addActionRowComponents(
          createRow(
            createButton({ customId: `open_modal2_${tempId}`, label: "📋 Continuar Passo 2", style: ButtonStyle.Primary }),
          )
        )
    ],
  })
}

// ── Modal final + foto ─────────────────────────────────────────────────────────
// handleAnnouncementFinalModal: mantém lógica igual, só troca os replies por V2

export async function handleAnnouncementFinalModal(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config

  const rateLimit = checkNamedLimit(interaction.user.id, "CREATE_ANNOUNCEMENT")
  if (!rateLimit.allowed) {
    return interaction.editReply(warnReply(`Você só pode criar **1 anúncio a cada 30 minutos**. Tente novamente em **${rateLimit.resetIn}s**.`))
  }

  const tempId = params.slice(1).join("_")
  const stored = getTempModalData(tempId)

  if (!stored) return interaction.editReply(errorReply("Dados expirados. Inicie o anúncio novamente."))


    const data = {
      ...stored,
      nick:       sanitizeString(stored.nick ?? ""),
      tags:       toNull(sanitizeString(interaction.fields.getTextInputValue("tags") ?? "")),
      medalhas:   toNull(sanitizeString(interaction.fields.getTextInputValue("medalhas") ?? "")),
      winsLevel:  toNull(sanitizeString(interaction.fields.getTextInputValue("wins_level") ?? "")),
      cosmeticos: toNull(sanitizeString(interaction.fields.getTextInputValue("cosmeticos") ?? "")),
    }

  // Salvar dados completos no temp para confirmar depois
  updateTempModalData(tempId, data)

  // ── Preview: mostrar como o anúncio vai ficar antes de enviar ──────────
  await interaction.editReply({
    flags: CV2_EPHEMERAL,
    components: [buildPreviewContainer(data, tempId)],
  })
}

/** Constrói o container de preview reutilizável (criação e re-render após foto) */
function buildPreviewContainer(data, tempId) {
  const skin  = getSkinUrls(data.uuid || data.nick)
  const namemc = `https://namemc.com/profile/${data.uuid}`
  const hasPhoto = !!data.photo_url

  const c = container(0x5865F2)
    .addTextDisplayComponents(text(`## 👁️ Preview do Anúncio${hasPhoto ? " · 📷 Foto adicionada" : ""}`))
    .addSeparatorComponents(separator())
    .addSectionComponents(
      section(
        `**Nick:** ${data.nick}\n` +
        `**NameMC:** [Ver perfil](${namemc})\n` +
        `**Bans:** ${data.bans || "Nenhum"}\n` +
        `**VIPs:** ${data.vips || "Nenhum"}\n` +
        `**Capas:** ${data.capas || "Nenhuma"}`,
        thumbnail(skin.avatar, data.nick)
      )
    )
    .addTextDisplayComponents(text(
      `**Tags:** ${data.tags || "Nenhuma"}\n` +
      `**Medalhas:** ${data.medalhas || "Nenhuma"}\n` +
      `**Wins/Level:** ${data.winsLevel || "N/A"}\n` +
      `**Cosméticos:** ${data.cosmeticos || "Nenhum"}\n\n` +
      `### 💰 R$ ${formatValor(data.valor)}`
    ))

  // Galeria: foto personalizada tem prioridade, senão usa skin body
  const galleryImg = data.photo_url || (data.uuid ? skin.body : null)
  if (galleryImg) c.addMediaGalleryComponents(mediaGallery(galleryImg))

  c.addSeparatorComponents(separator())
   .addTextDisplayComponents(text(`-# É assim que seu anúncio vai aparecer. Confirme para enviar à revisão da staff.`))
   .addActionRowComponents(
     createRow(
       createButton({ customId: `announce_confirm_${tempId}`, label: "✅ Confirmar e Enviar", style: ButtonStyle.Success }),
       createButton({ customId: `announce_addphoto_${tempId}`, label: hasPhoto ? "📷 Trocar Foto" : "📷 Adicionar Foto", style: ButtonStyle.Secondary }),
       createButton({ customId: `announce_cancel_${tempId}`, label: "❌ Cancelar", style: ButtonStyle.Danger }),
     )
   )

  return c
}

// ── Botão "Adicionar Foto" → abre modal com URL ──────────────────────────────

export async function handleAnnouncementAddPhoto(interaction, tempId) {
  const modal = new ModalBuilder()
    .setCustomId(`announce_photo_${tempId}`)
    .setTitle("📷 Adicionar Foto ao Anúncio")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("photo_url")
          .setLabel("URL da imagem (opcional)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("https://i.imgur.com/exemplo.png")
          .setRequired(false)
          .setMaxLength(500)
      )
    )
  await interaction.showModal(modal)
}

// ── Modal de foto enviado → salva URL e re-renderiza preview ──────────────────

export async function handleAnnouncementPhotoModalSubmit(interaction, tempId, client) {
  await interaction.deferUpdate()
  const data = getTempModalData(tempId)
  if (!data) {
    return interaction.editReply(errorReply("Dados expirados. Inicie o anúncio novamente."))
  }

  const rawUrl = interaction.fields.getTextInputValue("photo_url").trim()

  if (rawUrl) {
    // Validação básica de URL
    try { new URL(rawUrl) } catch {
      return interaction.editReply(errorReply("URL inválida. Use um link direto para uma imagem (ex: https://i.imgur.com/...)." ))
    }
    if (!rawUrl.match(/\.(png|jpg|jpeg|webp|gif)(\?.*)?$/i) && !rawUrl.includes("imgur.com") && !rawUrl.includes("discord")) {
      return interaction.editReply(errorReply("A URL não parece ser uma imagem. Use links que terminem em .png, .jpg, .webp, etc."))
    }
    updateTempModalData(tempId, { ...data, photo_url: rawUrl })
  } else {
    // Campo vazio = remover foto
    const updated = { ...data }
    delete updated.photo_url
    updateTempModalData(tempId, updated)
  }

  const updatedData = getTempModalData(tempId)
  await interaction.editReply({
    flags: CV2_EPHEMERAL,
    components: [buildPreviewContainer(updatedData, tempId)],
  })
}

// ── Confirmar preview → criar anúncio de verdade ──────────────────────────────

export async function handleAnnouncementPreviewConfirm(interaction, tempId, client) {
  await interaction.deferUpdate()
  const config = client.config

  const data = getTempModalData(tempId)
  if (!data) return interaction.editReply(errorReply("Dados expirados. Inicie o anúncio novamente."))

  const result = createAnnouncement({
    ticketId:   null,
    userId:     interaction.user.id,
    nick:       data.nick,
    uuid:       data.uuid,
    bans:       data.bans,
    capas:      data.capas,
    vips:       data.vips,
    tags:       data.tags,
    medalhas:   data.medalhas,
    winsLevel:  data.winsLevel,
    cosmeticos: data.cosmeticos,
    valor:      data.valor,
  })

  // Salvar foto se o usuário adicionou durante a criação
  if (data.photo_url) {
    updateAnnouncementPhoto(result.lastInsertRowid, data.photo_url)
  }

  deleteTempModalData(tempId)

  const announcementId = result.lastInsertRowid
  const announcement   = { ...data, id: announcementId, user_id: interaction.user.id }

  // Enviar para review da staff no canal configurável
  // IMPORTANTE: nunca usar config.channels.logs como fallback — causaria deleção do canal de logs ao recusar
  const reviewChannelId = config.channels.review
  if (!reviewChannelId) {
    fileLog.warn("[ANUNCIO] config.channels.review não configurado — anúncio criado sem notificar staff. Configure via /staff > Config ou edite config.json.")
  } else {
    try {
      const reviewChannel = await client.channels.fetch(reviewChannelId).catch(() => null)
      if (reviewChannel) {
        const staffRole = config.roles?.staff
        const mention = staffRole ? `<@&${staffRole}> novo anúncio aguardando revisão!` : null
        const review = buildAnnouncementReview(announcement, interaction.user, mention)
        await reviewChannel.send(review)
      } else {
        fileLog.warn({ channelId: reviewChannelId }, "[ANUNCIO] Canal de review não encontrado no Discord — verifique config.channels.review")
      }
    } catch (err) {
      fileLog.error({ err: err?.message }, "[ANUNCIO] Erro ao enviar review")
    }
  }

  await interaction.editReply({
    flags: CV2_EPHEMERAL,
    components: [
      container(0x00D166)
        .addTextDisplayComponents(text(
          `## ✅ Anúncio Enviado para Revisão — #${announcementId}\n` +
          `**Nick:** ${data.nick} · **Valor:** R$ ${formatValor(data.valor)}\n\n` +
          `Você receberá uma **DM** quando seu anúncio for aprovado ou recusado.\n` +
          `Use \`/meusanuncios\` para acompanhar o status.`
        ))
        .addSeparatorComponents(separator())
        .addActionRowComponents(
          createRow(
            createButton({ customId: `announce_savetemplate_${announcementId}`, label: "💾 Salvar como Template", style: ButtonStyle.Secondary }),
          )
        )
    ],
  })
}

async function handleSaveTemplateButton(interaction, announcementId) {
  await interaction.deferUpdate()
  const announcement = getAnnouncement(parseInt(announcementId))
  if (!announcement || announcement.user_id !== interaction.user.id) {
    return interaction.editReply(errorReply("Anúncio não encontrado."))
  }
  saveAnnouncementTemplate(interaction.user.id, {
    nick:       announcement.nick,
    bans:       announcement.bans,
    capas:      announcement.capas,
    vips:       announcement.vips,
    tags:       announcement.tags,
    medalhas:   announcement.medalhas,
    winsLevel:  announcement.wins_level,
    cosmeticos: announcement.cosmeticos,
    valor:      announcement.valor,
  })
  await interaction.editReply({
    flags: CV2_EPHEMERAL,
    components: [
      container(0x00D166)
        .addTextDisplayComponents(text(
          `## 💾 Template Salvo!\nDados de **${announcement.nick}** salvos como template.\nNa próxima vez, clique em **📋 Usar Template** para preencher automaticamente.`
        ))
    ],
  })
}

// ── Histórico de edições ──────────────────────────────────────────────────────

async function showEditLogs(interaction, announcementId) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const logs = getEditLogs(announcementId)

  if (!logs.length) {
    return interaction.editReply({
      flags: CV2,
      components: [
        container(0x5865F2)
          .addTextDisplayComponents(text(`## 📋 Histórico de Edições — #${announcementId}\nNenhuma edição registrada para este anúncio.`)),
      ],
    })
  }

  const lines = logs.slice(0, 15).map((l) => {
    const date = new Date(l.created_at).toLocaleString("pt-BR")
    return `**${l.campo}:** \`${l.old_value || "(vazio)"}\` → \`${l.new_value || "(vazio)"}\`\n<@${l.user_id}> · ${date}`
  })

  const footer = logs.length > 15 ? `\n-# Mostrando 15 de ${logs.length} edições` : ""
  const sc = container(0x5865F2)
    .addTextDisplayComponents(text(`## 📋 Histórico de Edições — #${announcementId}\n${lines.join("\n―\n")}${footer}`))

  return interaction.editReply({ flags: CV2, components: [sc] })
}

// ── Cancelar preview ──────────────────────────────────────────────────────────

export async function handleAnnouncementPreviewCancel(interaction, tempId) {
  await interaction.deferUpdate()
  deleteTempModalData(tempId)
  await interaction.editReply({
    flags: CV2_EPHEMERAL,
    components: [
      container(0xFF4444)
        .addTextDisplayComponents(text(`## ❌ Anúncio Cancelado\nSeus dados foram descartados. Use o painel para criar um novo anúncio.`))
    ],
  })
}
