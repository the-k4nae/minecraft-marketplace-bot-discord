/**
 * handlers/negotiationHandler.js — partes migradas para Components V2
 *
 * Funções alteradas: handleInterestButton, handleNegotiationButton,
 * handleSaleComplete, handleEscrowConfirm, handleRatingSubmit
 */

import {
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, ButtonStyle, MessageFlags,
} from "discord.js"
import {
  getAnnouncement, createNegotiation, getNegotiationByChannel,
  markAnnouncementSold, completeNegotiation, cancelNegotiation,
  setEscrowStatus, getEscrowStatus,
  createRating, hasAlreadyRated, getUserAverageRating,
  getUserActiveNegotiations, getActiveReservation,
  addLog, getPaymentProofs, deleteFavoritesByAnnouncement,
  bumpAnnouncement, updateAnnouncement,
} from "../utils/database.js"
import { getSkinUrls } from "../utils/minecraftAPI.js"
import { checkCooldown } from "../utils/cooldown.js"
import { logAction } from "../utils/logger.js"
import { fileLog } from "../utils/fileLogger.js"
import { handleProofButton } from "./pixVerificationHandler.js"
import { notifyFavoritersOnBump } from "./favoritosHandler.js"
import {
  CV2, CV2_EPHEMERAL,
  createRow, createButton, createLinkButton, limit,
  container, text, separator, section, thumbnail, mediaGallery,
  buildPublicAnnouncement, buildNegotiationCard, buildNegotiationInterestDm,
  buildSaleCompletedCard, buildSaleCompletedDm,
  errorReply, successReply, warnReply, infoReply,
  formatValor,
} from "../utils/components.js"

// ── Interesse no anúncio ──────────────────────────────────────────────────────

export async function handleInterestButton(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config

  const announcementId = parseInt(params[0])
  const announcement   = getAnnouncement(announcementId)

  if (!announcement)                  return interaction.editReply(errorReply("Anúncio não encontrado."))
  if (announcement.status !== "approved") return interaction.editReply(errorReply("Este anúncio não está mais disponível."))
  if (announcement.user_id === interaction.user.id) return interaction.editReply(errorReply("Você não pode negociar com seu próprio anúncio."))
  const activeReservation = getActiveReservation(announcementId)
  if (activeReservation && activeReservation.buyer_id !== interaction.user.id) {
    return interaction.editReply(errorReply("Este anúncio está reservado para outro usuário."))
  }

  const cooldown = checkCooldown(interaction.user.id, `interest_${announcementId}`, 30000)
  if (cooldown.onCooldown) return interaction.editReply(warnReply(`Aguarde ${cooldown.remaining}s antes de tentar novamente.`))

  const globalCooldown = checkCooldown(interaction.user.id, "open_negotiation_global", 60000)
  if (globalCooldown.onCooldown) return interaction.editReply(warnReply(`Aguarde ${globalCooldown.remaining}s antes de abrir outra negociação.`))

  const activeNegs = getUserActiveNegotiations(interaction.user.id)
  const alreadyNegotiating = activeNegs.find(n => n.announcement_id === announcementId)
  if (alreadyNegotiating) {
    return interaction.editReply(warnReply(`Você já tem uma negociação ativa para este anúncio em <#${alreadyNegotiating.ticket_channel_id}>.`))
  }

  const maxNegs = config.limits?.maxNegotiationsPerUser ?? 3
  if (activeNegs.length >= maxNegs) {
    return interaction.editReply(warnReply(`Você já tem ${activeNegs.length} negociações ativas (máximo: ${maxNegs}).`))
  }

  try {
    const buyer  = interaction.user
    const seller = await client.users.fetch(announcement.user_id)
    const guild  = interaction.guild

    const category = config.categories?.negociacoes
      ? await guild.channels.fetch(config.categories.negociacoes).catch(() => null)
      : null

    const channelName = `neg-${announcement.nick.toLowerCase().replace(/[^a-z0-9]/g, "")}-${buyer.username.toLowerCase().replace(/[^a-z0-9]/g, "")}`

    const ticketChannel = await guild.channels.create({
      name: channelName,
      parent: category ?? undefined,
      permissionOverwrites: [
        { id: guild.roles.everyone,    deny: ["ViewChannel"] },
        { id: buyer.id,  allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: seller.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: config.roles.staff, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
      ],
    })

    // Re-verificar anúncio após a criação assíncrona do canal (race condition:
    // o anúncio pode ter sido deletado/vendido durante o await acima).
    const announcementCheck = getAnnouncement(announcementId)
    if (!announcementCheck || announcementCheck.status !== "approved") {
      await ticketChannel.delete().catch(() => {})
      return interaction.editReply(errorReply("Este anúncio não está mais disponível (foi removido ou vendido enquanto o canal era criado)."))
    }

    const negResult    = createNegotiation(announcementId, buyer.id, seller.id, ticketChannel.id)
    const negotiationId = negResult.lastInsertRowid

    addLog("negotiation_started", buyer.id, String(negotiationId), `Anúncio #${announcementId} — ${announcement.nick}`)

    // Enviar card de negociação V2
    await ticketChannel.send(buildNegotiationCard(announcement, buyer, seller))

    // DM ao vendedor
    try { await seller.send(buildNegotiationInterestDm(buyer, announcement, ticketChannel)) } catch { /* DM fechada */ }

    await logAction(client, "negotiation_started", {
      userId: buyer.id,
      targetId: String(negotiationId),
      details: `**Nick:** ${announcement.nick}\n**Valor:** R$ ${formatValor(announcement.valor)}\n**Comprador:** <@${buyer.id}>\n**Vendedor:** <@${seller.id}>`,
      thumbnail: getSkinUrls(announcement.uuid).body,
    })

    await interaction.editReply(successReply(`Canal de negociação criado: ${ticketChannel}`))
  } catch (err) {
    fileLog.error({ err: err?.message }, "[NEG] Erro ao criar negociação")
    await interaction.editReply(errorReply("Erro ao criar canal de negociação. Tente novamente."))
  }
}

// ── Venda concluída ────────────────────────────────────────────────────────────

async function handleSaleComplete(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) return interaction.editReply(errorReply("Negociação não encontrada."))
  if (negotiation.status !== "active") return interaction.editReply(warnReply("Esta negociação já foi encerrada."))

  const escrow = getEscrowStatus(interaction.channelId)
  if (!escrow?.seller_confirmed || !escrow?.buyer_confirmed) {
    return interaction.editReply(warnReply("Ambas as partes precisam confirmar o escrow antes de concluir a venda."))
  }

  if (interaction.user.id !== negotiation.seller_id && !interaction.member.roles.cache.has(config.roles.staff)) {
    return interaction.editReply(errorReply("Apenas o vendedor pode concluir a venda."))
  }

  const announcement = getAnnouncement(negotiation.announcement_id)
  if (!announcement) return interaction.editReply(errorReply("Anúncio não encontrado."))

  completeNegotiation(interaction.channelId)
  markAnnouncementSold(announcement.id)
  deleteFavoritesByAnnouncement(announcement.id)

  const buyer  = await client.users.fetch(negotiation.buyer_id)
  const seller = await client.users.fetch(negotiation.seller_id)

  // Card de venda concluída no canal
  const saleCard = buildSaleCompletedCard(announcement, buyer, seller)

  // Adicionar botões de avaliação
  saleCard.components[0].addSeparatorComponents(separator()).addActionRowComponents(
    createRow(
      createButton({ customId: `rate_${negotiation.id}_seller`, label: "⭐ Avaliar Vendedor",  style: ButtonStyle.Primary }),
      createButton({ customId: `rate_${negotiation.id}_buyer`,  label: "⭐ Avaliar Comprador", style: ButtonStyle.Primary }),
    )
  )

  await interaction.channel.send(saleCard)

  // DMs
  try { await buyer.send(buildSaleCompletedDm(announcement, "buyer",  seller.username, interaction.guild)) } catch { /* DM fechada */ }
  try { await seller.send(buildSaleCompletedDm(announcement, "seller", buyer.username, interaction.guild)) } catch { /* DM fechada */ }

  // Canal de vendas público
  try {
    const vendasCh = await client.channels.fetch(config.channels.vendas).catch(() => null)
    if (vendasCh) {
      // Guard: uuid pode ser null em anúncios antigos sem validação Mojang
      const skinUrl  = announcement.uuid ? getSkinUrls(announcement.uuid).body : null
      const bodyText = `## 💸 Nova Venda!\n**Conta:** ${announcement.nick}\n**Valor:** R$ ${formatValor(announcement.valor)}\n` +
                       `**Vendedor:** ${seller.username}\n**Comprador:** ${buyer.username}`

      const c = container(0x9B59B6)
      if (skinUrl) {
        c.addSectionComponents(section(bodyText, thumbnail(skinUrl, announcement.nick)))
      } else {
        c.addTextDisplayComponents(text(bodyText))
      }

      await vendasCh.send({ flags: CV2, components: [c] })
    }
  } catch { /* ok */ }

  addLog("sale_completed", interaction.user.id, String(negotiation.id),
    `${announcement.nick} · R$ ${announcement.valor}`)

  await interaction.editReply(successReply("Venda concluída com sucesso!"))
}

// ── Escrow ────────────────────────────────────────────────────────────────────

async function handleEscrowConfirm(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) return interaction.editReply(errorReply("Negociação não encontrada."))

  const party = params[0]  // "seller" | "buyer" — params = ["seller","announcementId"]
  const isSeller  = party === "seller"
  const userId    = isSeller ? negotiation.seller_id : negotiation.buyer_id

  if (interaction.user.id !== userId) {
    return interaction.editReply(errorReply(`Apenas o ${isSeller ? "vendedor" : "comprador"} pode confirmar este escrow.`))
  }

  const escrow  = getEscrowStatus(interaction.channelId)
  const already = isSeller ? escrow?.seller_confirmed : escrow?.buyer_confirmed
  if (already) return interaction.editReply(warnReply("Você já confirmou o escrow."))

  setEscrowStatus(interaction.channelId, party, true)
  const updated = getEscrowStatus(interaction.channelId)

  const statusText = [
    `🔒 **Vendedor:** ${updated.seller_confirmed ? "✅ Confirmado" : "⏳ Aguardando"}`,
    `✅ **Comprador:** ${updated.buyer_confirmed  ? "✅ Confirmado" : "⏳ Aguardando"}`,
  ].join("\n")

  await interaction.channel.send({
    flags: CV2,
    components: [
      container(updated.seller_confirmed && updated.buyer_confirmed ? 0x00D166 : 0x3498DB)
        .addTextDisplayComponents(text(`## 🔐 Status do Escrow\n${statusText}${
          updated.seller_confirmed && updated.buyer_confirmed
            ? "\n\n**Ambas as partes confirmaram!** O vendedor pode clicar em ✅ Venda Concluída."
            : ""
        }`))
    ],
  })

  await interaction.editReply(successReply(`Escrow confirmado como ${isSeller ? "vendedor" : "comprador"}!`))
}

// ── Avaliação ─────────────────────────────────────────────────────────────────

export async function handleRatingSubmit(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const [negotiationId, ratedRole] = params
  const negotiation = getNegotiationByChannel(interaction.channelId)

  if (!negotiation) return interaction.editReply(errorReply("Negociação não encontrada."))

  const ratedId = ratedRole === "seller" ? negotiation.seller_id : negotiation.buyer_id
  if (hasAlreadyRated(parseInt(negotiationId), interaction.user.id)) {
    return interaction.editReply(warnReply("Você já avaliou esta negociação."))
  }

  const stars   = parseInt(interaction.fields.getTextInputValue("stars"))
  const comment = interaction.fields.getTextInputValue("comment") || null

  if (isNaN(stars) || stars < 1 || stars > 5) {
    return interaction.editReply(errorReply("Avaliação inválida. Use um número de 1 a 5."))
  }

  createRating({ negotiationId: parseInt(negotiationId), raterId: interaction.user.id, ratedId, stars, comment })
  addLog("rating_created", interaction.user.id, ratedId, `${stars}★ — ${comment ?? "sem comentário"}`)

  const starsStr = "★".repeat(stars) + "☆".repeat(5 - stars)
  await interaction.editReply(successReply(`Avaliação registrada: ${starsStr}${comment ? `\n_"${limit(comment, 100)}"_` : ""}`))
}

// ── Router principal ──────────────────────────────────────────────────────────

export async function handleNegotiationButton(interaction, type, params, client) {
  if (type === "interest") return handleInterestButton(interaction, params, client)

  if (type === "neg") {
    const sub = params[0]
    if (sub === "complete") return handleSaleComplete(interaction, params.slice(1), client)
    if (sub === "cancel")   return handleNegotiationCancel(interaction, params.slice(1), client)
    if (sub === "callstaff") return handleCallStaff(interaction, client)
    if (sub === "proof")     return handleProofButton(interaction, params.slice(1), client)
    if (sub === "viewproofs") return handleViewProofs(interaction, params.slice(1), client)
  }

  if (type === "escrow") return handleEscrowConfirm(interaction, params, client)
  if (type === "rate")   {
    // Abrir modal de avaliação
    const [negotiationId, ratedRole] = params
    const modal = new ModalBuilder()
      .setCustomId(`rating_submit_${negotiationId}_${ratedRole}`)
      .setTitle("Avaliar Transação")
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("stars").setLabel("Nota (1 a 5)").setStyle(TextInputStyle.Short)
          .setRequired(true).setMinLength(1).setMaxLength(1).setPlaceholder("Ex: 5")
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("comment").setLabel("Comentário (opcional)").setStyle(TextInputStyle.Paragraph)
          .setRequired(false).setMaxLength(300)
      ),
    )
    return interaction.showModal(modal)
  }
}

// ── Cancelar negociação ────────────────────────────────────────────────────────

async function handleNegotiationCancel(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) return interaction.editReply(errorReply("Negociação não encontrada."))

  const isParty = [negotiation.buyer_id, negotiation.seller_id].includes(interaction.user.id)
  const isStaff = interaction.member.roles.cache.has(client.config?.roles?.staff)
  if (!isParty && !isStaff) return interaction.editReply(errorReply("Apenas as partes ou staff podem cancelar."))

  cancelNegotiation(interaction.channelId)
  addLog("negotiation_cancelled", interaction.user.id, String(negotiation.id), `Cancelado por ${interaction.user.username}`)

  await interaction.channel.send({
    flags: CV2,
    components: [
      container(0xFF4444)
        .addTextDisplayComponents(text(`## ❌ Negociação Cancelada\nCancelada por ${interaction.user.username}. Canal fechando em 15s.`))
    ],
  })

  setTimeout(() => interaction.channel.delete().catch(() => {}), 15_000)
  await interaction.editReply(successReply("Negociação cancelada."))
}

// ── Chamar staff ───────────────────────────────────────────────────────────────

async function handleCallStaff(interaction, client) {
  const cooldown = checkCooldown(interaction.user.id, "callstaff", 5 * 60 * 1000)
  if (cooldown.onCooldown) {
    return interaction.reply(warnReply(`Aguarde ${cooldown.remaining}s antes de chamar a staff novamente.`))
  }

  const staffRoleId = client.config?.roles?.staff
  await interaction.reply({
    flags: CV2,
    components: [
      container(0xFFA500)
        .addTextDisplayComponents(text(
          `## 📣 Staff Chamada!\n<@&${staffRoleId}> — ${interaction.user.username} precisa de ajuda nesta negociação.`
        ))
    ],
  })
}

// ── Ver comprovantes ───────────────────────────────────────────────────────────

async function handleViewProofs(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) return interaction.editReply(errorReply("Negociação não encontrada."))

  const proofs = getPaymentProofs(negotiation.id)
  if (!proofs.length) return interaction.editReply(infoReply("Nenhum comprovante enviado ainda."))

  const lines = proofs.map((p, i) =>
    `**${i + 1}.** <@${p.user_id}> — ${new Date(p.created_at).toLocaleString("pt-BR")}\n[Ver comprovante](${p.url})`
  )

  const c = container(0x5865F2)
    .addTextDisplayComponents(text(`## 🧾 Comprovantes (${proofs.length})\n${lines.join("\n\n")}`))

  await interaction.editReply({ flags: CV2_EPHEMERAL, components: [c] })
}

// ─── Bump manual ──────────────────────────────────────────────────────────────

export async function handleBumpAnnouncement(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config        = client.config
  const announcementId = parseInt(params[0])
  const announcement  = getAnnouncement(announcementId)

  if (!announcement || announcement.user_id !== interaction.user.id)
    return interaction.editReply(errorReply("Você não tem permissão para bumpar este anúncio."))

  const cooldown = checkCooldown(interaction.user.id, `bump_${announcementId}`, 24 * 3_600_000)
  if (cooldown.onCooldown) {
    const hours = Math.floor(cooldown.remaining / 3600)
    const mins  = Math.floor((cooldown.remaining % 3600) / 60)
    return interaction.editReply(warnReply(`Aguarde **${hours}h ${mins}m** para bumpar novamente.`))
  }

  try {
    const annCh  = await client.channels.fetch(config.channels.anuncios)
    const oldMsg = announcement.message_id
      ? await annCh.messages.fetch(announcement.message_id).catch(() => null)
      : null
    if (oldMsg) await oldMsg.delete().catch(() => {})

    const seller       = await client.users.fetch(announcement.user_id)
    const sellerRating = getUserAverageRating(announcement.user_id)

    // buildPublicAnnouncement já importado de ../utils/components.js
    const msg = buildPublicAnnouncement(announcement, seller, sellerRating)
    // Adicionar nota de bump no último TextDisplay do container
    msg.components[0].addSeparatorComponents(separator())
      .addTextDisplayComponents(text("-# ⬆️ BUMP · Anúncio atualizado"))

    const newMsg = await annCh.send(msg)

    bumpAnnouncement(announcementId)
    updateAnnouncement(announcementId, { message_id: newMsg.id })
    notifyFavoritersOnBump(client, getAnnouncement(announcementId)).catch(() => {})

    await interaction.editReply(successReply("Anúncio bumpeado com sucesso!"))
  } catch (err) {
    fileLog.error({ err: err?.message }, "[BUMP] Erro")
    await interaction.editReply(errorReply("Erro ao fazer bump. Tente novamente."))
  }
}

// ─── Rating button (abre modal) ───────────────────────────────────────────────

export async function handleRatingButton(interaction, params, client) {
  const negotiationId = parseInt(params[0])
  const targetRole    = params[1]  // "buyer" | "seller"

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) {
    return interaction.reply(errorReply("Negociação não encontrada neste canal."))
  }

  if (hasAlreadyRated(negotiationId, interaction.user.id)) {
    return interaction.reply(warnReply("Você já avaliou esta transação."))
  }

  const modal = new ModalBuilder()
    .setCustomId(`rating_submit_${negotiationId}_${targetRole}`)
    .setTitle(`Avaliar ${targetRole === "buyer" ? "Comprador" : "Vendedor"}`)

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("stars")
        .setLabel("Nota (1 a 5)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 5")
        .setRequired(true)
        .setMaxLength(1)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("comment")
        .setLabel("Comentário (opcional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(300)
    ),
  )

  await interaction.showModal(modal)
}
