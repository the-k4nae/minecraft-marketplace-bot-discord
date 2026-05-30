import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js"
import { handleSetupPainelCommand } from "../handlers/ticketHandler.js"

export const data = new SlashCommandBuilder()
  .setName("setuppainel")
  .setDescription("Configura o painel de tickets")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((option) =>
    option.setName("canal").setDescription("Canal onde o painel será enviado").setRequired(true),
  )

export async function execute(interaction, client) {
  await handleSetupPainelCommand(interaction, client)
}
