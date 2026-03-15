/**
 * negotiationHandler.js
 *
 * Extraído do antigo anuncioHandler.js monolítico.
 * Responsável por:
 *  - Interesse em anúncios (handleInterestButton) — FIX #1: bug result.lastInsertRowid
 *  - Escrow (confirmar entrega)
 *  - Venda concluída / cancelar negociação
 *  - Chamar staff — FIX #12: cooldown correto no callstaff
 *  - Avaliações
 *  - Comprovante de pagamento — FIX #4
 *  - Bump manual no anúncio
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags,
} from "discord.js"
import {
  getAnnouncement, createNegotiation, getNegotiationByChannel,
  markAnnouncementSold, completeNegotiation, cancelNegotiation,
  setEscrowStatus, getEscrowStatus, setEscrowIntermediary,
  createRating, hasAlreadyRated, getUserAverageRating,
  bumpAnnouncement, updateAnnouncement, getUserActiveNegotiations,
  addLog, addPaymentProof, getPaymentProofs, deleteFavoritesByAnnouncement,
  getActiveReservation,
} from "../utils/database.js"
import {
  buildSaleCompletedC2,
  buildNegotiationC2, buildPublicAnnouncementC2,
  buildNegotiationInterestDmEmbed, buildSaleCompletedDmEmbed,
  formatValor,
} from "../utils/embedBuilder.js"
import { getSkinUrls } from "../utils/minecraftAPI.js"
import { checkCooldown } from "../utils/cooldown.js"
import { logAction } from "../utils/logger.js"
import { handleProofButton } from "./pixVerificationHandler.js"
import { handleMakeOffer } from "./salesHandler.js"
import { buildFavoriteButton, notifyFavoritersOnBump } from "./favoritosHandler.js"
import { box, C2_FLAG, C2_EPHEMERAL } from "../utils/cv2.js"

// ─────────────────────────────────────────────
// INTERESSE NO ANÚNCIO — FIX #1
// ─────────────────────────────────────────────

export async function handleInterestButton(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config

  const announcementId = parseInt(params[0])
  const announcement = getAnnouncement(announcementId)

  if (!announcement) return interaction.editReply({ content: "❌ Anúncio não encontrado." })
  if (announcement.status !== "approved") return interaction.editReply({ content: "❌ Este anúncio não está mais disponível." })
  if (announcement.user_id === interaction.user.id) return interaction.editReply({ content: "❌ Você não pode negociar com seu próprio anúncio." })

  // FIX M-11: verificar se anúncio está reservado para outro usuário
  const activeReservation = getActiveReservation(announcementId)
  if (activeReservation && activeReservation.buyer_id !== interaction.user.id) {
    return interaction.editReply({ content: "❌ Este anúncio está reservado para outro usuário." })
  }

  const cooldown = checkCooldown(interaction.user.id, `interest_${announcementId}`, 30000)
  if (cooldown.onCooldown) return interaction.editReply({ content: `⏰ Aguarde ${cooldown.remaining}s antes de tentar novamente.` })

  // Verificar negociações ativas do comprador
  const activeNegs = getUserActiveNegotiations(interaction.user.id)
  const alreadyNegotiating = activeNegs.find((n) => n.announcement_id === announcementId)
  if (alreadyNegotiating) {
    return interaction.editReply({ content: `❌ Você já tem uma negociação ativa para este anúncio em <#${alreadyNegotiating.ticket_channel_id}>.` })
  }

  const maxNegs = config.limits?.maxNegotiationsPerUser ?? 3
  if (activeNegs.length >= maxNegs)
    return interaction.editReply({ content: `❌ Você já tem ${activeNegs.length} negociações ativas (máximo: ${maxNegs}).` })

  try {
    const buyer = interaction.user
    const seller = await client.users.fetch(announcement.user_id)

    // Criar canal de negociação
    const guild = interaction.guild
    const category = config.categories?.negociacoes
      ? await guild.channels.fetch(config.categories.negociacoes).catch(() => null)
      : null

    const channelName = `neg-${announcement.nick.toLowerCase().replace(/[^a-z0-9]/g, "")}-${buyer.username.toLowerCase().replace(/[^a-z0-9]/g, "")}`

    const ticketChannel = await guild.channels.create({
      name: channelName,
      parent: category ?? undefined,
      permissionOverwrites: [
        { id: guild.roles.everyone, deny: ["ViewChannel"] },
        { id: buyer.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: seller.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
        { id: config.roles.staff, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory"] },
      ],
    })

    // FIX #1: guardar resultado do createNegotiation
    const negResult = createNegotiation(announcementId, buyer.id, seller.id, ticketChannel.id)
    const negotiationId = negResult.lastInsertRowid

    addLog("negotiation_started", buyer.id, String(negotiationId), `Anúncio #${announcementId} — ${announcement.nick}`)

    // ── Select Menu: ações secundárias (substituí 7 botões em 2 rows) ──────────
    const negActionsSelect = new StringSelectMenuBuilder()
      .setCustomId("neg_actions")
      .setPlaceholder("🛠️ Ações da Negociação...")
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel("📎 Enviar Comprovante").setDescription("Enviar URL do comprovante de pagamento").setValue(`neg_proof_${negotiationId}`),
        new StringSelectMenuOptionBuilder().setLabel("🧾 Ver Comprovantes").setDescription("Ver todos os comprovantes enviados").setValue(`neg_viewproofs_${negotiationId}`),
        new StringSelectMenuOptionBuilder().setLabel("💸 Fazer Oferta").setDescription("Propor outro valor ao vendedor").setValue("offer_make"),
        new StringSelectMenuOptionBuilder().setLabel("🔒 Confirmar Entrega").setDescription("Vendedor: confirmar que entregou a conta").setValue(`escrow_seller_${announcementId}`),
        new StringSelectMenuOptionBuilder().setLabel("✅ Confirmar Recebimento").setDescription("Comprador: confirmar que recebeu a conta").setValue(`escrow_buyer_${announcementId}`),
        new StringSelectMenuOptionBuilder().setLabel("📣 Chamar Staff").setDescription("Solicitar ajuda da equipe").setValue("neg_callstaff"),
        new StringSelectMenuOptionBuilder().setLabel("🛡️ Solicitar Intermediário").setDescription("Staff assume como intermediário desta negociação").setValue("neg_callintermediary"),
      )

    // ── Botões críticos mantidos como botões (ações irreversíveis) ───────────
    const row1 = new ActionRowBuilder().addComponents(negActionsSelect)
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`neg_complete_${announcementId}`).setLabel("✅ Venda Concluída").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`neg_cancel_${announcementId}`).setLabel("❌ Cancelar Negociação").setStyle(ButtonStyle.Danger),
    )

    const negContainer = buildNegotiationC2(announcement, buyer, seller)
    await ticketChannel.send({ components: [appendRows(negContainer, row1, row2)], flags: C2_FLAG })

    // DM ao vendedor — melhorada (fix #10)
    try {
      await seller.send({ embeds: [buildNegotiationInterestDmEmbed(buyer, announcement, ticketChannel)] })
    } catch { /* DM fechada */ }

    await logAction(client, "negotiation_started", {
      userId: buyer.id,
      targetId: String(negotiationId),
      details: `**Nick:** ${announcement.nick}\n**Valor:** R$ ${formatValor(announcement.valor)}\n**Comprador:** <@${buyer.id}>\n**Vendedor:** <@${seller.id}>`,
      thumbnail: getSkinUrls(announcement.uuid).body,
    })

    await interaction.editReply({ content: `✅ Canal de negociação criado: ${ticketChannel}` })
  } catch (err) {
    console.error("[NEG] Erro ao criar negociação:", err)
    await interaction.editReply({ content: "❌ Erro ao criar canal de negociação. Tente novamente." })
  }
}

// ─────────────────────────────────────────────
// SELECT MENU: neg_actions → roteamento de ações
// ─────────────────────────────────────────────

export async function handleNegActionsSelect(interaction, client) {
  const value = interaction.values[0]

  if (value.startsWith("neg_proof_")) {
    const negId = parseInt(value.split("_")[2])
    await handlePaymentProofButton(interaction, [negId], client)
  } else if (value.startsWith("neg_viewproofs_")) {
    const negId = parseInt(value.split("_")[2])
    // View proofs inline
    const proofs = getPaymentProofs(negId)
    if (!proofs || proofs.length === 0) {
      return interaction.reply({ content: "❌ Nenhum comprovante enviado ainda.", flags: MessageFlags.Ephemeral })
    }
    const lines = proofs.map((p, i) => `**${i + 1}.** ${p.url}${p.filename ? ` — ${p.filename}` : ""} (<@${p.user_id}>)`).join("\n")
    await interaction.reply({ components: [box(`## 🧾 Comprovantes (${proofs.length})\n\n${lines}`)], flags: C2_EPHEMERAL })
  } else if (value === "offer_make") {
    await handleMakeOffer(interaction, client)
  } else if (value.startsWith("escrow_seller_")) {
    const annId = value.replace("escrow_seller_", "")
    await handleEscrowButton(interaction, ["seller", annId], client)
  } else if (value.startsWith("escrow_buyer_")) {
    const annId = value.replace("escrow_buyer_", "")
    await handleEscrowButton(interaction, ["buyer", annId], client)
  } else if (value === "neg_callstaff") {
    await handleCallStaff(interaction, client)
  } else if (value === "neg_callintermediary") {
    await handleCallIntermediary(interaction, client)
  }
}

// ─────────────────────────────────────────────
// ESCROW
// ─────────────────────────────────────────────

export async function handleEscrowButton(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config
  const party = params[0] // "seller" | "buyer"

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) return interaction.editReply({ content: "Negociação não encontrada neste canal." })

  const isSeller = interaction.user.id === negotiation.seller_id
  const isBuyer  = interaction.user.id === negotiation.buyer_id

  if (party === "seller" && !isSeller) return interaction.editReply({ content: "❌ Apenas o vendedor pode confirmar a entrega." })
  if (party === "buyer"  && !isBuyer)  return interaction.editReply({ content: "❌ Apenas o comprador pode confirmar o recebimento." })

  // Verificar se intermediário é obrigatório
  const announcement = getAnnouncement(negotiation.announcement_id)
  const threshold = config.limits?.escrowValueThreshold ?? 500
  if (parseFloat(announcement?.valor ?? 0) >= threshold) {
    const escrow = getEscrowStatus(interaction.channelId)
    if (!escrow?.intermediary) {
      return interaction.editReply({ content: `❌ Esta negociação exige um staff intermediário (valor R$ ${formatValor(announcement.valor)} ≥ R$ ${threshold}). Aguarde um staff usar **"Intermediário (Staff)"**.` })
    }
  }

  const updated = setEscrowStatus(interaction.channelId, party, true)
  const escrow = updated.escrow

  const label = party === "seller" ? "entrega" : "recebimento"
  await interaction.editReply({ content: `✅ Você confirmou o ${label}!` })

  await interaction.channel.send({
    components: [box(
      `## 🔒 Escrow — ${party === "seller" ? "Vendedor" : "Comprador"} Confirmou\n\n` +
      `<@${interaction.user.id}> confirmou o ${label}.\n\n` +
      `Vendedor: ${escrow.seller_confirmed ? "✅ Confirmado" : "⏳ Pendente"}   Comprador: ${escrow.buyer_confirmed ? "✅ Confirmado" : "⏳ Pendente"}`,
      0x00D166
    )],
    flags: C2_FLAG,
  })

  addLog("escrow_confirmed", interaction.user.id, String(negotiation.id), `Party: ${party}`)
  await logAction(client, "escrow_confirmed", { userId: interaction.user.id, details: `**Party:** ${party}\n**Canal:** ${interaction.channel.name}` })
}

// ─────────────────────────────────────────────
// CHAMAR STAFF — FIX #12: cooldown correto
// ─────────────────────────────────────────────

export async function handleCallStaff(interaction, client) {
  const config = client.config

  const cooldown = checkCooldown(interaction.user.id, "callstaff", 60000)
  if (cooldown.onCooldown) {
    return interaction.reply({ content: `⏰ Aguarde ${cooldown.remaining}s antes de chamar a staff novamente.`, flags: MessageFlags.Ephemeral })
  }

  // FIX #10: incluir contexto da negociação no ping da staff
  const negotiation = getNegotiationByChannel(interaction.channelId)
  let contextText = ""
  if (negotiation) {
    const announcement = getAnnouncement(negotiation.announcement_id)
    contextText = announcement
      ? `\n> 📌 **Conta:** ${announcement.nick} · **Valor:** R$ ${formatValor(announcement.valor)}\n> 👤 **Comprador:** <@${negotiation.buyer_id}> · **Vendedor:** <@${negotiation.seller_id}>`
      : `\n> 👤 **Comprador:** <@${negotiation.buyer_id}> · **Vendedor:** <@${negotiation.seller_id}>`
  }

  // FIX A-6: usar deferReply para evitar InteractionAlreadyReplied em race conditions
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply()
  }

  await interaction.editReply({
    content: `<@&${config.roles.staff}> ${interaction.user} está solicitando ajuda!${contextText}`,
  })

  addLog("staff_called", interaction.user.id, interaction.channelId, "Chamado no canal de negociação")
  await logAction(client, "staff_called", { userId: interaction.user.id, details: `**Canal:** <#${interaction.channelId}>${contextText}` })
}

// ─────────────────────────────────────────────
// INTERMEDIÁRIO OBRIGATÓRIO
// ─────────────────────────────────────────────

export async function handleCallIntermediary(interaction, client) {
  const config = client.config
  if (!interaction.member.roles.cache.has(config.roles.staff)) {
    return interaction.reply({ content: "❌ Apenas staff pode se tornar intermediário.", flags: MessageFlags.Ephemeral })
  }

  setEscrowIntermediary(interaction.channelId, interaction.user.id)

  await interaction.reply({
    components: [box(
      `## 🛡️ Intermediário Confirmado\n\n${interaction.user} é o intermediário desta negociação.\n\nAs partes agora podem confirmar o escrow.`,
      0x3498DB
    )],
    flags: C2_FLAG,
  })

  addLog("intermediary_set", interaction.user.id, interaction.channelId, "Intermediário definido")
}

// ─────────────────────────────────────────────
// COMPROVANTE DE PAGAMENTO — FIX #4
// ─────────────────────────────────────────────

export async function handlePaymentProofButton(interaction, params, client) {
  const negotiationId = parseInt(params[0])
  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation || negotiation.id !== negotiationId)
    return interaction.reply({ content: "❌ Negociação não encontrada.", flags: MessageFlags.Ephemeral })

  if (interaction.user.id !== negotiation.buyer_id && interaction.user.id !== negotiation.seller_id)
    return interaction.reply({ content: "❌ Apenas as partes da negociação podem enviar comprovante.", flags: MessageFlags.Ephemeral })

  const modal = new ModalBuilder()
    .setCustomId(`neg_proof_submit_${negotiationId}`)
    .setTitle("Enviar Comprovante de Pagamento")

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("url")
        .setLabel("URL do Comprovante (imagem ou Google Drive)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("https://...  ou cole o link do comprovante")
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("descricao")
        .setLabel("Descrição (opcional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: PIX de R$150 enviado às 14:23")
        .setRequired(false)
        .setMaxLength(200)
    ),
  )

  await interaction.showModal(modal)
}

export async function handlePaymentProofSubmit(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const negotiationId = parseInt(params[0])

  const url = interaction.fields.getTextInputValue("url").trim()
  const desc = interaction.fields.getTextInputValue("descricao")?.trim() || null

  // FIX #7: Validar URL e domínio contra lista de serviços conhecidos
  const ALLOWED_DOMAINS = [
    "imgur.com", "i.imgur.com",
    "drive.google.com", "docs.google.com",
    "photos.google.com",
    "ibb.co", "i.ibb.co",
    "gyazo.com", "i.gyazo.com",
    "prnt.sc", "i.prntscr.com",
    "cdn.discordapp.com", "media.discordapp.net",
    "postimg.cc", "i.postimg.cc",
    "lightshot.am4.ru",
    "picpay.com.br", "nubank.com.br",
    "itau.com.br", "bb.com.br", "bradesco.com.br",
  ]

  let parsedUrl
  try {
    parsedUrl = new URL(url)
    if (parsedUrl.protocol !== "https:") throw new Error("HTTP não permitido")
  } catch {
    return interaction.editReply({ content: "❌ URL inválida. Use um link https:// completo." })
  }

  const host = parsedUrl.hostname.toLowerCase()
  const isAllowed = ALLOWED_DOMAINS.some((d) => host === d || host.endsWith("." + d))

  if (!isAllowed) {
    return interaction.editReply({
      content:
        "❌ Domínio não aceito. Use serviços confiáveis como:\n" +
        "• **Imagens:** Imgur, Google Drive, Discord, Gyazo, PostImg\n" +
        "• **Comprovantes bancários:** Print do app do seu banco\n\n" +
        "Faça upload da imagem em um desses serviços e cole o link.",
    })
  }

  const proof = addPaymentProof(negotiationId, interaction.user.id, url, desc)

  const proofContent =
    `## 📎 Comprovante de Pagamento Enviado\n\n` +
    `${interaction.user} enviou um comprovante.\n\n` +
    `[Ver comprovante](${url})${desc ? `  — ${desc}` : ""}\nEnviado em: <t:${Math.floor(Date.now() / 1000)}:f>\n\n` +
    `-# ID do comprovante: #${proof.id}`
  await interaction.channel.send({ components: [box(proofContent, 0x00D166)], flags: C2_FLAG })
  await interaction.editReply({ content: "✅ Comprovante registrado!" })

  addLog("payment_proof_added", interaction.user.id, String(negotiationId), url)
}

export async function handleViewProofs(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const negotiationId = parseInt(params[0])
  const proofs = getPaymentProofs(negotiationId)

  if (!proofs.length) return interaction.editReply({ content: "Nenhum comprovante enviado ainda." })

  const proofLines = proofs.map(p =>
    `**#${p.id}** — <@${p.user_id}>\n[Ver comprovante](${p.url})${p.filename ? ` — ${p.filename}` : ""}  Enviado: <t:${Math.floor(new Date(p.created_at).getTime() / 1000)}:R>`
  ).join("\n\n")
  await interaction.editReply({
    components: [box(`## 🧾 Comprovantes — Negociação #${negotiationId}\n\nTotal: **${proofs.length}** comprovante(s)\n\n${proofLines}`, 0x7289DA)],
    flags: C2_EPHEMERAL,
  })
}

// ─────────────────────────────────────────────
// VENDA CONCLUÍDA
// ─────────────────────────────────────────────

export async function handleCompleteSale(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config
  const announcementId = parseInt(params[0])

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) return interaction.editReply({ content: "Negociação não encontrada." })
  if (negotiation.status !== "active") return interaction.editReply({ content: "Esta negociação já foi encerrada." })

  const isSeller = interaction.user.id === negotiation.seller_id
  const isBuyer  = interaction.user.id === negotiation.buyer_id
  if (!isSeller && !isBuyer) return interaction.editReply({ content: "❌ Apenas as partes podem encerrar a negociação." })

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`neg_confirmclose_${announcementId}`).setLabel("✅ Confirmar").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`neg_cancelclose`).setLabel("❌ Voltar").setStyle(ButtonStyle.Secondary),
  )
  await interaction.editReply({
    components: [
      box("## ⚠️ Confirmar Venda Concluída?\n\nAo confirmar, a venda será registrada e **não poderá ser desfeita**.\nAmbas as partes poderão avaliar após o fechamento.", 0xFFA500),
      row,
    ],
    flags: C2_EPHEMERAL,
  })
}

export async function handleConfirmClose(interaction, params, client) {
  // FIX: botão vem de editReply ephemeral → deferUpdate() falha, usar deferReply ephemeral
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation || negotiation.status !== "active") {
    return interaction.editReply({ content: "Negociação não encontrada ou já encerrada." })
  }

  const announcement = getAnnouncement(negotiation.announcement_id)

  markAnnouncementSold(negotiation.announcement_id)
  completeNegotiation(interaction.channelId)

  // FIX S-4: Limpar favoritos do anúncio vendido
  try { deleteFavoritesByAnnouncement(negotiation.announcement_id) } catch { /* ok */ }

  await interaction.editReply({ content: "✅ Venda confirmada! Processando..." })

  // Remover do canal de anúncios
  try {
    const ch = await client.channels.fetch(config.channels.anuncios)
    const msg = await ch.messages.fetch(announcement.message_id).catch(() => null)
    if (msg) await msg.delete()
  } catch { /* ok */ }

  const saleContainer = buildSaleCompletedC2(announcement, negotiation.buyer_id, negotiation.seller_id)

  const ratingRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rate_${negotiation.id}_buyer`).setLabel("⭐ Avaliar Comprador").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`rate_${negotiation.id}_seller`).setLabel("⭐ Avaliar Vendedor").setStyle(ButtonStyle.Primary),
  )

  await interaction.channel.send({ components: [saleContainer, ratingRow], flags: C2_FLAG })

  // DMs (fix #10)
  try {
    const buyer  = await client.users.fetch(negotiation.buyer_id)
    const seller = await client.users.fetch(negotiation.seller_id)
    await buyer.send({ embeds:  [buildSaleCompletedDmEmbed(announcement, "buyer",  seller.tag,  interaction.guild)] })
    await seller.send({ embeds: [buildSaleCompletedDmEmbed(announcement, "seller", buyer.tag,   interaction.guild)] })
  } catch { /* DM fechada */ }

  addLog("sale_completed", interaction.user.id, String(negotiation.id), `Nick: ${announcement.nick} — R$ ${formatValor(announcement.valor)}`)

  await logAction(client, "sale_completed", {
    userId: interaction.user.id,
    targetId: String(negotiation.id),
    details: `**Nick:** ${announcement.nick}\n**Valor:** R$ ${formatValor(announcement.valor)}\n**Comprador:** <@${negotiation.buyer_id}>\n**Vendedor:** <@${negotiation.seller_id}>`,
    thumbnail: getSkinUrls(announcement.uuid).body,
  })

  // Canal fica 5 minutos aberto para que as partes possam avaliar
  setTimeout(async () => {
    try { await interaction.channel.delete() } catch { /* ok */ }
  }, 300000)
}

// ─────────────────────────────────────────────
// CANCELAR NEGOCIAÇÃO
// ─────────────────────────────────────────────

export async function handleCancelNegotiation(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation || negotiation.status !== "active") return interaction.editReply({ content: "Negociação não encontrada ou já encerrada." })

  const isSeller = interaction.user.id === negotiation.seller_id
  const isBuyer  = interaction.user.id === negotiation.buyer_id
  const isStaff  = interaction.member.roles.cache.has(client.config.roles.staff)
  if (!isSeller && !isBuyer && !isStaff) return interaction.editReply({ content: "❌ Sem permissão." })

  cancelNegotiation(interaction.channelId)

  await interaction.channel.send({
    components: [box(`## ❌ Negociação Cancelada\n\n${interaction.user} cancelou a negociação.\nO anúncio voltará para o canal de vendas.`, 0xFF4444)],
    flags: C2_FLAG,
  })
  await interaction.editReply({ content: "Negociação cancelada." })

  addLog("negotiation_cancelled", interaction.user.id, String(negotiation.id), `Canal: ${interaction.channelId}`)
  await logAction(client, "negotiation_cancelled", { userId: interaction.user.id, targetId: String(negotiation.id) })

  setTimeout(async () => {
    try { await interaction.channel.delete() } catch { /* ok */ }
  }, 10000)
}

// ─────────────────────────────────────────────
// AVALIAÇÕES
// ─────────────────────────────────────────────

export async function handleRatingButton(interaction, params, client) {
  const negotiationId = parseInt(params[0])
  const targetRole = params[1] // "buyer" | "seller"

  // FIX BUG-7: Removido o fallback inválido { id: negotiationId, buyer_id: null, seller_id: null }.
  // Antes, se getNegotiationByChannel retornasse null, o objeto com buyer_id/seller_id nulos
  // era usado silenciosamente, causando erros difíceis de rastrear.
  // Agora retorna erro claro se a negociação não for encontrada no canal.
  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) {
    return interaction.reply({ content: "❌ Negociação não encontrada neste canal.", flags: MessageFlags.Ephemeral })
  }

  if (hasAlreadyRated(negotiationId, interaction.user.id))
    return interaction.reply({ content: "❌ Você já avaliou esta transação.", flags: MessageFlags.Ephemeral })

  const modal = new ModalBuilder()
    .setCustomId(`rating_submit_${negotiationId}_${targetRole}`)
    .setTitle(`Avaliar ${targetRole === "buyer" ? "Comprador" : "Vendedor"}`)

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("stars")
        .setLabel("Nota (1 a 5)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 5")
        .setRequired(true)
        .setMaxLength(1)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("comment")
        .setLabel("Comentário (opcional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(300)
    ),
  )

  await interaction.showModal(modal)
}

export async function handleRatingSubmit(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const negotiationId = parseInt(params[0])
  const targetRole = params[1] // "buyer" | "seller"

  const starsRaw = interaction.fields.getTextInputValue("stars")
  const stars = parseInt(starsRaw)
  if (isNaN(stars) || stars < 1 || stars > 5)
    return interaction.editReply({ content: "❌ Nota inválida. Use um número de 1 a 5." })

  const comment = interaction.fields.getTextInputValue("comment")?.trim() || null

  // Descobrir quem é o rated
  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation || negotiation.id !== negotiationId)
    return interaction.editReply({ content: "Negociação não encontrada." })

  // FIX M-10: verificar se negociação foi completada antes de aceitar avaliação
  if (negotiation.status !== "completed")
    return interaction.editReply({ content: "❌ Avaliações só podem ser enviadas após a venda ser concluída." })

  if (hasAlreadyRated(negotiationId, interaction.user.id))
    return interaction.editReply({ content: "Você já avaliou esta transação." })

  const ratedId = targetRole === "buyer" ? negotiation.buyer_id : negotiation.seller_id
  if (!ratedId) return interaction.editReply({ content: "Usuário não encontrado." })

  createRating({ negotiationId, raterId: interaction.user.id, ratedId, stars, comment })

  const starEmoji = "★".repeat(stars) + "☆".repeat(5 - stars)
  await interaction.channel.send({
    components: [box(`## ⭐ Avaliação Registrada!\n\n${interaction.user} avaliou <@${ratedId}> com **${starEmoji}** (${stars}/5)${comment ? `\n\n> ${comment}` : ""}`, 0xFFD700)],
    flags: C2_FLAG,
  })
  await interaction.editReply({ content: "✅ Avaliação enviada!" })

  addLog("rating_created", interaction.user.id, String(negotiationId), `${stars}/5 para <@${ratedId}>`)
  await logAction(client, "rating_created", {
    userId: interaction.user.id,
    details: `**Avaliado:** <@${ratedId}>\n**Nota:** ${stars}/5\n**Comentário:** ${comment ?? "—"}`,
  })
}

// ─────────────────────────────────────────────
// BUMP MANUAL (via botão no anúncio público)
// ─────────────────────────────────────────────

export async function handleBumpAnnouncement(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config
  const announcementId = parseInt(params[0])
  const announcement = getAnnouncement(announcementId)

  if (!announcement || announcement.user_id !== interaction.user.id)
    return interaction.editReply({ content: "❌ Você não tem permissão para bumpar este anúncio." })

  const cooldown = checkCooldown(interaction.user.id, `bump_${announcementId}`, 24 * 3_600_000)
  if (cooldown.onCooldown) {
    const hours = Math.floor(cooldown.remaining / 3600)
    const mins  = Math.floor((cooldown.remaining % 3600) / 60)
    return interaction.editReply({ content: `⏰ Aguarde **${hours}h ${mins}m** para bumpar novamente.` })
  }

  try {
    const announcementChannel = await client.channels.fetch(config.channels.anuncios)
    const old = await announcementChannel.messages.fetch(announcement.message_id).catch(() => null)
    if (old) await old.delete()

    const seller = await client.users.fetch(announcement.user_id)
    const sellerRating = getUserAverageRating(announcement.user_id)
    const namemc = `https://namemc.com/profile/${announcement.uuid}`

    const bumpContainer = buildPublicAnnouncementC2(announcement, seller, sellerRating)
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`interest_${announcementId}`).setLabel("Tenho Interesse").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setURL(namemc).setLabel("Ver no NameMC").setStyle(ButtonStyle.Link),
      buildFavoriteButton(announcementId),
    )
    const newMsg = await announcementChannel.send({ components: [appendRows(bumpContainer, row)], flags: C2_FLAG })
    bumpAnnouncement(announcementId)
    updateAnnouncement(announcementId, { message_id: newMsg.id })
    notifyFavoritersOnBump(client, getAnnouncement(announcementId)).catch(() => {})
    await interaction.editReply({ content: "✅ Anúncio bumpeado com sucesso!" })
  } catch (err) {
    console.error("[BUMP] Erro:", err)
    await interaction.editReply({ content: "❌ Erro ao fazer bump. Tente novamente." })
  }
}

// ─────────────────────────────────────────────
// ROUTER PRINCIPAL
// ─────────────────────────────────────────────

export async function handleNegotiationButton(interaction, action, params, client) {
  if (action === "interest") return handleInterestButton(interaction, params, client)
  if (action === "neg") {
    const sub = params[0]
    if (sub === "complete")       return handleCompleteSale(interaction, params.slice(1), client)
    if (sub === "cancel")         return handleCancelNegotiation(interaction, params.slice(1), client)
    if (sub === "callstaff")      return handleCallStaff(interaction, client)
    if (sub === "callintermediary") return handleCallIntermediary(interaction, client)
    if (sub === "proof")          return handleProofButton(interaction, params.slice(1), client) // roteado para pixVerificationHandler
    if (sub === "viewproofs")     return handleViewProofs(interaction, params.slice(1), client)
    if (sub === "confirmclose")   return handleConfirmClose(interaction, params.slice(1), client)
    if (sub === "cancelclose") {
      // FIX: botão vem de editReply ephemeral → deferUpdate() falha
      await interaction.deferReply({ flags: MessageFlags.Ephemeral })
      return interaction.editReply({ content: "Ação cancelada." })
    }
  }
  if (action === "escrow") return handleEscrowButton(interaction, params, client)
  if (action === "rate")   return handleRatingButton(interaction, params, client)
}
