import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js"

export const data = new SlashCommandBuilder()
  .setName("setuppainel")
  .setDescription("Configura o painel de tickets")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((option) =>
    option.setName("canal").setDescription("Canal onde o painel será enviado").setRequired(true),
  )

export async function execute(interaction, client) {
  const { handleSetupPainelCommand } = await import("../handlers/ticketHandler.js")
  await handleSetupPainelCommand(interaction, client)
}
