/**
 * statsHandler.js — Handler do comando /stats
 *
 * Responsabilidade: Exibir estatísticas do servidor
 */

import { MessageFlags } from "discord.js"
import { getStats } from "../utils/database.js"
import { container, text, CV2_EPHEMERAL, COLORS } from "../utils/components.js"

export async function handleStatsCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {})

  const stats = getStats()

  const maxBar = 10
  const bar = (value, max) => {
    if (!max) return "░".repeat(maxBar)
    const filled = Math.min(Math.round((value / max) * maxBar), maxBar)
    return "█".repeat(filled) + "░".repeat(maxBar - filled)
  }

  const totalTickets = stats.totalTickets || 1

  await interaction.editReply({
    flags: CV2_EPHEMERAL,
    components: [
      container(COLORS.PRIMARY)
        .addTextDisplayComponents(text(
          `## 📊 Estatísticas do Servidor\n` +
          `-# Atualizado <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
          `**🎫 Tickets**\n` +
          `Total: **${stats.totalTickets}** · Abertos: **${stats.openTickets}** ${bar(stats.openTickets, totalTickets)} · Fechados: **${stats.closedTickets}** ${bar(stats.closedTickets, totalTickets)}\n\n` +
          `**📢 Anúncios**\n` +
          `Total: **${stats.totalAnnouncements}** · Ativos: **${stats.activeAnnouncements}** · Pendentes: **${stats.pendingAnnouncements}** · Vendidos: **${stats.soldAnnouncements}**\n\n` +
          `**🤝 Negociações**\n` +
          `Total: **${stats.totalNegotiations}** · Concluídas: **${stats.completedNegotiations}** · Blacklist: **${stats.blacklistedUsers}**\n\n` +
          `-# Solicitado por ${interaction.user.username}`
        ))
    ],
  })
}
