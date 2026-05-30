/**
 * handlers/ticketHandler.js — migração Components V2
 *
 * Alterações em relação à versão anterior:
 *  - Todos os `embeds: [...]` → `components: [ContainerBuilder]` + `flags: CV2`
 *  - `ActionRowBuilder` manual → `createRow` + `createButton` do @magicyan
 *  - Importações de EmbedBuilder e COLORS removidas (não usadas mais)
 *
 * ATENÇÃO: Este arquivo mostra APENAS as funções alteradas.
 * O restante do handler (lógica de DB, permissões, etc.) permanece igual.
 */

import {
  ChannelType, PermissionFlagsBits, MessageFlags,
  ModalBuilder, TextInputBuilder, TextInputStyle, ButtonStyle,
  ActionRowBuilder as ActionRowBuilder_, StringSelectMenuBuilder, StringSelectMenuOptionBuilder,
} from "discord.js"
// Atalho limpo para deferReply ephemeral — SEM IsComponentsV2 (flag V2 vai só no reply final)
const DEFER_EPHEMERAL = { flags: MessageFlags.Ephemeral }
import {
  createTicket, getTicket, getUserOpenTickets, getAllUserOpenTickets,
  updateTicketClaimed, saveTicketVoiceChannel, closeTicket, addLog,
} from "../utils/database.js"
import { checkCooldown } from "../utils/cooldown.js"
import { checkNamedLimit } from "../utils/rateLimiter.js"
import { generateTranscript, sendTranscriptToLogs } from "../utils/transcript.js"
import { logAction } from "../utils/logger.js"
import { fileLog } from "../utils/fileLogger.js"
import {
  CV2, CV2_EPHEMERAL,
  createRow, createButton, createLinkButton,
  container, text, separator, thumbnail, section,
  buildTicketPanel, buildTicketCard,
  errorReply, successReply, warnReply, infoReply,
} from "../utils/components.js"

// ── /setuppainel ──────────────────────────────────────────────────────────────

export async function handleSetupPainelCommand(interaction, client) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(errorReply("Você não tem permissão para usar este comando."))
  }

  const canal = interaction.options.getChannel("canal")

  try {
    await canal.send(buildTicketPanel(interaction.guild))
    await interaction.reply(successReply(`Painel de tickets configurado em ${canal}!`))
    await logAction(client, "ticket_created", {
      userId: interaction.user.id,
      details: `Painel configurado em <#${canal.id}>`,
    })
  } catch (error) {
    fileLog.error({ err: error?.message }, "[TICKET] Erro ao enviar painel")
    await interaction.reply(errorReply("Erro ao enviar o painel. Verifique as permissões do bot."))
  }
}

// ── /ticket ───────────────────────────────────────────────────────────────────

export async function handleTicketCommand(interaction, client) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply(errorReply("Você não tem permissão para usar este comando."))
  }
  await interaction.reply(buildTicketPanel(interaction.guild))
}

// ── Clique no botão de ticket ─────────────────────────────────────────────────

export async function handleTicketButton(interaction, params, client) {
  const [type] = params
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const cooldown = checkCooldown(interaction.user.id, `ticket_${type}`, 30000)
  if (cooldown.onCooldown) {
    return interaction.editReply(warnReply(`Aguarde ${cooldown.remaining}s antes de abrir outro ticket.`))
  }

  const rateLimit = checkNamedLimit(interaction.user.id, "OPEN_TICKET")
  if (!rateLimit.allowed) {
    return interaction.editReply(warnReply(`Você atingiu o limite de tickets por hora. Tente novamente em **${rateLimit.resetIn}s**.`))
  }

  const openTickets = getUserOpenTickets(interaction.user.id, type)
  if (openTickets.length >= 1) {
    return interaction.editReply(warnReply(`Você já tem um ticket de ${type} aberto: <#${openTickets[0].channel_id}>`))
  }

  const config = client.config
  const category = config.categories?.tickets
    ? await interaction.guild.channels.fetch(config.categories.tickets).catch(() => null)
    : null

  const ticketTypeNames = {
    suporte:  "suporte",
    duvidas:  "duvidas",
    denuncia: "denuncia",
    anunciar: "anuncio",
  }
  const channelName = `${ticketTypeNames[type] ?? type}-${interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "")}`

  try {
    const ticketChannel = await interaction.guild.channels.create({
      name: channelName,
      parent: category ?? undefined,
      permissionOverwrites: [
        { id: interaction.guild.roles.everyone, deny: ["ViewChannel"] },
        { id: interaction.user.id, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "AttachFiles"] },
        { id: config.roles.staff, allow: ["ViewChannel", "SendMessages", "ReadMessageHistory", "ManageMessages"] },
      ],
    })

    const ticket = createTicket(ticketChannel.id, interaction.user.id, type)

    // Montar o card do ticket com ações da staff via select menu (igual ao original)
    const staffSelect = new StringSelectMenuBuilder()
      .setCustomId("ticket_actions")
      .setPlaceholder("⚙️ Ferramentas da Staff")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("👋 Assumir Ticket").setDescription("Marcar como atendendo").setValue("claim_ticket"),
        new StringSelectMenuOptionBuilder()
          .setLabel("➕ Adicionar Usuário").setDescription("Adicionar alguém ao ticket").setValue("add_user"),
        new StringSelectMenuOptionBuilder()
          .setLabel("🔒 Fechar Ticket").setDescription("Fechar e arquivar este ticket").setValue("close_ticket"),
      )

    const staffSelectRow = new ActionRowBuilder_().addComponents(staffSelect)

    const card = buildTicketCard(type, interaction.user)
    card.components[0].addSeparatorComponents(separator()).addActionRowComponents(staffSelectRow)

    // Mentions precisam ir em mensagem separada — content não funciona com flag CV2
    await ticketChannel.send({ content: `<@${interaction.user.id}> <@&${config.roles.staff}>` })
    await ticketChannel.send(card)

    addLog("ticket_created", interaction.user.id, ticketChannel.id, type)

    await interaction.editReply(successReply(`Ticket criado! Acesse: ${ticketChannel}`))
  } catch (err) {
    fileLog.error({ err: err?.message }, "[TICKET] Erro ao criar canal")
    await interaction.editReply(errorReply("Erro ao criar ticket. Tente novamente."))
  }
}

// ── Fechar ticket ─────────────────────────────────────────────────────────────

export async function handleCloseTicketAction(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const ticket = getTicket(interaction.channelId)
  if (!ticket) return interaction.editReply(errorReply("Ticket não encontrado."))

  const isStaff = interaction.member.roles.cache.has(client.config?.roles?.staff)
  if (!isStaff && ticket.user_id !== interaction.user.id) {
    return interaction.editReply(errorReply("Apenas staff ou o dono do ticket pode fechá-lo."))
  }

  const confirmCard = {
    flags: CV2,
    components: [
      container(0xED4245)
        .addTextDisplayComponents(text(
          `## 🔒 Fechar ticket?\n` +
          `-# O histórico de mensagens será salvo antes de remover o canal.`
        ))
        .addSeparatorComponents(separator())
        .addActionRowComponents(
          createRow(
            createButton({ customId: "confirmclose", label: "Fechar ticket", style: ButtonStyle.Danger }),
            createButton({ customId: "cancelclose",  label: "Cancelar",      style: ButtonStyle.Secondary }),
          )
        )
    ],
  }

  await interaction.editReply(confirmCard)
}

export async function handleConfirmCloseTicket(interaction, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const ticket = getTicket(interaction.channelId)
  if (!ticket) return interaction.editReply(errorReply("Ticket não encontrado."))

  closeTicket(interaction.channelId)

  const transcript = await generateTranscript(interaction.channel)
  await sendTranscriptToLogs(
    client,
    client.config.channels.logs,
    transcript,
    interaction.channel.name,
    interaction.user.username
  )

  addLog("ticket_closed", interaction.user.id, interaction.channelId, `Fechado por ${interaction.user.username}`)
  await logAction(client, "ticket_closed", { userId: interaction.user.id, targetId: interaction.channelId })

  await interaction.channel.send({
    flags: CV2,
    components: [
      container(0xED4245)
        .addTextDisplayComponents(text(
          `## 🔒 Ticket Fechado\n` +
          `-# Fechado por ${interaction.user.username}  ·  Canal removido em 5s`
        ))
    ],
  })

  setTimeout(() => interaction.channel.delete().catch(() => {}), 5000)
  await interaction.editReply(successReply("Ticket fechado."))
}

export async function handleCancelCloseTicket(interaction) {
  await interaction.update({
    flags: CV2,
    components: [
      container(0x4E5058)
        .addTextDisplayComponents(text("-# Fechamento cancelado."))
    ],
  })
}

// ── Ações dentro do ticket (select menu) ─────────────────────────────────────

export async function handleTicketActions(interaction, client) {
  const action = interaction.values[0]

  // ── Assumir ticket ─────────────────────────────────────────────────────────
  if (action === "claim_ticket") {
    const ticket = getTicket(interaction.channelId)
    if (ticket?.claimed_by) {
      return interaction.reply({
        flags: CV2_EPHEMERAL,
        components: [container(0xFFA500)
          .addTextDisplayComponents(text(`-# ⚠️ Este ticket já foi assumido por <@${ticket.claimed_by}>.`))
        ],
      })
    }
    updateTicketClaimed(interaction.channelId, interaction.user.id)
    const staffAvatar = interaction.user.displayAvatarURL({ size: 256, extension: "png" })
    await interaction.reply({
      flags: CV2,
      components: [
        container(0x23A55A)
          .addSectionComponents(
            section(
              `## ✅ Ticket Assumido\n` +
              `${interaction.user} está atendendo este ticket agora.\n` +
              `Descreva seu problema com detalhes e aguarde o retorno.`,
              thumbnail(staffAvatar, interaction.user.username)
            )
          )
          .addSeparatorComponents(separator())
          .addTextDisplayComponents(text(
            `-# Não envie DMs para a staff  ·  Tempo médio de resposta: até 24h`
          )),
      ],
    })
    // DM ao usuário do ticket informando que foi assumido
    try {
      const ticketUser = await client.users.fetch(ticket.user_id)
      await ticketUser.send({
        flags: CV2,
        components: [
          container(0x23A55A)
            .addSectionComponents(
              section(
                `## 🎫 Seu ticket foi assumido!\n` +
                `**${interaction.user.username}** da equipe está atendendo você.\n` +
                `Acesse o canal <#${interaction.channelId}> para continuar.`,
                thumbnail(staffAvatar, interaction.user.username)
              )
            )
            .addSeparatorComponents(separator())
            .addTextDisplayComponents(text(
              `-# Responda com todas as informações necessárias para agilizar o atendimento`
            )),
        ],
      })
    } catch { /* DM fechada */ }
    return
  }

  // ── Fechar ticket ──────────────────────────────────────────────────────────
  if (action === "close_ticket") {
    return handleCloseTicketAction(interaction, client)
  }

  // ── Adicionar usuário ──────────────────────────────────────────────────────
  if (action === "add_user") {
    const modal = new ModalBuilder()
      .setCustomId(`adduser_modal_${interaction.channelId}`)
      .setTitle("Adicionar Usuário ao Ticket")
    modal.addComponents(
      new ActionRowBuilder_().addComponents(
        new TextInputBuilder()
          .setCustomId("user_id")
          .setLabel("ID do Usuário Discord")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder("Ex: 123456789012345678")
      )
    )
    return interaction.showModal(modal)
  }
}

export async function handleAddUserModalSubmit(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const userId = interaction.fields.getTextInputValue("user_id").replace(/\D/g, "")

  try {
    const member = await interaction.guild.members.fetch(userId)
    await interaction.channel.permissionOverwrites.edit(member.user, {
      ViewChannel: true, SendMessages: true, ReadMessageHistory: true,
    })
    await interaction.editReply(successReply(`${member.user.username} adicionado ao ticket.`))
  } catch {
    await interaction.editReply(errorReply("Usuário não encontrado."))
  }
}
