/**
 * middlemanHandler.js
 *
 * Sistema completo de Middleman (Intermediário) para negociações.
 *
 * Fluxo:
 *  1. Comprador ou vendedor clica em "🛡 Solicitar Middleman"
 *  2. Bot posta embed no canal + pinga staff com botões Aceitar/Recusar
 *  3. Staff aceita → torna-se middleman, recebe painel de controle exclusivo
 *  4. Middleman pode:
 *     - ✅ Aprovar a transação (libera o escrow para ambos confirmarem)
 *     - ⚠️ Abrir disputa (mostra botões de resolução: Comprador / Vendedor / Cancelar)
 *     - 📝 Adicionar nota (aparece no canal)
 *  5. Ao resolver, middleman declara vencedor e negociação é encerrada
 *
 * CustomIds:
 *  mm_request                  → handleRequestMiddleman
 *  mm_accept                   → handleMiddlemanAccept
 *  mm_reject                   → handleMiddlemanReject
 *  mm_approve                  → handleMiddlemanApprove
 *  mm_dispute                  → handleMiddlemanOpenDispute
 *  mm_resolve_buyer            → handleMiddlemanResolve(buyer)
 *  mm_resolve_seller           → handleMiddlemanResolve(seller)
 *  mm_resolve_cancel           → handleMiddlemanResolve(cancel)
 *  mm_note                     → showNoteModal
 *  mm_note_submit              → handleNoteSubmit (modal)
 */

import {
  ActionRowBuilder,
  ModalBuilder, TextInputBuilder,
  TextInputStyle, MessageFlags, ButtonStyle,
} from "discord.js"
import {
  getNegotiationByChannel, getAnnouncement, addLog, cancelNegotiation,
  setMiddlemanRequested, setMiddlemanActive, setMiddlemanResolution,
  getMiddlemanStatus,
} from "../utils/database.js"
import {
  CV2, container, text, separator, section, thumbnail,
  createRow, createButton, formatValor, COLORS,
} from "../utils/components.js"
import { logAction } from "../utils/logger.js"
import { checkCooldown } from "../utils/cooldown.js"

// ─────────────────────────────────────────────
// BUILDERS DE EMBED
// ─────────────────────────────────────────────

function buildRequestContainer(requester, announcement, negotiation) {
  return container(COLORS.WARNING)
    .addTextDisplayComponents(text(
      `## 🛡 Solicitação de Middleman\n` +
      `<@${requester.id}> solicitou um **intermediário (middleman)** para esta negociação.\n` +
      `Um membro da staff deve aceitar para supervisionar a transação.\n\n` +
      `🎮 **Conta:** ${announcement?.nick ?? "—"}\n` +
      `💰 **Valor:** R$ ${formatValor(announcement?.valor ?? 0)}\n` +
      `👤 **Comprador:** <@${negotiation.buyer_id}>\n` +
      `🏷️ **Vendedor:** <@${negotiation.seller_id}>\n` +
      `📌 **Solicitante:** <@${requester.id}>\n\n` +
      `-# Aguardando um staff aceitar...`
    ))
}

function buildActiveMiddlemanContainer(middleman, announcement, negotiation) {
  return container(COLORS.ESCROW)
    .addTextDisplayComponents(text(
      `## 🛡 Middleman Ativo\n` +
      `<@${middleman.id}> é o **middleman** desta negociação.\n\n` +
      `Ambas as partes devem conduzir a negociação sob sua supervisão.\n` +
      `O middleman tem autoridade para aprovar ou abrir disputa.\n\n` +
      `🎮 **Conta:** ${announcement?.nick ?? "—"}\n` +
      `💰 **Valor:** R$ ${formatValor(announcement?.valor ?? 0)}\n` +
      `👤 **Comprador:** <@${negotiation.buyer_id}>\n` +
      `🏷️ **Vendedor:** <@${negotiation.seller_id}>\n` +
      `🛡 **Middleman:** <@${middleman.id}>`
    ))
}

function buildDisputeContainer(middleman) {
  return container(COLORS.DANGER)
    .addTextDisplayComponents(text(
      `## ⚠️ Disputa Aberta\n` +
      `<@${middleman.id}> abriu uma **disputa** nesta negociação.\n\n` +
      `O middleman irá analisar as evidências e determinar o resultado.\n\n` +
      `-# Aguardando resolução do middleman...`
    ))
}

function buildResolvedContainer(middleman, resolution) {
  const labels = {
    buyer:  { emoji: "🏆", title: "Favorável ao Comprador", color: COLORS.SUCCESS },
    seller: { emoji: "🏆", title: "Favorável ao Vendedor",  color: COLORS.SUCCESS },
    cancel: { emoji: "❌", title: "Negociação Cancelada",   color: COLORS.DANGER },
  }
  const r = labels[resolution] ?? labels.cancel
  const desc = resolution === "buyer"
    ? `O middleman <@${middleman.id}> determinou que a razão está com o **comprador**.\nO vendedor deve devolver ou não concluir a transação.`
    : resolution === "seller"
    ? `O middleman <@${middleman.id}> determinou que a razão está com o **vendedor**.\nO comprador deve efetuar ou confirmar o pagamento.`
    : `O middleman <@${middleman.id}> encerrou a negociação sem vencedor.\nA negociação foi **cancelada**.`
  return container(r.color)
    .addTextDisplayComponents(text(`## ${r.emoji} Resolução do Middleman — ${r.title}\n${desc}`))
}

// ─────────────────────────────────────────────
// BOTÕES DE STAFF (aceitar/recusar solicitação)
// ─────────────────────────────────────────────

function buildStaffActionRow() {
  return createRow(
    createButton({ customId: "mm_accept", label: "✅ Aceitar como Middleman", style: ButtonStyle.Success }),
    createButton({ customId: "mm_reject", label: "❌ Recusar", style: ButtonStyle.Danger }),
  )
}

// ─────────────────────────────────────────────
// PAINEL DO MIDDLEMAN ATIVO
// ─────────────────────────────────────────────

function buildMiddlemanControlRow() {
  return createRow(
    createButton({ customId: "mm_approve", label: "✅ Aprovar Transação", style: ButtonStyle.Success }),
    createButton({ customId: "mm_dispute", label: "⚠️ Abrir Disputa", style: ButtonStyle.Danger }),
    createButton({ customId: "mm_note", label: "📝 Adicionar Nota", style: ButtonStyle.Secondary }),
  )
}

// ─────────────────────────────────────────────
// BOTÕES DE RESOLUÇÃO DE DISPUTA
// ─────────────────────────────────────────────

function buildDisputeResolveRow() {
  return createRow(
    createButton({ customId: "mm_resolve_buyer", label: "🏆 Ganhou: Comprador", style: ButtonStyle.Primary }),
    createButton({ customId: "mm_resolve_seller", label: "🏆 Ganhou: Vendedor", style: ButtonStyle.Primary }),
    createButton({ customId: "mm_resolve_cancel", label: "❌ Cancelar Negociação", style: ButtonStyle.Danger }),
  )
}

// ─────────────────────────────────────────────
// 1. SOLICITAR MIDDLEMAN
// ─────────────────────────────────────────────

export async function handleRequestMiddleman(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) {
    return interaction.editReply({ content: "❌ Negociação não encontrada neste canal." })
  }

  const isBuyer  = interaction.user.id === negotiation.buyer_id
  const isSeller = interaction.user.id === negotiation.seller_id

  if (!isBuyer && !isSeller) {
    return interaction.editReply({ content: "❌ Apenas as partes da negociação podem solicitar um middleman." })
  }

  if (negotiation.status !== "active") {
    return interaction.editReply({ content: "❌ Esta negociação já foi encerrada." })
  }

  // Verificar se já tem middleman ativo ou solicitado
  const mm = getMiddlemanStatus(interaction.channelId)
  if (mm?.middleman_status === "active") {
    return interaction.editReply({ content: `❌ Esta negociação já tem um middleman ativo: <@${mm.middleman_id}>.` })
  }
  if (mm?.middleman_status === "pending") {
    return interaction.editReply({ content: "❌ Já existe uma solicitação de middleman pendente neste canal." })
  }

  // Cooldown de 2 minutos por canal
  const cd = checkCooldown(interaction.channelId, "mm_request", 120_000)
  if (cd.onCooldown) {
    return interaction.editReply({ content: `⏰ Aguarde ${cd.remaining}s antes de solicitar novamente.` })
  }

  const announcement = getAnnouncement(negotiation.announcement_id)

  // Marcar como pendente no banco
  setMiddlemanRequested(interaction.channelId, interaction.user.id)
  addLog("middleman_requested", interaction.user.id, String(negotiation.id), `Canal: ${interaction.channelId}`)

  const requestC   = buildRequestContainer(interaction.user, announcement, negotiation)
  const staffRow   = buildStaffActionRow()
  requestC.addActionRowComponents(staffRow)

  // Mention em mensagem separada (content não pode coexistir com CV2)
  await interaction.channel.send({ content: `<@&${config.roles.staff}> — Solicitação de middleman nesta negociação!` })
  await interaction.channel.send({ flags: CV2, components: [requestC] })

  await logAction(client, "middleman_requested", {
    userId: interaction.user.id,
    details: `**Canal:** <#${interaction.channelId}>\n**Conta:** ${announcement?.nick ?? "—"}\n**Valor:** R$ ${formatValor(announcement?.valor ?? 0)}\n**Comprador:** <@${negotiation.buyer_id}>\n**Vendedor:** <@${negotiation.seller_id}>`,
  })

  await interaction.editReply({ content: "✅ Solicitação enviada! Aguarde um membro da staff aceitar." })
}

// ─────────────────────────────────────────────
// 2. STAFF ACEITA
// ─────────────────────────────────────────────

export async function handleMiddlemanAccept(interaction, client) {
  await interaction.deferUpdate()
  const config = client.config

  if (!interaction.member.roles.cache.has(config.roles.staff)) {
    return interaction.followUp({ content: "❌ Apenas membros da staff podem aceitar como middleman.", flags: MessageFlags.Ephemeral })
  }

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) {
    return interaction.followUp({ content: "❌ Negociação não encontrada.", flags: MessageFlags.Ephemeral })
  }

  const mm = getMiddlemanStatus(interaction.channelId)
  if (mm?.middleman_status === "active") {
    return interaction.followUp({ content: `❌ Já há um middleman ativo: <@${mm.middleman_id}>.`, flags: MessageFlags.Ephemeral })
  }
  if (!mm || mm.middleman_status !== "pending") {
    return interaction.followUp({ content: "❌ Não há solicitação pendente neste canal.", flags: MessageFlags.Ephemeral })
  }

  const announcement = getAnnouncement(negotiation.announcement_id)

  // Registrar middleman ativo
  setMiddlemanActive(interaction.channelId, interaction.user.id)
  addLog("middleman_accepted", interaction.user.id, String(negotiation.id), `Middleman definido`)

  // Atualizar a mensagem original (remover botões)
  const activeC = buildActiveMiddlemanContainer(interaction.user, announcement, negotiation)
  await interaction.editReply({
    content: null,
    flags: CV2,
    components: [activeC],
  })

  // Postar painel de controle visível apenas para o middleman
  const controlC = container(COLORS.INFO)
    .addTextDisplayComponents(text(
      `## 🎛️ Painel do Middleman\nVocê é o middleman desta negociação.\n\n` +
      `Use os botões abaixo para gerenciar:\n` +
      `• **Aprovar** → libera a negociação para escrow final\n` +
      `• **Abrir Disputa** → congela a negociação e inicia análise\n` +
      `• **Nota** → posta uma nota visível para as partes`
    ))
    .addActionRowComponents(buildMiddlemanControlRow())

  await interaction.channel.send({
    flags: CV2,
    components: [controlC],
  })

  await logAction(client, "middleman_accepted", {
    userId: interaction.user.id,
    details: `**Canal:** <#${interaction.channelId}>\n**Conta:** ${announcement?.nick ?? "—"}\n**Comprador:** <@${negotiation.buyer_id}>\n**Vendedor:** <@${negotiation.seller_id}>`,
  })
}

// ─────────────────────────────────────────────
// 3. STAFF RECUSA
// ─────────────────────────────────────────────

export async function handleMiddlemanReject(interaction, client) {
  await interaction.deferUpdate()
  const config = client.config

  if (!interaction.member.roles.cache.has(config.roles.staff)) {
    return interaction.followUp({ content: "❌ Apenas membros da staff podem recusar a solicitação.", flags: MessageFlags.Ephemeral })
  }

  const mm = getMiddlemanStatus(interaction.channelId)
  if (!mm || mm.middleman_status !== "pending") {
    return interaction.followUp({ content: "❌ Não há solicitação pendente para recusar.", flags: MessageFlags.Ephemeral })
  }

  // Limpar solicitação
  setMiddlemanResolution(interaction.channelId, null, "rejected")
  addLog("middleman_rejected", interaction.user.id, interaction.channelId, `Recusado por ${interaction.user.username}`)

  const rejectC = container(COLORS.DANGER)
    .addTextDisplayComponents(text(
      `## ❌ Solicitação de Middleman Recusada\n<@${interaction.user.id}> recusou a solicitação de middleman.\nAs partes podem solicitar novamente ou prosseguir normalmente.`
    ))

  await interaction.editReply({
    content: null,
    flags: CV2,
    components: [rejectC],
  })
}

// ─────────────────────────────────────────────
// 4. MIDDLEMAN APROVA TRANSAÇÃO
// ─────────────────────────────────────────────

export async function handleMiddlemanApprove(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) return interaction.editReply({ content: "❌ Negociação não encontrada." })

  const mm = getMiddlemanStatus(interaction.channelId)
  if (!mm || mm.middleman_status !== "active") {
    return interaction.editReply({ content: "❌ Não há middleman ativo nesta negociação." })
  }
  if (mm.middleman_id !== interaction.user.id) {
    return interaction.editReply({ content: "❌ Apenas o middleman desta negociação pode aprovar." })
  }

  // Marcar resolução como aprovada
  setMiddlemanResolution(interaction.channelId, interaction.user.id, "approved")
  addLog("middleman_approved", interaction.user.id, String(negotiation.id), "Transação aprovada pelo middleman")

  const approveC = container(COLORS.SUCCESS)
    .addTextDisplayComponents(text(
      `## ✅ Transação Aprovada pelo Middleman\n` +
      `<@${interaction.user.id}> aprovou esta negociação.\n\n` +
      `As partes agora podem confirmar o **escrow** normalmente para concluir a venda.\n\n` +
      `👤 **Comprador:** <@${negotiation.buyer_id}>\n🏷️ **Vendedor:** <@${negotiation.seller_id}>`
    ))

  // Desabilitar painel do middleman (editar para remover botões)
  try {
    await interaction.message.edit({ components: [] })
  } catch { /* ignora se mensagem não for encontrada */ }

  await interaction.channel.send({ flags: CV2, components: [approveC] })

  await logAction(client, "middleman_approved", {
    userId: interaction.user.id,
    details: `**Canal:** <#${interaction.channelId}>\n**Comprador:** <@${negotiation.buyer_id}>\n**Vendedor:** <@${negotiation.seller_id}>`,
  })

  await interaction.editReply({ content: "✅ Transação aprovada com sucesso!" })
}

// ─────────────────────────────────────────────
// 5. MIDDLEMAN ABRE DISPUTA
// ─────────────────────────────────────────────

export async function handleMiddlemanOpenDispute(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) return interaction.editReply({ content: "❌ Negociação não encontrada." })

  const mm = getMiddlemanStatus(interaction.channelId)
  if (!mm || mm.middleman_status !== "active") {
    return interaction.editReply({ content: "❌ Não há middleman ativo nesta negociação." })
  }
  if (mm.middleman_id !== interaction.user.id) {
    return interaction.editReply({ content: "❌ Apenas o middleman desta negociação pode abrir disputa." })
  }

  // Atualizar status para "disputed"
  setMiddlemanResolution(interaction.channelId, interaction.user.id, "disputed")
  addLog("middleman_dispute_opened", interaction.user.id, String(negotiation.id), "Disputa aberta")

  const disputeC    = buildDisputeContainer(interaction.user)
  const resolveRow  = buildDisputeResolveRow()
  disputeC.addActionRowComponents(resolveRow)

  // Desabilitar painel anterior
  try {
    await interaction.message.edit({ components: [] })
  } catch { /* ignora */ }

  await interaction.channel.send({ content: `<@${negotiation.buyer_id}> <@${negotiation.seller_id}> — O middleman abriu uma disputa.` })
  await interaction.channel.send({ flags: CV2, components: [disputeC] })

  await logAction(client, "middleman_dispute_opened", {
    userId: interaction.user.id,
    details: `**Canal:** <#${interaction.channelId}>\n**Comprador:** <@${negotiation.buyer_id}>\n**Vendedor:** <@${negotiation.seller_id}>`,
  })

  await interaction.editReply({ content: "⚠️ Disputa aberta. Resolva usando os botões no canal." })
}

// ─────────────────────────────────────────────
// 6. MIDDLEMAN RESOLVE DISPUTA
// ─────────────────────────────────────────────

export async function handleMiddlemanResolve(interaction, resolution, client) {
  await interaction.deferUpdate()

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) {
    return interaction.followUp({ content: "❌ Negociação não encontrada.", flags: MessageFlags.Ephemeral })
  }

  const mm = getMiddlemanStatus(interaction.channelId)
  if (!mm || !["active", "disputed"].includes(mm.middleman_status)) {
    return interaction.followUp({ content: "❌ Não há disputa ativa nesta negociação.", flags: MessageFlags.Ephemeral })
  }
  if (mm.middleman_id !== interaction.user.id) {
    return interaction.followUp({ content: "❌ Apenas o middleman desta negociação pode resolver a disputa.", flags: MessageFlags.Ephemeral })
  }

  const finalStatus = resolution === "cancel" ? "cancelled" : "resolved"
  setMiddlemanResolution(interaction.channelId, interaction.user.id, finalStatus, resolution)

  if (resolution === "cancel") {
    // Cancelar negociação
    cancelNegotiation(interaction.channelId)
  }

  addLog(`middleman_resolved_${resolution}`, interaction.user.id, String(negotiation.id), `Resolução: ${resolution}`)

  const resolvedC = buildResolvedContainer(interaction.user, resolution)

  // Remover botões da mensagem de disputa
  await interaction.editReply({
    content: null,
    components: [],
  })

  await interaction.channel.send({ content: `<@${negotiation.buyer_id}> <@${negotiation.seller_id}>` })
  await interaction.channel.send({ flags: CV2, components: [resolvedC] })

  await logAction(client, "middleman_resolved", {
    userId: interaction.user.id,
    details: `**Resolução:** ${resolution}\n**Canal:** <#${interaction.channelId}>\n**Comprador:** <@${negotiation.buyer_id}>\n**Vendedor:** <@${negotiation.seller_id}>`,
  })
}

// ─────────────────────────────────────────────
// 7. MIDDLEMAN ADICIONA NOTA (Modal)
// ─────────────────────────────────────────────

export async function handleMiddlemanNoteModal(interaction, client) {
  const mm = getMiddlemanStatus(interaction.channelId)
  if (!mm || mm.middleman_status !== "active") {
    return interaction.reply({ content: "❌ Não há middleman ativo nesta negociação.", flags: MessageFlags.Ephemeral })
  }
  if (mm.middleman_id !== interaction.user.id) {
    return interaction.reply({ content: "❌ Apenas o middleman pode adicionar notas.", flags: MessageFlags.Ephemeral })
  }

  const modal = new ModalBuilder()
    .setCustomId("mm_note_submit")
    .setTitle("📝 Nota do Middleman")

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("note_text")
        .setLabel("Nota (visível para comprador e vendedor)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Ex: Aguardando envio de comprovante pelo comprador...")
        .setMinLength(10)
        .setMaxLength(500)
        .setRequired(true)
    )
  )

  await interaction.showModal(modal)
}

export async function handleMiddlemanNoteSubmit(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const negotiation = getNegotiationByChannel(interaction.channelId)
  if (!negotiation) return interaction.editReply({ content: "❌ Negociação não encontrada." })

  const mm = getMiddlemanStatus(interaction.channelId)
  if (!mm || mm.middleman_status !== "active" || mm.middleman_id !== interaction.user.id) {
    return interaction.editReply({ content: "❌ Apenas o middleman ativo pode postar notas." })
  }

  const note = interaction.fields.getTextInputValue("note_text").trim()

  addLog("middleman_note", interaction.user.id, String(negotiation.id), note.substring(0, 200))

  const noteC = container(COLORS.INFO)
    .addTextDisplayComponents(text(`## 📝 Nota do Middleman\n-# ${interaction.user.username}\n\n${note}`))

  await interaction.channel.send({ flags: CV2, components: [noteC] })
  await interaction.editReply({ content: "✅ Nota publicada com sucesso." })
}

// ─────────────────────────────────────────────
// ROUTER PRINCIPAL
// ─────────────────────────────────────────────

export async function handleMiddlemanButton(interaction, action, client) {
  if (action === "mm_request")         return handleRequestMiddleman(interaction, client)
  if (action === "mm_accept")          return handleMiddlemanAccept(interaction, client)
  if (action === "mm_reject")          return handleMiddlemanReject(interaction, client)
  if (action === "mm_approve")         return handleMiddlemanApprove(interaction, client)
  if (action === "mm_dispute")         return handleMiddlemanOpenDispute(interaction, client)
  if (action === "mm_resolve_buyer")   return handleMiddlemanResolve(interaction, "buyer",  client)
  if (action === "mm_resolve_seller")  return handleMiddlemanResolve(interaction, "seller", client)
  if (action === "mm_resolve_cancel")  return handleMiddlemanResolve(interaction, "cancel", client)
  if (action === "mm_note")            return handleMiddlemanNoteModal(interaction, client)
}
