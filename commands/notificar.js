/**
 * notificar.js — Comando /notificar
 *
 * Permite usuários ativarem/desativarem notificações de novos anúncios
 */

import { SlashCommandBuilder, MessageFlags } from "discord.js"
import { isNotificationEnabled, setNotification } from "../utils/database.js"
import { CV2_EPHEMERAL, container, text, COLORS } from "../utils/components.js"

export const data = new SlashCommandBuilder()
  .setName("notificar")
  .setDescription("Gerenciar notificações de novos anúncios")
  .addStringOption(option =>
    option.setName("acao")
      .setDescription("Escolha a ação")
      .setRequired(true)
      .addChoices(
        { name: "✅ Ativar notificações", value: "on" },
        { name: "❌ Desativar notificações", value: "off" },
        { name: "📊 Ver status", value: "status" },
      )
  )

export async function execute(interaction) {
  const acao = interaction.options.getString("acao")

  if (acao === "status") {
    const enabled = isNotificationEnabled(interaction.user.id)
    const c = container(enabled ? COLORS.SUCCESS : COLORS.INFO)
      .addTextDisplayComponents(text(
        `## 🔔 Status das Notificações\n` +
        (enabled ? "Você está recebendo notificações de novos anúncios." : "Você **não** está recebendo notificações.") +
        `\n\n**Como funciona**\nQuando um novo anúncio é aprovado, você recebe uma DM com os detalhes.\n-# ID: ${interaction.user.id}`
      ))
    return interaction.reply({ flags: CV2_EPHEMERAL, components: [c] })
  }

  if (acao === "on") {
    setNotification(interaction.user.id, true)
    const c = container(COLORS.SUCCESS)
      .addTextDisplayComponents(text(
        `## 🔔 Notificações Ativadas!\nVocê agora receberá notificações de novos anúncios via DM.\n-# Use /notificar off para desativar`
      ))
    return interaction.reply({ flags: CV2_EPHEMERAL, components: [c] })
  }

  if (acao === "off") {
    setNotification(interaction.user.id, false)
    const c = container(COLORS.INFO)
      .addTextDisplayComponents(text(
        `## 🔕 Notificações Desativadas\nVocê não receberá mais notificações de novos anúncios.\n-# Use /notificar on para reativar`
      ))
    return interaction.reply({ flags: CV2_EPHEMERAL, components: [c] })
  }
}
