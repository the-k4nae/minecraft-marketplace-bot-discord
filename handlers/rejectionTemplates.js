/**
 * FEATURE 6 — Templates de recusa rápida com Select Menu
 *
 * Substitui o modal de texto livre de rejeição por um Select Menu
 * com motivos pré-definidos + opção "Outro motivo" que ainda abre modal.
 *
 * Fluxo:
 *   Botão "❌ Recusar" → Select Menu com templates → seleciona motivo pré-definido
 *   → rejeição imediata com o texto escolhido
 *   OU seleciona "Outro motivo..." → abre modal de texto livre (comportamento atual)
 *
 * ── Como aplicar ──────────────────────────────────────────────────────────────
 * 1. Em handlers/anuncioHandler.js, substitua o bloco action === "reject"
 *    pelo showRejectionTemplates() abaixo.
 * 2. Em events/interactionCreate.js, adicione rota para o select menu:
 *      if (id === "reject_template_select") return handleRejectionTemplateSelect(interaction, client)
 */

import {
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
  ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  MessageFlags,
} from "discord.js"
import { rejectAnnouncement, getAnnouncement, addLog } from "../utils/database.js"
import { buildRejectionDm } from "../utils/components.js"
import { logAction } from "../utils/logger.js"

// ─── Templates de motivo ──────────────────────────────────────────────────────

export const REJECTION_TEMPLATES = [
  {
    id: "foto_ilegivel",
    label: "📷 Foto ilegível ou inválida",
    description: "Screenshot não mostra a conta, está desfocada ou editada",
    message: "A foto enviada está ilegível, desfocada ou não mostra claramente a conta anunciada. Envie uma screenshot nítida diretamente do jogo, sem edições.",
  },
  {
    id: "nick_invalido",
    label: "❌ Nick inexistente ou incorreto",
    description: "O nickname não foi encontrado na API Mojang",
    message: "O nickname informado não foi encontrado na API da Mojang. Verifique se o nick está correto (sensível a maiúsculas) e tente novamente.",
  },
  {
    id: "valor_invalido",
    label: "💰 Valor fora do padrão",
    description: "Preço muito baixo, muito alto ou suspeito",
    message: "O valor informado está fora dos padrões aceitos no servidor (muito baixo, muito alto ou suspeito). Ajuste o preço para um valor realista de mercado.",
  },
  {
    id: "info_incompleta",
    label: "📋 Informações incompletas",
    description: "Campos obrigatórios em branco ou genéricos demais",
    message: "O anúncio está com informações incompletas ou genéricas demais. Preencha todos os campos com detalhes reais da conta (bans, VIPs, cosméticos, etc.).",
  },
  {
    id: "conta_duplicada",
    label: "⚠️ Conta já anunciada",
    description: "UUID ou nick já existe em outro anúncio ativo",
    message: "Identificamos que esta conta já está sendo anunciada no servidor (mesmo UUID ou nick). Não é permitido ter múltiplos anúncios da mesma conta simultaneamente.",
  },
  {
    id: "blacklist",
    label: "🚫 Usuário na blacklist",
    description: "Rejeição por histórico do vendedor",
    message: "Sua conta foi identificada na nossa lista de restrições. Entre em contato com a staff via ticket de suporte para mais informações.",
  },
  {
    id: "foto_editada",
    label: "🖼️ Foto com edições suspeitas",
    description: "Imagem parece ter sido manipulada",
    message: "A imagem enviada apresenta sinais de edição ou manipulação. Apenas screenshots originais e sem alterações são aceitas. Tire uma nova foto diretamente do jogo.",
  },
  {
    id: "outro",
    label: "✏️ Outro motivo...",
    description: "Digitar um motivo personalizado",
    message: null,  // null = abre modal
  },
]

// ─── Mostrar select menu de templates ────────────────────────────────────────

/**
 * Substitui em handleAnnouncementButton() action === "reject":
 *
 * Antes:
 *   const modal = new ModalBuilder()...
 *   return interaction.showModal(modal)
 *
 * Depois:
 *   return showRejectionTemplates(interaction, announcementId)
 */
export async function showRejectionTemplates(interaction, announcementId) {
  const options = REJECTION_TEMPLATES.map(t =>
    new StringSelectMenuOptionBuilder()
      .setLabel(t.label)
      .setDescription(t.description)
      .setValue(`${announcementId}__${t.id}`),
  )

  const select = new StringSelectMenuBuilder()
    .setCustomId("reject_template_select")
    .setPlaceholder("Selecione o motivo da recusa...")
    .addOptions(options)

  const row = new ActionRowBuilder().addComponents(select)

  await interaction.reply({
    content: `**Recusar anúncio #${announcementId}** — Escolha o motivo:`,
    components: [row],
    flags: MessageFlags.Ephemeral,
  })
}

// ─── Handler do select menu ───────────────────────────────────────────────────

/**
 * Adicionar em events/interactionCreate.js dentro de isStringSelectMenu():
 *   if (id === "reject_template_select") return handleRejectionTemplateSelect(interaction, client)
 */
export async function handleRejectionTemplateSelect(interaction, client) {
  const [announcementIdStr, templateId] = interaction.values[0].split("__")
  const announcementId = parseInt(announcementIdStr)
  const template = REJECTION_TEMPLATES.find(t => t.id === templateId)

  if (!template) {
    return interaction.update({ content: "❌ Template não encontrado.", components: [] })
  }

  // "Outro motivo" → abrir modal (showModal DEVE ser a primeira resposta à interação)
  if (template.id === "outro") {
    const modal = new ModalBuilder()
      .setCustomId(`reject_reason_${announcementId}`)
      .setTitle("Motivo da Rejeição")

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Motivo (será enviado ao vendedor)")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(500)
          .setPlaceholder("Descreva o motivo da recusa com detalhes..."),
      ),
    )

    return interaction.showModal(modal)
  }

  // Template selecionado → rejeitar diretamente
  await interaction.update({ content: `⏳ Rejeitando com motivo: **${template.label}**...`, components: [] })

  await _executeRejection(interaction, announcementId, template.message, client)
}

// ─── Execução da rejeição ─────────────────────────────────────────────────────

async function _executeRejection(interaction, announcementId, reason, client) {
  const announcement = getAnnouncement(announcementId)
  if (!announcement) {
    return interaction.editReply({ content: "❌ Anúncio não encontrado." })
  }
  if (announcement.status !== "pending") {
    return interaction.editReply({ content: "❌ Este anúncio já foi processado." })
  }

  const rejected = rejectAnnouncement(announcementId, interaction.user.id, reason)
  if (!rejected) {
    return interaction.editReply({ content: "❌ Este anúncio já foi processado por outro staff." })
  }
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

  // Fechar ticket (somente se o canal atual NÃO for o canal de logs ou de anúncios)
  try {
    const logsChannelId    = client.config?.channels?.logs
    const anunciosChannelId = client.config?.channels?.anuncios
    const reviewChannelId  = client.config?.channels?.review
    const currentChannelId = interaction.channel?.id

    const isProtectedChannel = currentChannelId && (
      currentChannelId === logsChannelId    ||
      currentChannelId === anunciosChannelId ||
      currentChannelId === reviewChannelId
    )

    if (!isProtectedChannel) {
      await interaction.channel?.send({
        content: `❌ Anúncio recusado por ${interaction.user}. Canal será fechado em 10s.`,
      })
      setTimeout(() => interaction.channel?.delete().catch(() => {}), 10_000)
    }
  } catch { /* canal pode não existir */ }

  await interaction.editReply({ content: `✅ Anúncio #${announcementId} recusado.`, components: [] })
}

/**
 * ── Resumo das alterações em handlers/anuncioHandler.js ───────────────────
 *
 * Imports a adicionar:
 *   import { showRejectionTemplates } from "./rejectionTemplates.js"
 *
 * Substituir em handleAnnouncementButton() action === "reject":
 *
 *   // Antes:
 *   const modal = new ModalBuilder().setCustomId(`reject_reason_${announcementId}`)...
 *   return interaction.showModal(modal)
 *
 *   // Depois:
 *   return showRejectionTemplates(interaction, announcementId)
 *
 * ── Alterações em events/interactionCreate.js ─────────────────────────────
 *
 * Import:
 *   import { handleRejectionTemplateSelect } from "../handlers/rejectionTemplates.js"
 *
 * Dentro de isStringSelectMenu():
 *   if (id === "reject_template_select") return handleRejectionTemplateSelect(interaction, client)
 */
