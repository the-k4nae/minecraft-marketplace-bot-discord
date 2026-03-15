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
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} from "discord.js"
import {
  getAnnouncement, getNegotiationByChannel, createOffer,
  getLastPendingOffer, respondOffer, addLog,
  getOfferById, getUserPurchaseHistory,
} from "../utils/database.js"
import { parseMoney } from "../utils/embedBuilder.js"
import { box, C2_FLAG, C2_EPHEMERAL } from "../utils/cv2.js"

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

  const offerContent =
    `## 💸 Nova Oferta Recebida\n\n` +
    `${interaction.user} fez uma oferta pela conta **${announcement?.nick ?? ""}**.\n\n` +
    `**Valor Original:** R$ ${announcement?.valor ?? "?"}   **Valor Ofertado:** R$ ${value.toFixed(2)}\n` +
    (message ? `**Mensagem:** ${message}\n` : "") +
    `\nO vendedor pode aceitar, recusar ou fazer uma contraproposta.\n\n` +
    `-# Oferta #${offer.id}`
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`offer_accept_${offer.id}`).setLabel("✅ Aceitar").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`offer_reject_${offer.id}`).setLabel("❌ Recusar").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`offer_counter_${offer.id}`).setLabel("💬 Contraproposta").setStyle(ButtonStyle.Secondary),
  )
  await interaction.channel.send({ components: [boxWithRows(offerContent, 0xFFA500, [row])], flags: C2_FLAG })
  await interaction.editReply({ content: `Oferta de R$ ${value.toFixed(2)} enviada ao vendedor!` })

  // notificar vendedor via DM
  try {
    const seller = await client.users.fetch(negotiation.seller_id)
    await seller.send(`${interaction.user.tag} fez uma oferta de **R$ ${value.toFixed(2)}** pela sua conta **${announcement?.nick}**! Responda no canal de negociacao: ${interaction.channel}`)
  } catch { /* DM fechada */ }

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

    await interaction.update({
      components: [box(`## ✅ Oferta Aceita!\n\nO vendedor aceitou a oferta de **R$ ${offer.value}**.\nCombinem os detalhes do pagamento e usem os botões de escrow para confirmar.`, 0x00D166)],
      flags: C2_FLAG,
    })
    addLog("offer_accepted", interaction.user.id, offer.id.toString(), `R$ ${offer.value}`)

  } else if (action === "reject") {
    respondOffer(offer.id, "rejected")

    const offerRejContent = `## ❌ Oferta Recusada\n\nO vendedor recusou a oferta de **R$ ${offer.value}**.\nO comprador pode fazer uma nova oferta ou negociar diretamente.`

    await interaction.update({ components: [box(offerRejContent, 0xFF4444)], flags: C2_FLAG })
    addLog("offer_rejected", interaction.user.id, offer.id.toString(), `R$ ${offer.value}`)

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

  respondOffer(originalOfferId, "countered")
  const counter = createOffer(negotiationId, interaction.user.id, negotiation.buyer_id, value.toFixed(2), message)
  const announcement = getAnnouncement(negotiation.announcement_id)

  const counterContent =
    `## 💬 Contraproposta Enviada\n\nO vendedor enviou uma contraproposta.\n\n` +
    `**Valor Anterior:** R$ ${getOfferById(originalOfferId)?.value ?? "?"}   **Nova Proposta:** R$ ${value.toFixed(2)}\n` +
    (message ? `**Mensagem:** ${message}` : "")
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`offer_accept_${counter.id}`).setLabel("Aceitar").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`offer_reject_${counter.id}`).setLabel("Recusar").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`offer_make`).setLabel("Nova Oferta").setStyle(ButtonStyle.Secondary),
  )

  await interaction.channel.send({ components: [boxWithRows(counterContent, 0x7289DA, [row])], flags: C2_FLAG })
  await interaction.editReply({ content: "Contraproposta enviada!" })

  // notificar comprador
  try {
    const buyer = await client.users.fetch(negotiation.buyer_id)
    await buyer.send(`O vendedor enviou uma contraproposta de **R$ ${value.toFixed(2)}** para a conta **${announcement?.nick}**! Responda no canal: ${interaction.channel}`)
  } catch { /* DM fechada */ }

  addLog("counter_offer_made", interaction.user.id, negotiationId.toString(), `Contraproposta: R$ ${value.toFixed(2)}`)
}

// ======================================================
// RESERVAS
// ======================================================

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

  const comprasLines = history.slice(0, 10).map(({ negotiation, announcement }) => {
    const date = new Date(negotiation.completed_at).toLocaleDateString("pt-BR")
    const nick = announcement ? announcement.nick : `Anúncio #${negotiation.announcement_id}`
    return `**${nick}** — R$ ${announcement?.valor ?? "?"}  Vendedor: <@${negotiation.seller_id}>  Data: ${date}`
  }).join("\n")
  const comprasContent =
    `## 🛒 Suas Compras\n\n` +
    `**Total de compras:** ${history.length}  **Total gasto:** R$ ${totalSpent.toFixed(2)}\n\n` +
    comprasLines
  const comprasFooter = history.length > 10 ? `\n\n-# Mostrando 10 de ${history.length} compras` : ""
  await interaction.editReply({
    components: [box(comprasContent + comprasFooter, 0x5865F2)],
    flags: C2_EPHEMERAL,
  })
}

