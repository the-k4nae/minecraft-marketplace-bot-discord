/**
 * salesHandler.js
 *
 * Sistemas de vendas avancados:
 *  - Ofertas / Contrapropostas dentro de negociacoes
 *  - Reservas de anuncio
 *  - Bump automatico (ativar/desativar)
 *  - Historico de compras (/minhascompras)
 *  - Intermediario automatico por valor
 */

import {
  ActionRowBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags, ButtonStyle,
} from "discord.js"
import {
  getAnnouncement, getNegotiationByChannel, createOffer, getOffersByNegotiation,
  getLastPendingOffer, respondOffer, createReservation, getActiveReservation,
  cancelReservationByAnnouncement, enableAutoBump, disableAutoBump, getAutoBumpStatus,
  bumpAnnouncement, getUserAverageRating, getUserPurchaseHistory, addLog,
  getEscrowStatus, getOfferById, getMiddlemanStatus,
} from "../utils/database.js"
import {
  CV2, CV2_EPHEMERAL, container, text, separator, section, thumbnail,
  createRow, createButton, createLinkButton, buildPublicAnnouncement,
  formatValor, parseMoney, COLORS,
} from "../utils/components.js"
import { checkCooldown } from "../utils/cooldown.js"
import { checkNamedLimit } from "../utils/rateLimiter.js"
import { logAction } from "../utils/logger.js"
import { buildFavoriteButton } from "./favoritosHandler.js"
import { notifyNewOffer, notifyCounterOffer, notifyOfferAccepted, notifyOfferRejected } from "./offerNotifications.js"

// ======================================================
// OFERTAS / CONTRAPROPOSTAS
// ======================================================

/**
 * Abre modal para fazer uma oferta
 */
export async function handleMakeOffer(interaction, client) {
  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) {
    return interaction.reply({ content: "Esta acao so pode ser usada em canais de negociacao.", flags: MessageFlags.Ephemeral })
  }

  if (interaction.user.id !== negotiation.buyer_id) {
    return interaction.reply({ content: "Apenas o comprador pode fazer ofertas.", flags: MessageFlags.Ephemeral })
  }

  const rateLimit = checkNamedLimit(interaction.user.id, "MAKE_OFFER")
  if (!rateLimit.allowed) {
    return interaction.reply({ content: `⏰ Você atingiu o limite de ofertas por hora. Tente novamente em **${rateLimit.resetIn}s**.`, flags: MessageFlags.Ephemeral })
  }

  // verificar se ja tem oferta pendente
  const pending = getLastPendingOffer(negotiation.id)
  if (pending) {
    return interaction.reply({ content: "Ja existe uma oferta pendente aguardando resposta do vendedor.", flags: MessageFlags.Ephemeral })
  }

  const announcement = getAnnouncement(negotiation.announcement_id)
  const modal = new ModalBuilder()
    .setCustomId(`offer_submit_${negotiation.id}`)
    .setTitle("Fazer Oferta")

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("value")
        .setLabel(`Valor da Oferta (R$) — Anunciado: R$ ${announcement?.valor ?? "?"}`)
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 120.00")
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("message")
        .setLabel("Mensagem (opcional)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Ex: Pago à vista via PIX agora mesmo")
        .setRequired(false)
        .setMaxLength(300)
    ),
  )

  await interaction.showModal(modal)
}

/**
 * Processa a oferta enviada
 */
export async function handleOfferSubmit(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const negotiationId = Number.parseInt(params[0])
  const negotiation = getNegotiationByChannel(interaction.channelId)

  if (!negotiation || negotiation.id !== negotiationId) {
    return interaction.editReply({ content: "Negociacao nao encontrada." })
  }

  // FIX BUG-5: parseMoney aceita formatos BR e EN corretamente.
  // .replace(",", ".") só substituía a PRIMEIRA vírgula, quebrando valores como "1.000,00"
  const value = parseMoney(interaction.fields.getTextInputValue("value"))
  if (!value || value <= 0 || value > 999999) {
    return interaction.editReply({ content: "Valor invalido. Use apenas numeros (ex: 120.00 ou 120,00)." })
  }

  const message = interaction.fields.getTextInputValue("message") || null
  const offer = createOffer(negotiationId, interaction.user.id, negotiation.seller_id, value.toFixed(2), message)
  const announcement = getAnnouncement(negotiation.announcement_id)

  const offerC = container(COLORS.WARNING)
    .addTextDisplayComponents(text(
      `## Nova Oferta Recebida\n` +
      `${interaction.user} fez uma oferta pela conta **${announcement?.nick ?? ""}**.\n\n` +
      `**Valor Original:** R$ ${announcement?.valor ?? "?"}\n` +
      `**Valor Ofertado:** R$ ${value.toFixed(2)}\n` +
      (message ? `**Mensagem:** ${message}\n` : "") +
      `\nO vendedor pode aceitar, recusar ou fazer uma contraproposta.\n\n` +
      `-# Oferta #${offer.id}`
    ))
    .addActionRowComponents(
      createRow(
        createButton({ customId: `offer_accept_${offer.id}`, label: "Aceitar Oferta", style: ButtonStyle.Success }),
        createButton({ customId: `offer_reject_${offer.id}`, label: "Recusar", style: ButtonStyle.Danger }),
        createButton({ customId: `offer_counter_${offer.id}`, label: "Contraproposta", style: ButtonStyle.Secondary }),
      )
    )

  await interaction.channel.send({ flags: CV2, components: [offerC] })
  await interaction.editReply({ content: `Oferta de R$ ${value.toFixed(2)} enviada ao vendedor!` })

  // notificar vendedor via DM
  await notifyNewOffer(client, negotiation, offer, announcement, interaction.channel)

  addLog("offer_made", interaction.user.id, negotiationId.toString(), `Oferta: R$ ${value.toFixed(2)}`)
}

/**
 * Responde uma oferta (aceitar/recusar)
 */
export async function handleOfferResponse(interaction, action, offerId, client) {
  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) {
    return interaction.reply({ content: "Negociacao nao encontrada neste canal.", flags: MessageFlags.Ephemeral })
  }

  if (interaction.user.id !== negotiation.seller_id) {
    return interaction.reply({ content: "Apenas o vendedor pode responder esta oferta.", flags: MessageFlags.Ephemeral })
  }

  // Buscar a oferta específica clicada (não a última pendente — pode haver múltiplas)
  const offer = getOfferById(Number.parseInt(offerId))

  if (!offer || offer.negotiation_id !== negotiation.id) {
    return interaction.reply({ content: "Oferta nao encontrada.", flags: MessageFlags.Ephemeral })
  }

  if (offer.status !== "pending") {
    return interaction.reply({ content: "Esta oferta ja foi respondida.", flags: MessageFlags.Ephemeral })
  }

  if (action === "accept") {
    respondOffer(offer.id, "accepted")

    const acceptC = container(COLORS.SUCCESS)
      .addTextDisplayComponents(text(
        `## Oferta Aceita!\nO vendedor aceitou a oferta de **R$ ${offer.value}**.\nCombinem os detalhes do pagamento e usem os botoes de escrow para confirmar a transacao.`
      ))

    await interaction.update({ flags: CV2, components: [acceptC] })
    addLog("offer_accepted", interaction.user.id, offer.id.toString(), `R$ ${offer.value}`)
    const _annAccept = getAnnouncement(negotiation.announcement_id)
    await notifyOfferAccepted(client, negotiation, offer, _annAccept, interaction.channel)

  } else if (action === "reject") {
    respondOffer(offer.id, "rejected")

    const rejectC = container(COLORS.DANGER)
      .addTextDisplayComponents(text(
        `## Oferta Recusada\nO vendedor recusou a oferta de **R$ ${offer.value}**.\nO comprador pode fazer uma nova oferta ou negociar diretamente.`
      ))

    await interaction.update({ flags: CV2, components: [rejectC] })
    addLog("offer_rejected", interaction.user.id, offer.id.toString(), `R$ ${offer.value}`)
    const _annReject = getAnnouncement(negotiation.announcement_id)
    await notifyOfferRejected(client, negotiation, offer, _annReject, interaction.channel)

  } else if (action === "counter") {
    // abrir modal para contraproposta
    const modal = new ModalBuilder()
      .setCustomId(`offer_countersubmit_${offer.id}_${negotiation.id}`)
      .setTitle("Contraproposta")

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("value")
          .setLabel("Novo Valor (R$)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("Ex: 150.00")
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("message")
          .setLabel("Mensagem (opcional)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false).setMaxLength(300)
      ),
    )

    await interaction.showModal(modal)
  }
}

/**
 * Processa contraproposta
 */
export async function handleCounterOfferSubmit(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const originalOfferId = Number.parseInt(params[0])
  const negotiationId = Number.parseInt(params[1])

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) return interaction.editReply({ content: "Negociacao nao encontrada." })

  // FIX BUG-5: parseMoney aceita formatos BR e EN corretamente para contraproposta.
  const value = parseMoney(interaction.fields.getTextInputValue("value"))
  if (!value || value <= 0) return interaction.editReply({ content: "Valor invalido." })

  const message = interaction.fields.getTextInputValue("message") || null

  const originalOffer = getOfferById(originalOfferId)
  respondOffer(originalOfferId, "countered")
  const counter = createOffer(negotiationId, interaction.user.id, negotiation.buyer_id, value.toFixed(2), message)
  const announcement = getAnnouncement(negotiation.announcement_id)

  const counterC = container(COLORS.INFO)
    .addTextDisplayComponents(text(
      `## Contraproposta Enviada\nO vendedor enviou uma contraproposta.\n\n` +
      `**Valor Anterior:** R$ ${originalOffer?.value ?? "?"}\n` +
      `**Nova Proposta:** R$ ${value.toFixed(2)}\n` +
      (message ? `**Mensagem:** ${message}` : "")
    ))
    .addActionRowComponents(
      createRow(
        createButton({ customId: `offer_accept_${counter.id}`, label: "Aceitar", style: ButtonStyle.Success }),
        createButton({ customId: `offer_reject_${counter.id}`, label: "Recusar", style: ButtonStyle.Danger }),
        createButton({ customId: `offer_make`, label: "Nova Oferta", style: ButtonStyle.Secondary }),
      )
    )

  await interaction.channel.send({ flags: CV2, components: [counterC] })
  await interaction.editReply({ content: "Contraproposta enviada!" })

  // notificar comprador
  await notifyCounterOffer(client, negotiation, originalOffer, counter, announcement, interaction.channel)

  addLog("counter_offer_made", interaction.user.id, negotiationId.toString(), `Contraproposta: R$ ${value.toFixed(2)}`)
}

// ======================================================
// RESERVAS
// ======================================================

/**
 * Abre modal para reservar anuncio para um comprador especifico
 */
export async function handleReserveModal(interaction, params, client) {
  const announcementId = Number.parseInt(params[0])
  const announcement = getAnnouncement(announcementId)

  if (!announcement) return interaction.reply({ content: "Anuncio nao encontrado.", flags: MessageFlags.Ephemeral })
  if (announcement.user_id !== interaction.user.id) return interaction.reply({ content: "Apenas o dono do anuncio pode reservar.", flags: MessageFlags.Ephemeral })
  if (announcement.status !== "approved") return interaction.reply({ content: "Apenas anuncios ativos podem ser reservados.", flags: MessageFlags.Ephemeral })

  const existing = getActiveReservation(announcementId)
  if (existing) return interaction.reply({ content: `Este anuncio ja esta reservado para <@${existing.buyer_id}> ate <t:${Math.floor(new Date(existing.expires_at).getTime() / 1000)}:R>.`, flags: MessageFlags.Ephemeral })

  const modal = new ModalBuilder()
    .setCustomId(`reserve_submit_${announcementId}`)
    .setTitle("Reservar Anuncio")

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("buyer_id")
        .setLabel("ID do Discord do Comprador")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 123456789012345678")
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("hours")
        .setLabel("Duração da Reserva (horas, max 72)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 24")
        .setRequired(true)
    ),
  )

  await interaction.showModal(modal)
}

/**
 * Processa reserva
 */
export async function handleReserveSubmit(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const announcementId = Number.parseInt(params[0])
  // FIX BUG-6: Sanitizar buyerId para remover menções, espaços e caracteres não numéricos
  const buyerId = interaction.fields.getTextInputValue("buyer_id").replace(/[^0-9]/g, "")
  const hoursRaw = parseInt(interaction.fields.getTextInputValue("hours"))
  const hours = isNaN(hoursRaw) || hoursRaw < 1 ? 24 : Math.min(hoursRaw, 72)

  const announcement = getAnnouncement(announcementId)
  if (!announcement) return interaction.editReply({ content: "Anuncio nao encontrado." })

  // validar ID do comprador
  let buyer
  try {
    buyer = await client.users.fetch(buyerId)
  } catch {
    return interaction.editReply({ content: "ID do Discord invalido. Copie o ID correto do usuario." })
  }

  const reservation = createReservation(announcementId, interaction.user.id, buyerId, hours)
  const expiresAt = Math.floor(new Date(reservation.expires_at).getTime() / 1000)

  // atualizar mensagem no canal de anuncios — desativar botao de interesse
  try {
    const config = client.config
    const ch = await client.channels.fetch(config.channels.anuncios)
    const msg = await ch.messages.fetch(announcement.message_id)
    const seller = await client.users.fetch(announcement.user_id).catch(() => null)
    const rating = getUserAverageRating(announcement.user_id)
    const rebuilt = buildPublicAnnouncement(announcement, seller, rating, { reserved: true })
    await msg.edit(rebuilt)
  } catch { /* mensagem pode nao existir */ }

  const reserveC = container(COLORS.INFO)
    .addTextDisplayComponents(text(
      `## Anuncio Reservado\nA conta **${announcement.nick}** foi reservada para ${buyer} por ${hours} hora(s).\n\n` +
      `**Expira em:** <t:${expiresAt}:R>\n**Reservado para:** ${buyer.username}`
    ))

  await interaction.editReply({ flags: CV2_EPHEMERAL, components: [reserveC] })

  // notificar comprador
  try {
    const buyerDmC = container(COLORS.SUCCESS)
      .addTextDisplayComponents(text(
        `## Conta Reservada Para Voce!\n` +
        `${interaction.user.username} reservou a conta **${announcement.nick}** para voce por ${hours} hora(s)!\n\n` +
        `**Valor:** R$ ${formatValor(announcement.valor)}\n**Expira:** <t:${expiresAt}:R>`
      ))
    await buyer.send({ components: [buyerDmC] })
  } catch { /* DM fechada */ }

  addLog("reservation_created", interaction.user.id, announcementId.toString(), `Reservado para: ${buyerId} por ${hours}h`)
  await logAction(client, "reservation_created", {
    userId: interaction.user.id,
    details: `**Conta:** ${announcement.nick}\n**Comprador:** <@${buyerId}>\n**Duração:** ${hours}h`,
  })
}

/**
 * Cancelar reserva
 */
export async function handleCancelReservation(interaction, params, client) {
  const announcementId = Number.parseInt(params[0])
  const announcement = getAnnouncement(announcementId)

  if (!announcement) return interaction.reply({ content: "Anuncio nao encontrado.", flags: MessageFlags.Ephemeral })

  const config = client.config
  const isStaff = interaction.member.roles.cache.has(config.roles.staff)
  if (announcement.user_id !== interaction.user.id && !isStaff) {
    return interaction.reply({ content: "Apenas o dono do anuncio ou staff pode cancelar a reserva.", flags: MessageFlags.Ephemeral })
  }

  const reservation = getActiveReservation(announcementId)
  if (!reservation) return interaction.reply({ content: "Este anuncio nao tem reserva ativa.", flags: MessageFlags.Ephemeral })

  cancelReservationByAnnouncement(announcementId)

  // reativar botao no canal
  try {
    const ch = await client.channels.fetch(config.channels.anuncios)
    const msg = await ch.messages.fetch(announcement.message_id)
    const seller = await client.users.fetch(announcement.user_id).catch(() => null)
    const rating = getUserAverageRating(announcement.user_id)
    const rebuilt = buildPublicAnnouncement(announcement, seller, rating)
    await msg.edit(rebuilt)
  } catch { /* ok */ }

  await interaction.reply({ content: `Reserva da conta **${announcement.nick}** cancelada. Anuncio disponivel novamente.`, flags: MessageFlags.Ephemeral })
  addLog("reservation_cancelled", interaction.user.id, announcementId.toString(), "Cancelado manualmente")
}

// ======================================================
// BUMP AUTOMATICO
// ======================================================

export async function handleAutoBumpCommand(interaction, client) {
  const sub = interaction.options.getSubcommand()
  const announcementId = interaction.options.getInteger("id")
  const announcement = getAnnouncement(announcementId)

  if (!announcement) return interaction.reply({ content: "Anuncio nao encontrado.", flags: MessageFlags.Ephemeral })
  if (announcement.user_id !== interaction.user.id) return interaction.reply({ content: "Apenas o dono pode gerenciar o auto-bump.", flags: MessageFlags.Ephemeral })
  if (announcement.status !== "approved") return interaction.reply({ content: "Apenas anuncios ativos podem ter auto-bump.", flags: MessageFlags.Ephemeral })

  if (sub === "ativar") {
    enableAutoBump(announcementId, interaction.user.id)
    const c = container(COLORS.SUCCESS)
      .addTextDisplayComponents(text(
        `## Auto-Bump Ativado\nO anuncio de **${announcement.nick}** sera atualizado automaticamente a cada **24 horas**.\nVoce sera notificado se houver algum problema.`
      ))
    await interaction.reply({ flags: CV2_EPHEMERAL, components: [c] })
    addLog("autobump_enabled", interaction.user.id, announcementId.toString(), announcement.nick)

  } else if (sub === "desativar") {
    disableAutoBump(announcementId)
    await interaction.reply({ content: `Auto-bump desativado para **${announcement.nick}**.`, flags: MessageFlags.Ephemeral })
    addLog("autobump_disabled", interaction.user.id, announcementId.toString(), announcement.nick)

  } else if (sub === "status") {
    const status = getAutoBumpStatus(announcementId)
    const lastBump = status?.last_bumped_at ? `<t:${Math.floor(new Date(status.last_bumped_at).getTime() / 1000)}:R>` : "Nunca"
    const c = container(status?.active ? COLORS.SUCCESS : COLORS.DANGER)
      .addTextDisplayComponents(text(
        `## Auto-Bump — ${announcement.nick}\n**Status:** ${status?.active ? "Ativo" : "Inativo"}\n**Ultimo Bump:** ${lastBump}`
      ))
    await interaction.reply({ flags: CV2_EPHEMERAL, components: [c] })
  }
}

// ======================================================
// HISTORICO DE COMPRAS
// ======================================================

export async function handleMinhasComprasCommand(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const history = getUserPurchaseHistory(interaction.user.id)

  if (history.length === 0) {
    return interaction.editReply({ content: "Voce ainda nao realizou nenhuma compra neste servidor." })
  }

  const totalSpent = history.reduce((s, h) => s + parseFloat(h.announcement?.valor ?? 0), 0)

  let lines = `## Suas Compras\n**Total de compras:** ${history.length} | **Total gasto:** R$ ${totalSpent.toFixed(2)}\n`
  for (const { negotiation, announcement } of history.slice(0, 10)) {
    const date = new Date(negotiation.completed_at).toLocaleDateString("pt-BR")
    const title = announcement ? announcement.nick : `Anuncio #${negotiation.announcement_id}`
    lines += `\n**${title}**\nR$ ${announcement?.valor ?? "?"} · <@${negotiation.seller_id}> · ${date}\n`
  }
  if (history.length > 10) lines += `\n-# Mostrando 10 de ${history.length} compras`

  const c = container(COLORS.PRIMARY)
    .addSectionComponents(section(lines, thumbnail(interaction.user.displayAvatarURL({ extension: "webp", forceStatic: false }), interaction.user.username)))
  await interaction.editReply({ flags: CV2, components: [c] })
}

// ======================================================
// INTERMEDIARIO AUTOMATICO
// ======================================================

/**
 * Verifica se a negociacao exige intermediario e notifica se sim
 */
export async function checkAndRequireIntermediary(interaction, announcement, negotiation, client) {
  const config = client.config
  const threshold = config.limits?.escrowValueThreshold ?? 500
  const valor = parseFloat(announcement.valor)

  if (valor < threshold) return false // nao requer intermediario

  // Usa o novo sistema de middleman (migration v5)
  const mm = getMiddlemanStatus(interaction.channelId)
  if (mm?.middleman_status === "active") return false // já tem middleman ativo

  const c = container(COLORS.WARNING)
    .addTextDisplayComponents(text(
      `## 🛡 Middleman Obrigatório\nEsta negociação envolve **R$ ${formatValor(announcement.valor)}**, acima do limite de **R$ ${threshold}**.\n\n` +
      `**Um membro da staff deve ser middleman antes de prosseguir.**\n\n` +
      `Use o botão **"🛡 Solicitar Middleman"** para chamar um staff.\n` +
      `Enquanto isso, os botões de confirmação não serão aceitos.`
    ))

  await interaction.channel.send({ content: `<@&${config.roles.staff}> Middleman obrigatório nesta negociação!` })
  await interaction.channel.send({ flags: CV2, components: [c] })

  return true // requer middleman
}

/**
 * Verifica se intermediario esta presente antes de confirmar escrow
 */
export async function validateIntermediaryPresence(interaction, client) {
  const config = client.config
  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) return true // sem negociacao = libera

  const announcement = getAnnouncement(negotiation.announcement_id)
  if (!announcement) return true

  const threshold = config.limits?.escrowValueThreshold ?? 500
  const valor = parseFloat(announcement.valor)

  if (valor < threshold) return true // abaixo do limite = libera

  // Usa o novo sistema de middleman (migration v5)
  const mm = getMiddlemanStatus(interaction.channelId)
  if (mm?.middleman_status === "active") return true // tem middleman ativo = libera

  await interaction.reply({
    content: `❌ Esta negociação exige um **middleman ativo** (valor R$ ${formatValor(announcement.valor)} ≥ R$ ${threshold}). Clique em 🛡 Solicitar Middleman e aguarde a staff aceitar.`,
    flags: MessageFlags.Ephemeral,
  })
  return false
}
