/**
 * pixVerificationHandler.js
 *
 * Verificação semi-automática de comprovantes de pagamento PIX.
 *
 * Como funciona:
 *  - Ligável/desligável pelo staff via /staff → Config
 *  - Quando ligado, o modal de comprovante ganha campos extras:
 *      • Valor pago (R$)
 *      • Tipo de pagamento (PIX / TED / DOC / Outro)
 *      • Chave PIX de destino (opcional)
 *  - Bot compara valor declarado vs valor da negociação
 *  - Se houver discrepância > tolerância (padrão 1%), marca como ⚠️ SUSPEITO
 *  - Embed no canal de negociação já mostra o alerta para a staff
 *  - Log separado enviado ao canal de logs/antiscam com detalhes
 *
 * Toggle:
 *  - config.features.pixVerification = true | false
 *  - Alterado via painel /staff → Config → "Verificação PIX"
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, MessageFlags,
} from "discord.js"
import {
  addPaymentProof, getNegotiationById,
  getAnnouncement, addLog, updateConfig, getConfig,
} from "../utils/database.js"
import { COLORS, parseMoney } from "../utils/embedBuilder.js"
import { box, C2_FLAG } from "../utils/cv2.js"
import { sendLogEmbed } from "../utils/logger.js"

// ─────────────────────────────────────────────
// VERIFICAR SE PIX ESTÁ LIGADO
// ─────────────────────────────────────────────

export function isPixVerificationEnabled(client) {
  // Prioridade: config dinâmica (banco) → config.json → false
  const dynConfig = getConfig()
  if (dynConfig?.features?.pixVerification !== undefined)
    return Boolean(dynConfig.features.pixVerification)
  return Boolean(client.config?.features?.pixVerification ?? false)
}

// ─────────────────────────────────────────────
// TOGGLE — chamado pelo staffHandler
// ─────────────────────────────────────────────

export function togglePixVerification(enable) {
  updateConfig("features.pixVerification", enable ? "1" : "0")
  console.log(`[PIX] Verificação de comprovante ${enable ? "ATIVADA" : "DESATIVADA"}`)
}

// ─────────────────────────────────────────────
// MODAL DE COMPROVANTE — versão com verificação PIX
// ─────────────────────────────────────────────

export async function showProofModalWithPix(interaction, negotiationId) {
  const modal = new ModalBuilder()
    .setCustomId(`neg_proof_submit_${negotiationId}`)
    .setTitle("📎 Enviar Comprovante de Pagamento")

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("url")
        .setLabel("Link do comprovante (print/screenshot)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("https://i.imgur.com/... ou link do Drive")
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("valor_pago")
        .setLabel("Valor pago (R$) — ex: 150.00")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("150.00")
        .setRequired(true)
        .setMaxLength(12)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("tipo_pagamento")
        .setLabel("Tipo de pagamento")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("PIX / TED / DOC / Outro")
        .setRequired(true)
        .setMaxLength(20)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("chave_pix")
        .setLabel("Chave PIX de destino (opcional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("CPF, e-mail, celular ou chave aleatória")
        .setRequired(false)
        .setMaxLength(100)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("descricao")
        .setLabel("Observação (opcional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(200)
    )
  )

  await interaction.showModal(modal)
}

// Modal simples sem verificação PIX (quando desligado)
export async function showProofModalSimple(interaction, negotiationId) {
  const modal = new ModalBuilder()
    .setCustomId(`neg_proof_submit_${negotiationId}`)
    .setTitle("📎 Enviar Comprovante de Pagamento")

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("url")
        .setLabel("Link do comprovante")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("https://i.imgur.com/...")
        .setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("descricao")
        .setLabel("Descrição (opcional)")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
    )
  )

  await interaction.showModal(modal)
}

// ─────────────────────────────────────────────
// BOTÃO "ENVIAR COMPROVANTE" — decide qual modal mostrar
// ─────────────────────────────────────────────

export async function handleProofButton(interaction, params, client) {
  const negotiationId = parseInt(params[0])
  if (isNaN(negotiationId))
    return interaction.reply({ content: "❌ Negociação inválida.", flags: MessageFlags.Ephemeral })

  if (isPixVerificationEnabled(client)) {
    await showProofModalWithPix(interaction, negotiationId)
  } else {
    await showProofModalSimple(interaction, negotiationId)
  }
}

// ─────────────────────────────────────────────
// SUBMIT DO COMPROVANTE — com ou sem verificação PIX
// ─────────────────────────────────────────────

const ALLOWED_DOMAINS = [
  "imgur.com", "i.imgur.com",
  "drive.google.com", "docs.google.com",
  "ibb.co", "i.ibb.co",
  "gyazo.com", "i.gyazo.com",
  "prnt.sc", "i.prntscr.com",
  "cdn.discordapp.com", "media.discordapp.net",
  "postimg.cc", "i.postimg.cc",
]

export async function handlePaymentProofSubmit(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const negotiationId = parseInt(params[0])
  const pixEnabled = isPixVerificationEnabled(client)

  // Campos comuns
  const url       = interaction.fields.getTextInputValue("url").trim()
  const descricao = interaction.fields.getTextInputValue("descricao")?.trim() || null

  // Campos extras (só quando PIX está ligado)
  const valorPagoRaw   = pixEnabled ? interaction.fields.getTextInputValue("valor_pago")?.trim() : null
  const tipoPagamento  = pixEnabled ? interaction.fields.getTextInputValue("tipo_pagamento")?.trim() : null
  const chavePix       = pixEnabled ? (interaction.fields.getTextInputValue("chave_pix")?.trim() || null) : null

  // Validar URL
  let parsedUrl
  try {
    parsedUrl = new URL(url)
    if (parsedUrl.protocol !== "https:") throw new Error("HTTP não permitido")
  } catch {
    return interaction.editReply({ content: "❌ URL inválida. Use um link https:// completo." })
  }

  const host = parsedUrl.hostname.toLowerCase()
  const isAllowed = ALLOWED_DOMAINS.some(d => host === d || host.endsWith("." + d))
  if (!isAllowed) {
    return interaction.editReply({
      content:
        "❌ Domínio não aceito. Use serviços confiáveis como:\n" +
        "• **Imagens:** Imgur, Google Drive, Discord, Gyazo, PostImg\n\n" +
        "Faça upload da imagem em um desses serviços e cole o link.",
    })
  }

  // ── Verificação PIX ────────────────────────────────────
  let pixAlert = null
  let valorPago = null

  if (pixEnabled && valorPagoRaw) {
    valorPago = parseMoney(valorPagoRaw)
    if (valorPago === null || valorPago <= 0) {
      return interaction.editReply({ content: "❌ Valor pago inválido. Use formato: 150,00 ou 150.00" })
    }

    // Buscar valor esperado da negociação
    const neg = getNegotiationById(negotiationId)
    if (neg) {
      const ann = getAnnouncement(neg.announcement_id)
      if (ann) {
        const valorEsperado = Number(ann.valor)
        const diff = Math.abs(valorPago - valorEsperado)
        const diffPct = valorEsperado > 0 ? (diff / valorEsperado) * 100 : 0
        const TOLERANCE_PCT = 1 // 1% de tolerância para taxas bancárias

        if (diffPct > TOLERANCE_PCT) {
          pixAlert = {
            valorPago,
            valorEsperado,
            diff: diff.toFixed(2),
            diffPct: diffPct.toFixed(1),
            isSuspicious: true,
          }
        }
      }
    }
  }

  // Salvar comprovante
  const filename = descricao ?? tipoPagamento ?? null
  const proof = addPaymentProof(negotiationId, interaction.user.id, url, filename)
  addLog("payment_proof_added", interaction.user.id, String(negotiationId), url)

  // ── Embed no canal de negociação ──────────────────────
  const isAlert = pixAlert?.isSuspicious

  const alertWarning = isAlert ? "\n\n🚨 **A verificação de valor detectou uma discrepância!**" : ""
  const pixContent =
    `## ${isAlert ? "⚠️ Comprovante Enviado — VERIFICAÇÃO FALHOU" : "📎 Comprovante de Pagamento Enviado"}\n\n` +
    `${interaction.user} enviou um comprovante.${alertWarning}\n\n` +
    `🔗 [Ver comprovante](${url})` +
    (tipoPagamento ? `   💳 **Tipo:** ${tipoPagamento}` : "") +
    (valorPago != null ? `   💰 **Valor declarado:** R$ ${valorPago.toFixed(2)}` : "") +
    (pixAlert ? `   💰 **Valor esperado:** R$ ${pixAlert.valorEsperado.toFixed(2)}   📊 **Diferença:** R$ ${pixAlert.diff} (${pixAlert.diffPct}%)` : "") +
    (chavePix ? `\n🔑 **Chave PIX:** \`${chavePix}\`` : "") +
    (descricao ? `   📝 **Obs:** ${descricao}` : "") +
    `\n🕐 **Enviado em:** <t:${Math.floor(Date.now() / 1000)}:f>\n\n` +
    `-# ID #${proof.id}${pixEnabled ? " · Verificação PIX ativada" : ""}`

  // Botão de staff para marcar como verificado/suspeito (só quando PIX ligado e suspeito)
  const components = []
  if (isAlert) {
    const staffRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`pix_approve_${proof.id}`).setLabel("✅ Aprovar mesmo assim").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`pix_flag_${proof.id}`).setLabel("🚫 Marcar como fraudulento").setStyle(ButtonStyle.Danger),
    )
    components.push(staffRow)
  }

  await interaction.channel.send({ components: [appendRows(box(pixContent, isAlert ? 0xFF4444 : 0x00D166), ...components)], flags: C2_FLAG })
  await interaction.editReply({ content: isAlert
    ? "⚠️ Comprovante registrado, mas a verificação de valor detectou uma diferença. A staff foi notificada."
    : "✅ Comprovante registrado com sucesso!"
  })

  // ── Alerta para staff (quando há discrepância) ─────────
  if (isAlert) {
    await sendLogEmbed(client, {
      title: "⚠️ Comprovante PIX Suspeito",
      description:
        `Comprovante **#${proof.id}** na negociação **#${negotiationId}** tem discrepância de valor!\n` +
        `Enviado por <@${interaction.user.id}> em <#${interaction.channelId}>`,
      color: "#FF0000",
      type: "suspicious_activity",
      fields: [
        { name: "Valor Declarado",  value: `R$ ${valorPago.toFixed(2)}`,             inline: true },
        { name: "Valor Esperado",   value: `R$ ${pixAlert.valorEsperado.toFixed(2)}`, inline: true },
        { name: "Diferença",        value: `${pixAlert.diffPct}%`,                    inline: true },
        ...(chavePix ? [{ name: "Chave PIX", value: `\`${chavePix}\``, inline: false }] : []),
        { name: "Canal",            value: `<#${interaction.channelId}>`,             inline: false },
        { name: "Comprovante",      value: `[Ver](${url})`,                           inline: true },
      ],
    })
  }
}

// ─────────────────────────────────────────────
// BOTÕES DE STAFF — aprovar/marcar como fraude
// ─────────────────────────────────────────────

export async function handlePixStaffAction(interaction, action, proofId, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  if (!interaction.member.roles.cache.has(client.config.roles.staff)) {
    return interaction.editReply({ content: "❌ Apenas staff pode usar este botão." })
  }

  if (action === "approve") {
    // Mensagem é C2 — editar substituindo o container pelo texto de aprovação, sem botões
    try {
      await interaction.message.edit({
        components: [box(`## ✅ Comprovante Verificado pela Staff\n\nAprovado por <@${interaction.user.id}>`, 0x00D166)],
        flags: C2_FLAG,
      })
    } catch { /* ok */ }

    addLog("pix_proof_approved", interaction.user.id, String(proofId))
    return interaction.editReply({ content: "✅ Comprovante marcado como aprovado." })
  }

  if (action === "flag") {
    // Mensagem é C2 — editar substituindo o container pelo texto de fraude, sem botões
    try {
      await interaction.message.edit({
        components: [box(
          `## 🚫 Comprovante Marcado como SUSPEITO pela Staff\n\n⚠️ Marcado por <@${interaction.user.id}>\n\n**Ação necessária:** Verifique a negociação antes de prosseguir.`,
          0xFF4444
        )],
        flags: C2_FLAG,
      })
    } catch { /* ok */ }

    await sendLogEmbed(client, {
      title: "🚫 Comprovante Marcado como Fraude",
      description: `Comprovante **#${proofId}** marcado como fraudulento por <@${interaction.user.id}>`,
      color: "#FF0000",
      type: "suspicious_activity",
    })

    addLog("pix_proof_flagged", interaction.user.id, String(proofId))
    return interaction.editReply({ content: "🚫 Comprovante marcado como suspeito. Staff notificada." })
  }
}

// ─────────────────────────────────────────────
// PAINEL DE STATUS DA VERIFICAÇÃO PIX
// Para exibição no /staff → Config
// ─────────────────────────────────────────────

export function buildPixStatusEmbed(enabled) {
  return new EmbedBuilder()
    .setColor(enabled ? COLORS.SUCCESS : COLORS.DANGER)
    .setTitle(`${enabled ? "🟢" : "🔴"} Verificação PIX — ${enabled ? "ATIVADA" : "DESATIVADA"}`)
    .setDescription(
      enabled
        ? "**O que está ativo:**\n" +
          "• Modal de comprovante com campos extras (valor, tipo, chave PIX)\n" +
          "• Comparação automática do valor declarado vs valor da negociação\n" +
          "• Alerta para staff quando houver diferença > 1%\n" +
          "• Botões de staff para aprovar/marcar como suspeito"
        : "**Modo simples ativo:**\n" +
          "• Modal de comprovante padrão (URL + descrição)\n" +
          "• Sem validação de valor\n\n" +
          "Ative para ter verificação automática de comprovantes."
    )
    .setFooter({ text: "Clique no botão abaixo para alternar" })
    .setTimestamp()
}
