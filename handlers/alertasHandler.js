/**
 * alertasHandler.js
 *
 * Sistema de alertas via embed + botões + modal.
 * Substitui os subcomandos: /alertas criar, /alertas listar, /alertas deletar
 */

import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} from "discord.js"
import { getUserAlerts, createAlert, deleteAlert } from "../utils/database.js"
import { COLORS, parseMoney, buildAlertasPanelC2 } from "../utils/embedBuilder.js"
import { box, C2_FLAG, C2_EPHEMERAL } from "../utils/cv2.js"

// ─────────────────────────────────────────────
// PAINEL PRINCIPAL /alertas
// ─────────────────────────────────────────────

export async function handleAlertasCommand(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const alerts = getUserAlerts(interaction.user.id)

  const container = buildAlertasPanelC2(interaction.user, alerts)
  const components = buildAlertasComponents(alerts)
  await interaction.editReply({ components: [appendRows(container, ...components)], flags: C2_FLAG })
}

function buildAlertasEmbed(user, alerts) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle("🔔 Meus Alertas de Interesse")
    .setThumbnail(user.displayAvatarURL({ dynamic: true }))
    .setDescription(
      alerts.length === 0
        ? "Você não tem alertas ativos.\n\nCrie um alerta para ser notificado por DM quando um anúncio corresponder aos seus filtros."
        : `Você tem **${alerts.length}/10** alertas ativos.\nVocê será notificado por DM quando um novo anúncio corresponder.`
    )
    .setTimestamp()

  for (const a of alerts.slice(0, 10)) {
    const f = a.filters
    const filtersText = [
      f.nick ? `Nick contém: \`${f.nick}\`` : null,
      f.minPrice ? `Mín: R$ ${f.minPrice}` : null,
      f.maxPrice ? `Máx: R$ ${f.maxPrice}` : null,
      f.vip ? `VIP/Tag: \`${f.vip}\`` : null,
    ].filter(Boolean).join("  ·  ")

    const last = a.last_triggered_at
      ? `<t:${Math.floor(new Date(a.last_triggered_at).getTime() / 1000)}:R>`
      : "Nunca disparado"

    embed.addFields({
      name: `Alerta #${a.id}`,
      value: `${filtersText || "Sem filtros"}\n📅 Último disparo: ${last}`,
      inline: false,
    })
  }

  return embed
}

function buildAlertasComponents(alerts) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("alertas_criar")
      .setLabel("Criar Alerta")
      .setStyle(ButtonStyle.Success)
      .setEmoji("➕")
      .setDisabled(alerts.length >= 10),
    new ButtonBuilder()
      .setCustomId("alertas_deletar")
      .setLabel("Deletar Alerta")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("🗑️")
      .setDisabled(alerts.length === 0),
    new ButtonBuilder()
      .setCustomId("alertas_refresh")
      .setLabel("Atualizar")
      .setStyle(ButtonStyle.Secondary)
      .setEmoji("🔄"),
  )

  return [row]
}

// ─────────────────────────────────────────────
// BOTÕES
// ─────────────────────────────────────────────

export async function handleAlertasButton(interaction, action, client) {
  if (action === "criar") {
    await showCriarAlertaModal(interaction)
  } else if (action === "deletar") {
    await showDeletarAlertaModal(interaction)
  } else if (action === "refresh") {
    await interaction.deferUpdate()
    const alerts = getUserAlerts(interaction.user.id)
    const alertsContainer = buildAlertasPanelC2(interaction.user, alerts)
    const components = buildAlertasComponents(alerts)
    await interaction.editReply({ components: [appendRows(alertsContainer, ...components)], flags: C2_FLAG })
  }
}

async function showCriarAlertaModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("alertas_criar_submit")
    .setTitle("Criar Alerta de Interesse")

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("nick")
        .setLabel("Nick (parcial, opcional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: dream — deixe vazio para ignorar")
        .setRequired(false)
        .setMaxLength(30)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("preco_min")
        .setLabel("Preço mínimo R$ (opcional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 50")
        .setRequired(false)
        .setMaxLength(10)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("preco_max")
        .setLabel("Preço máximo R$ (opcional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 300")
        .setRequired(false)
        .setMaxLength(10)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("vip")
        .setLabel("VIP/Tag específica (opcional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: MVP++")
        .setRequired(false)
        .setMaxLength(30)
    ),
  )

  await interaction.showModal(modal)
}

async function showDeletarAlertaModal(interaction) {
  const modal = new ModalBuilder()
    .setCustomId("alertas_deletar_submit")
    .setTitle("Deletar Alerta")

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId("id")
        .setLabel("ID do alerta para deletar")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 3 — veja o ID no painel acima")
        .setRequired(true)
        .setMaxLength(10)
    ),
  )

  await interaction.showModal(modal)
}

// ─────────────────────────────────────────────
// MODAIS
// ─────────────────────────────────────────────

export async function handleAlertasCriarSubmit(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const existing = getUserAlerts(interaction.user.id)
  if (existing.length >= 10) {
    return interaction.editReply({ content: "Você já tem 10 alertas ativos (limite máximo). Delete um antes de criar outro." })
  }

  const nick = interaction.fields.getTextInputValue("nick").trim() || null
  const preco_min_raw = interaction.fields.getTextInputValue("preco_min").trim()
  const preco_max_raw = interaction.fields.getTextInputValue("preco_max").trim()
  const vip = interaction.fields.getTextInputValue("vip").trim() || null

  const minPrice = preco_min_raw ? parseMoney(preco_min_raw) : null
  const maxPrice = preco_max_raw ? parseMoney(preco_max_raw) : null

  if (!nick && !minPrice && !maxPrice && !vip) {
    return interaction.editReply({ content: "❌ Defina pelo menos um filtro para o alerta." })
  }

  if (preco_min_raw && (minPrice === null || minPrice < 0)) return interaction.editReply({ content: "❌ Preço mínimo inválido." })
  if (preco_max_raw && (maxPrice === null || maxPrice < 0)) return interaction.editReply({ content: "❌ Preço máximo inválido." })

  const alert = createAlert(interaction.user.id, {
    nick,
    minPrice: minPrice ?? null,
    maxPrice: maxPrice ?? null,
    vip,
  })

  const filtersText = [
    nick ? `Nick contém: **${nick}**` : null,
    minPrice ? `Preço mínimo: **R$ ${minPrice}**` : null,
    maxPrice ? `Preço máximo: **R$ ${maxPrice}**` : null,
    vip ? `VIP/Tag: **${vip}**` : null,
  ].filter(Boolean).join("\n")

  await interaction.editReply({
    components: [box(`## 🔔 Alerta Criado!\n\nVocê será notificado por DM quando um anúncio corresponder aos seus filtros.\n\n**Filtros:**\n${filtersText}\n\n-# ID do alerta: ${alert.id}`, 0x00D166)],
    flags: C2_EPHEMERAL,
  })
}

export async function handleAlertasDeletarSubmit(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const idRaw = interaction.fields.getTextInputValue("id").trim()
  const alertId = parseInt(idRaw)

  if (isNaN(alertId)) {
    return interaction.editReply({ content: "❌ ID inválido." })
  }

  const deleted = deleteAlert(alertId, interaction.user.id)

  if (!deleted) {
    return interaction.editReply({ content: `❌ Alerta #${alertId} não encontrado ou não é seu.` })
  }

  await interaction.editReply({
    components: [box(`## 🗑️ Alerta Deletado\n\nAlerta **#${alertId}** removido com sucesso.`, 0x00D166)],
    flags: C2_EPHEMERAL,
  })
}
