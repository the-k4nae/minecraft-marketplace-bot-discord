/**
 * commands/setupanuncio.js
 *
 * Comando /setupanuncio — envia o painel de anúncios em um canal.
 * Usuários clicam "📢 Anunciar Conta" para iniciar o formulário sem
 * precisar abrir um ticket.
 */

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js"
import { buildAnuncioPanel } from "../utils/components.js"
import { logAction } from "../utils/logger.js"

export const data = new SlashCommandBuilder()
  .setName("setupanuncio")
  .setDescription("Configura o painel de anúncios em um canal específico")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption(o =>
    o.setName("canal").setDescription("Canal onde o painel será enviado").setRequired(true)
  )
  .addStringOption(o =>
    o.setName("banner").setDescription("URL da imagem de banner (opcional)").setRequired(false)
  )

export async function execute(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const canal = interaction.options.getChannel("canal")
  const bannerUrl = interaction.options.getString("banner") ?? null

  if (bannerUrl && !bannerUrl.startsWith("https://")) {
    return interaction.editReply({ content: "❌ URL do banner inválida. Deve começar com `https://`." })
  }

  try {
    await canal.send(buildAnuncioPanel(interaction.guild, bannerUrl))
    await interaction.editReply({
      content: `✅ Painel de anúncios configurado em ${canal}!`,
    })
    await logAction(client, "announcement_panel_setup", {
      userId: interaction.user.id,
      details: `Painel de anúncios configurado em <#${canal.id}>`,
    })
  } catch {
    await interaction.editReply({
      content: "❌ Erro ao enviar o painel. Verifique as permissões do bot no canal.",
    })
  }
}
