import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js"
import { createTicket, getTicket, getUserOpenTickets, updateTicketClaimed, saveTicketVoiceChannel, closeTicket, addLog } from "../utils/database.js"
import { checkCooldown } from "../utils/cooldown.js"
import { generateTranscript, sendTranscriptToLogs } from "../utils/transcript.js"
import { buildTicketPanelC2, buildTicketC2, COLORS, text, box, C2_FLAG } from "../utils/embedBuilder.js"
import { logAction } from "../utils/logger.js"

/**
 * Cria o painel de tickets via /ticket
 */
export async function handleTicketCommand(interaction, client) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "Voce nao tem permissao para usar este comando.",
      flags: MessageFlags.Ephemeral,
    })
  }

  const container = buildTicketPanelC2(interaction.guild)
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_suporte").setLabel("Suporte").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ticket_duvidas").setLabel("Duvidas").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ticket_denuncia").setLabel("Denuncia").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket_anunciar").setLabel("Anunciar Conta").setStyle(ButtonStyle.Success),
  )
  await interaction.reply({ components: [appendRows(container, row)], flags: C2_FLAG })
}

/**
 * Configura o painel de tickets via /setuppainel
 */
export async function handleSetupPainelCommand(interaction, client) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({
      content: "Voce nao tem permissao para usar este comando.",
      flags: MessageFlags.Ephemeral,
    })
  }

  const canal = interaction.options.getChannel("canal")

  const container = buildTicketPanelC2(interaction.guild)
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_suporte").setLabel("Suporte").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ticket_duvidas").setLabel("Duvidas").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("ticket_denuncia").setLabel("Denuncia").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("ticket_anunciar").setLabel("Anunciar Conta").setStyle(ButtonStyle.Success),
  )
  try {
    await canal.send({ components: [appendRows(container, row)], flags: C2_FLAG })
    await interaction.reply({
      content: `Painel de tickets configurado em ${canal}!`,
      flags: MessageFlags.Ephemeral,
    })

    await logAction(client, "ticket_created", {
      userId: interaction.user.id,
      details: `Painel configurado em <#${canal.id}>`,
    })
  } catch (error) {
    console.error("[TICKET] Erro ao enviar painel:", error)
    await interaction.reply({
      content: "Erro ao enviar o painel. Verifique as permissoes do bot.",
      flags: MessageFlags.Ephemeral,
    })
  }
}

/**
 * Manipula cliques nos botoes de ticket
 */
export async function handleTicketButton(interaction, params, client) {
  const [type] = params

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  // Rate limiting
  const cooldown = checkCooldown(interaction.user.id, "create_ticket", 10000)
  if (cooldown.onCooldown) {
    return interaction.editReply({
      content: `Aguarde ${cooldown.remaining} segundo(s) antes de criar outro ticket.`,
    })
  }

  // Prevenir ticket duplicado do mesmo tipo
  const existingTickets = getUserOpenTickets(interaction.user.id, type)
  if (existingTickets.length > 0) {
    return interaction.editReply({
      content: `Voce ja tem um ticket de "${type}" aberto. Feche o ticket existente antes de criar outro.`,
    })
  }

  try {
    // Criar canal do ticket
    const ticketChannel = await createTicketChannel(interaction, type, client)

    if (!ticketChannel) {
      return interaction.editReply({
        content: "Erro ao criar ticket. Verifique se a categoria esta configurada corretamente.",
      })
    }

    // FIX C-3: Salvar no banco ANTES de prosseguir; deletar canal se falhar
    try {
      createTicket(ticketChannel.id, interaction.user.id, type)
    } catch (dbError) {
      console.error("[TICKET] Erro ao salvar no banco, removendo canal:", dbError)
      await ticketChannel.delete().catch(() => {})
      return interaction.editReply({ content: "Erro ao registrar ticket. Tente novamente." })
    }

    // Enviar mensagem inicial no canal
    await sendTicketMessage(ticketChannel, interaction.user, type, client)

    // Se for anunciar conta, mostrar botao do modal
    if (type === "anunciar") {
      await showAnnouncementModal(interaction, ticketChannel)
    }

    addLog("ticket_created", interaction.user.id, ticketChannel.id, `Tipo: ${type}`)

    await logAction(client, "ticket_created", {
      userId: interaction.user.id,
      details: `**Tipo:** ${type}\n**Canal:** <#${ticketChannel.id}>`,
    })

    await interaction.editReply({
      content: `Ticket criado! ${ticketChannel}`,
    })
  } catch (error) {
    console.error("[TICKET] Erro ao criar ticket:", error)
    await interaction.editReply({
      content: "Erro ao criar ticket. Tente novamente.",
    })
  }
}

/**
 * Cria o canal do ticket
 */
async function createTicketChannel(interaction, type, client) {
  const config = client.config
  const guild = interaction.guild

  const channelName = `${type}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "")

  try {
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: config.categories.tickets,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        {
          id: config.roles.staff,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
            PermissionFlagsBits.AttachFiles,
          ],
        },
      ],
    })

    return channel
  } catch (error) {
    console.error("[TICKET] Erro ao criar canal:", error)
    return null
  }
}

/**
 * Envia mensagem inicial no ticket (visual melhorado)
 */
async function sendTicketMessage(channel, user, type, client) {
  const container = buildTicketC2(type, user, client?.user)

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("ticket_actions")
    .setPlaceholder("Gerenciar Ticket")
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel("Criar Call").setDescription("Criar uma call de voz para este ticket").setValue("create_call"),
      new StringSelectMenuOptionBuilder().setLabel("Adicionar Usuario").setDescription("Adicionar alguem ao ticket").setValue("add_user"),
      new StringSelectMenuOptionBuilder().setLabel("Lembrar Usuario").setDescription("Enviar lembrete na DM do usuario").setValue("ping_user"),
      new StringSelectMenuOptionBuilder().setLabel("Assumir Ticket").setDescription("Assumir responsabilidade pelo ticket").setValue("claim_ticket"),
    )

  const row1 = new ActionRowBuilder().addComponents(selectMenu)
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("close_ticket").setLabel("Fechar Ticket").setStyle(ButtonStyle.Danger),
  )

  const message = await channel.send({
    content: `Olá ${user}, seu ticket foi criado!`,
    components: [appendRows(container, row1, row2)],
    flags: C2_FLAG,
  })

  return message
}

/**
 * Mostra botao para preencher formulario de anuncio
 */
async function showAnnouncementModal(interaction, ticketChannel) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`announce_modal`).setLabel("Preencher Dados").setStyle(ButtonStyle.Primary),
  )
  await ticketChannel.send({
    components: [
      box(
        "## 📢 Preencha as Informações da Conta\n\n" +
        "Clique no botão abaixo para preencher os dados da sua conta Minecraft.\n\n" +
        "**Dicas:**\n" +
        "- Use o nickname exato da conta\n" +
        "- Informe o valor em reais (R$)\n" +
        "- Seja honesto sobre banimentos\n\n" +
        "-# Preencha todos os campos obrigatórios",
        0xFFA500
      ),
      row,
    ],
    flags: C2_FLAG,
  })
}

/**
 * Manipula acoes do painel de controle do ticket
 */
export async function handleTicketActions(interaction, client) {
  const action = interaction.values[0]

  if (action === "create_call") {
    await handleCreateCall(interaction, client)
  } else if (action === "add_user") {
    await handleAddUser(interaction, client)
  } else if (action === "ping_user") {
    await handlePingUser(interaction, client)
  } else if (action === "claim_ticket") {
    await handleClaimTicket(interaction, client)
  } else if (action === "close_ticket") {
    await handleCloseTicketAction(interaction, client)
  }
}

/**
 * Cria uma call de voz para o ticket
 */
async function handleCreateCall(interaction, client) {
  const config = client.config

  if (!interaction.member.roles.cache.has(config.roles.staff)) {
    return interaction.reply({
      content: "Apenas staff pode criar calls.",
      flags: MessageFlags.Ephemeral,
    })
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  try {
    const voiceChannel = await interaction.guild.channels.create({
      name: `call-${interaction.channel.name}`,
      type: ChannelType.GuildVoice,
      parent: config.categories.tickets,
      permissionOverwrites: interaction.channel.permissionOverwrites.cache.map((overwrite) => ({
        id: overwrite.id,
        allow: overwrite.allow.toArray(),
        deny: overwrite.deny.toArray(),
      })),
    })

    saveTicketVoiceChannel(interaction.channel.id, voiceChannel.id)

    await logAction(client, "ticket_call_created", {
      userId: interaction.user.id,
      details: `**Ticket:** <#${interaction.channel.id}>\n**Call:** <#${voiceChannel.id}>`,
    })

    await interaction.editReply({
      content: `Call criada com sucesso: ${voiceChannel}`,
    })

    const msg = await interaction.channel.send({
      components: [box(`📞 Call criada por ${interaction.user}: ${voiceChannel}`, 0x7289DA)],
      flags: C2_FLAG,
    })

    setTimeout(async () => {
      try { await msg.delete() } catch (error) { /* silencioso */ }
    }, 15000)
  } catch (error) {
    console.error("[TICKET] Erro ao criar call:", error)
    const msg = { content: "Erro ao criar call.", flags: MessageFlags.Ephemeral }
    if (interaction.deferred) await interaction.editReply(msg)
    else await interaction.reply(msg)
  }
}

/**
 * Adiciona um usuario ao ticket via modal (FIX A-7: MessageCollector inseguro substituido por modal)
 */
async function handleAddUser(interaction, client) {
  const config = client.config

  if (!interaction.member.roles.cache.has(config.roles.staff)) {
    return interaction.reply({
      content: "Apenas staff pode adicionar usuarios.",
      flags: MessageFlags.Ephemeral,
    })
  }

  const modal = new ModalBuilder()
    .setCustomId(`adduser_modal_${interaction.channel.id}`)
    .setTitle("Adicionar Usuario ao Ticket")

  const userIdInput = new TextInputBuilder()
    .setCustomId("user_id")
    .setLabel("ID do Usuario")
    .setPlaceholder("Cole o ID do usuario (ex: 123456789012345678)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20)

  modal.addComponents(new ActionRowBuilder().addComponents(userIdInput))
  await interaction.showModal(modal)
}

export async function handleAddUserModalSubmit(interaction, params, client) {
  const channelId = params[0]
  const userId = interaction.fields.getTextInputValue("user_id").trim()

  const channel = interaction.guild.channels.cache.get(channelId)
  if (!channel) {
    return interaction.reply({ content: "Canal do ticket nao encontrado.", flags: MessageFlags.Ephemeral })
  }

  let member
  try {
    member = await interaction.guild.members.fetch(userId)
  } catch {
    return interaction.reply({ content: "Usuario nao encontrado. Verifique o ID.", flags: MessageFlags.Ephemeral })
  }

  try {
    await channel.permissionOverwrites.create(member.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
    })

    await channel.send({ components: [box(`✅ ${member} foi adicionado ao ticket por ${interaction.user}`, 0x00D166)], flags: C2_FLAG })
    await interaction.reply({ content: `${member} adicionado com sucesso!`, flags: MessageFlags.Ephemeral })
  } catch (error) {
    console.error("[TICKET] Erro ao adicionar usuario:", error)
    await interaction.reply({ content: "Erro ao adicionar usuario.", flags: MessageFlags.Ephemeral })
  }
}

/**
 * Menciona o usuario do ticket via DM
 */
async function handlePingUser(interaction, client) {
  const config = client.config

  if (!interaction.member.roles.cache.has(config.roles.staff)) {
    return interaction.reply({
      content: "Apenas staff pode usar esta funcao.",
      flags: MessageFlags.Ephemeral,
    })
  }

  // Buscar dono do ticket pelo banco de dados (confiavel)
  const ticket = getTicket(interaction.channel.id)
  if (!ticket) {
    return interaction.reply({ content: "Ticket nao encontrado no banco de dados.", flags: MessageFlags.Ephemeral })
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  let member
  try {
    member = await interaction.guild.members.fetch(ticket.user_id)
  } catch {
    return interaction.editReply({ content: "Nao foi possivel encontrar o usuario do ticket." })
  }

  try {
    const dmEmbed = new EmbedBuilder()
      .setColor(COLORS.WARNING)
      .setTitle("Lembrete do Ticket")
      .setDescription(
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `Ola ${member}! A staff precisa de voce no seu ticket.\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
      )
      .addFields(
        { name: "Ticket", value: `${interaction.channel}`, inline: false },
        { name: "Staff", value: `${interaction.user}`, inline: false },
      )
      .setFooter({ text: "Por favor, responda o mais rapido possivel" })
      .setTimestamp()

    await member.send({ embeds: [dmEmbed] })

    await interaction.editReply({
      content: `Lembrete enviado para ${member} via DM!`,
    })
  } catch (error) {
    console.error("[TICKET] Erro ao enviar DM:", error)
    await interaction.editReply({
      content: `${member}, a staff precisa de voce! (Nao foi possivel enviar DM via DM fechada)`,
    })
  }
}

/**
 * Assume o ticket (visual melhorado)
 */
async function handleClaimTicket(interaction, client) {
  const config = client.config

  if (!interaction.member.roles.cache.has(config.roles.staff)) {
    return interaction.reply({
      content: "Apenas staff pode assumir tickets.",
      flags: MessageFlags.Ephemeral,
    })
  }

  const ticket = getTicket(interaction.channel.id)
  if (ticket) {
    if (ticket.claimed_by) {
      return interaction.reply({
        content: `Este ticket ja foi assumido por <@${ticket.claimed_by}>.`,
        flags: MessageFlags.Ephemeral,
      })
    }
    updateTicketClaimed(interaction.channel.id, interaction.user.id)
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  // FIX BUG-2: Aumentado o limite de busca de mensagens de 10 → 50 para garantir
  // que o painel original seja encontrado mesmo que existam mensagens anteriores.
  // C2: enviar nota de assumiu no canal (o Container original do ticket continua inalterado)
  await interaction.channel.send({
    components: [box(`✅ **Staff Responsável:** ${interaction.user}\nTicket assumido com sucesso.`, 0x00D166)],
    flags: C2_FLAG,
  }).catch(() => {})

  // Notificar usuario via DM — busca pelo ID salvo no banco
  const ticketData = getTicket(interaction.channel.id)
  let claimMember = null
  if (ticketData?.user_id) {
    try {
      claimMember = await interaction.guild.members.fetch(ticketData.user_id)
    } catch { /* usuario saiu do servidor */ }
  }

  if (claimMember) {
    try {
      const dmEmbed = new EmbedBuilder()
        .setColor(COLORS.SUCCESS)
        .setTitle("Ticket Assumido")
        .setDescription(
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `Seu ticket foi assumido por um membro da staff!\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
        )
        .addFields(
          { name: "Staff Responsável", value: `${interaction.user.tag}`, inline: false },
          { name: "Ticket", value: `${interaction.channel}`, inline: false },
        )
        .setFooter({ text: "Voce recebera suporte em breve" })
        .setTimestamp()

      await claimMember.send({ embeds: [dmEmbed] })
    } catch (error) {
      // DM fechada
    }
  }

  addLog("ticket_claimed", interaction.user.id, interaction.channel.id, `Ticket assumido por ${interaction.user.tag}`)

  await logAction(client, "ticket_claimed", {
    userId: interaction.user.id,
    details: `**Ticket:** <#${interaction.channel.id}>`,
  })

  const claimContent = `## ✅ Ticket Assumido\n\n${interaction.user} assumiu este ticket e irá atendê-lo.`
  const claimOpts = { components: [box(claimContent, 0x00D166)], flags: C2_FLAG }
  if (interaction.deferred) await interaction.editReply(claimOpts)
  else await interaction.reply(claimOpts)
}

/**
 * Fecha o ticket com confirmacao
 */
export async function handleCloseTicketAction(interaction, client) {
  const config = client.config

  // FIX C-4: verificar user_id do banco, não username no nome do canal
  const ticket = getTicket(interaction.channel.id)
  const isOwner = ticket && ticket.user_id === interaction.user.id

  if (
    !interaction.member.roles.cache.has(config.roles.staff) &&
    !isOwner
  ) {
    return interaction.reply({
      content: "Apenas staff ou o dono do ticket podem fecha-lo.",
      flags: MessageFlags.Ephemeral,
    })
  }

  const confirmRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`confirmclose_${interaction.channel.id}`)
      .setLabel("Sim, fechar ticket")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`cancelclose_${interaction.channel.id}`)
      .setLabel("Cancelar")
      .setStyle(ButtonStyle.Secondary),
  )

  await interaction.reply({
    content: "Tem certeza que deseja fechar este ticket? O transcript sera salvo nos logs.",
    components: [confirmRow],
    flags: MessageFlags.Ephemeral,
  })
}

export async function handleConfirmCloseTicket(interaction, client) {
  // FIX CRÍTICO: o botão vem de uma mensagem ephemeral (flags: Ephemeral no reply original).
  // deferUpdate() não funciona em mensagens efêmeras — precisa usar deferReply ephemeral.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const channel = interaction.channel
  if (!channel) {
    return interaction.editReply({ content: "❌ Canal não encontrado." })
  }

  const config = client.config

  try {
    // Fechar no banco ANTES de gerar transcript (evita race condition com scheduler)
    closeTicket(channel.id)
    addLog("ticket_closed", interaction.user.id, channel.id, `Fechado por ${interaction.user.tag}`)

    await interaction.editReply({ content: "✅ Fechando ticket..." })

    // Avisar no canal antes de gerar transcript
    await channel.send({ content: "🔒 Ticket encerrado. Este canal será deletado em alguns segundos." }).catch(() => {})

    // Gerar transcript em background (pode demorar)
    generateTranscript(channel).then(async (transcript) => {
      if (transcript) {
        await sendTranscriptToLogs(client, config.channels.logs, transcript, channel.name, interaction.user)
          .catch(err => console.error("[TICKET] Erro ao enviar transcript:", err.message))
      }
      // Deletar canal após transcript
      setTimeout(() => channel.delete().catch(() => {}), 3000)
    }).catch(err => {
      console.error("[TICKET] Erro ao gerar transcript:", err.message)
      setTimeout(() => channel.delete().catch(() => {}), 3000)
    })

    await logAction(client, "ticket_closed", {
      userId: interaction.user.id,
      details: `**Ticket:** ${channel.name}`,
    })
  } catch (error) {
    console.error("[TICKET] Erro ao fechar ticket:", error)
    await interaction.editReply({ content: "❌ Erro ao fechar o ticket. Tente novamente." }).catch(() => {})
  }
}

export async function handleCancelCloseTicket(interaction, client) {
  // Também ephemeral — usar deferReply ephemeral
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  await interaction.editReply({
    content: "Fechamento cancelado.",
  })
}

// Funções internas usadas apenas dentro deste módulo — não precisam ser re-exportadas
// (handleCreateCall, handleAddUser, handlePingUser, handleClaimTicket são chamadas via handleTicketActions)
// handleAddUserModalSubmit já é export async function na linha acima, não duplicar aqui.
