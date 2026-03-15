/**
 * anuncioHandler.js
 *
 * Responsável apenas pelo FLUXO DE CRIAÇÃO de anúncios:
 *  - Modal de dados (passo 1 e 2)
 *  - Envio para revisão da staff
 *  - Aprovação / Rejeição
 *  - Bump manual
 */

import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  EmbedBuilder, MessageFlags,
} from "discord.js"
import {
  createAnnouncement, getAnnouncement,
  getUserActiveAnnouncements,
  approveAnnouncement, rejectAnnouncement,
  closeTicket, getTicket, addLog, isBlacklisted,
  saveTempModalData, getTempModalData, deleteTempModalData,
  getNickPriceHistory, getUserAverageRating,
  getAnnouncementsByUUID, getDuplicateAccountSellers,
  getUserSuspiciousActivity, matchAlerts, markAlertTriggered,
} from "../utils/database.js"
import { getPlayerUUID, getSkinUrls } from "../utils/minecraftAPI.js"
import {
  buildApprovalDmEmbed, buildRejectionDmEmbed,
  buildAnnouncementReviewC2, buildPublicAnnouncementC2,
  COLORS, formatValor, parseMoney,
} from "../utils/embedBuilder.js"
import { box, text, C2_FLAG } from "../utils/cv2.js"
import { checkCooldown } from "../utils/cooldown.js"
import { buildFavoriteButton } from "./favoritosHandler.js"
import { logAction, sendAntiScamAlert } from "../utils/logger.js"

// ─────────────────────────────────────────────
// PAINEL DE ANÚNCIOS STAFF
// ─────────────────────────────────────────────

export async function handleAnunciosCommand(interaction, client) {
  // Mantido para compatibilidade — redireciona para staffHandler
  const { handleStaffCommand } = await import("./staffHandler.js")
  await handleStaffCommand(interaction, client)
}

// ─────────────────────────────────────────────
// MODAL PASSO 1 — dados básicos da conta
// ─────────────────────────────────────────────

export async function showAnnouncementModalForm(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(`announce_submit_${interaction.channelId}`)
    .setTitle("Anunciar Conta Minecraft")

  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("nick").setLabel("Nickname da Conta").setStyle(TextInputStyle.Short)
        .setPlaceholder("Nick exato da conta").setRequired(true).setMaxLength(16)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("bans").setLabel("Histórico de Banimentos").setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("Ex: Nunca foi banido / Banido em 2020 por...").setRequired(true)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("capas").setLabel("Capas Disponíveis").setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: Minecon 2016, Migrator").setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("vips").setLabel("VIPs / Ranks").setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: VIP+, MVP++").setRequired(false)
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId("valor").setLabel("Valor (R$) — Somente números").setStyle(TextInputStyle.Short)
        .setPlaceholder("Ex: 150.00").setRequired(true)
    ),
  )
  await interaction.showModal(modal)
}

function validateMoney(raw) {
  const num = parseMoney(raw)
  if (num === null || num <= 0 || num > 999999) return null
  return num.toFixed(2)
}

export async function handleAnnouncementModal(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const config = client.config
  const nick = interaction.fields.getTextInputValue("nick").trim()
  const bans = interaction.fields.getTextInputValue("bans").trim()
  const capas = interaction.fields.getTextInputValue("capas").trim() || "Nenhuma"
  const vips  = interaction.fields.getTextInputValue("vips").trim()  || "Nenhum"
  const valorRaw = interaction.fields.getTextInputValue("valor")

  const valor = validateMoney(valorRaw)
  if (!valor) return interaction.editReply({ content: "❌ Valor inválido. Use apenas números (ex: 150.00 ou 150,00)." })

  if (isBlacklisted(interaction.user.id))
    return interaction.editReply({ content: "❌ Você está na blacklist e não pode criar anúncios." })

  const activeAnnouncements = getUserActiveAnnouncements(interaction.user.id)
  if (activeAnnouncements.length >= (config.limits?.maxActiveAnnouncements ?? 3))
    return interaction.editReply({ content: `❌ Você já tem ${config.limits?.maxActiveAnnouncements ?? 3} anúncio(s) ativo(s). Aguarde a venda ou aprovação.` })

  const cooldown = checkCooldown(interaction.user.id, "create_announcement", 30000)
  if (cooldown.onCooldown)
    return interaction.editReply({ content: `⏰ Aguarde ${cooldown.remaining}s antes de criar outro anúncio.` })

  const playerData = await getPlayerUUID(nick)
  if (playerData === "RATE_LIMITED")
    return interaction.editReply({ content: "⚠️ A API do Minecraft está com rate limit no momento. Aguarde 2 minutos e tente novamente." })
  if (!playerData)
    return interaction.editReply({ content: `❌ O nickname **"${nick}"** não existe no Minecraft. Verifique e tente novamente.` })

  // Anti-scam: detecção de contas duplicadas — FIX #8
  const duplicateAds = getAnnouncementsByUUID(playerData.uuid)
  const duplicateSellers = getDuplicateAccountSellers(playerData.uuid)
  const otherSellers = duplicateSellers.filter((id) => id !== interaction.user.id)
  let duplicateWarning = ""
  let isDuplicateUUID = false

  if (duplicateAds.length > 0 && otherSellers.length > 0) {
    isDuplicateUUID = true
    duplicateWarning = `\n\n⚠️ **Atenção:** Esta conta já foi anunciada por **${otherSellers.length}** outro(s) vendedor(es). A staff será notificada para verificar antes de aprovar.`
    await sendAntiScamAlert(client, "duplicate_uuid", {
      userId: interaction.user.id,
      targetId: playerData.uuid,
      details: `**Nick:** ${playerData.name}\n**Outros vendedores:** ${otherSellers.map((id) => `<@${id}>`).join(", ")}\n**Anúncios ativos com este UUID:** ${duplicateAds.length}`,
    })
  }

  // Atividade suspeita
  const suspiciousFlags = getUserSuspiciousActivity(interaction.user.id)
  if (suspiciousFlags.length > 0) {
    await sendAntiScamAlert(client, "suspicious_activity", {
      userId: interaction.user.id,
      details: `**Flags:** ${suspiciousFlags.map((f) => f.type).join(", ")}`,
    })
  }

  // Histórico de preços
  const priceHistory = getNickPriceHistory(playerData.name)
  let historyText = ""
  if (priceHistory.length > 0) {
    historyText = `\n\n📊 **Histórico de preços para ${playerData.name}:**\n` +
      priceHistory.map((h) => `R$ ${formatValor(h.valor)} (${h.status}) — ${new Date(h.created_at).toLocaleDateString("pt-BR")}`).join("\n")
  }

  await interaction.editReply({
    content: `✅ Nick **${playerData.name}** validado! Valor: R$ ${valor}${historyText}${duplicateWarning}\n\nAgora preencha as informações adicionais:`,
  })

  const tempId = saveTempModalData({ nick: playerData.name, uuid: playerData.uuid, bans, capas, vips, valor, isDuplicateUUID, otherSellers })
  const expiresAt = Math.floor((Date.now() + 3_600_000) / 1000) // 1h a partir de agora

  await interaction.followUp({
    content: `Clique abaixo para continuar:\n> ⏱️ Este botão expira <t:${expiresAt}:R>. Se expirar, use \`/ticket\` para recomeçar.`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`open_modal2_${tempId}`)
          .setLabel("Informações Adicionais →")
          .setStyle(ButtonStyle.Primary),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  })
}

// ─────────────────────────────────────────────
// MODAL PASSO 2 — dados adicionais
// ─────────────────────────────────────────────

export async function handleAnnouncementFinalModal(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config

  try {
    const tempId = params.slice(1).join("_")
    const storedData = getTempModalData(tempId)
    if (!storedData) return interaction.editReply({ content: "❌ Seus dados de anúncio expiraram (limite de 1 hora entre as etapas). Abra um novo ticket de anúncio para recomeçar." })

    const { nick, uuid, bans, capas, vips, valor, isDuplicateUUID, otherSellers } = storedData
    const tags       = interaction.fields.getTextInputValue("tags")       || "Nenhuma"
    const medalhas   = interaction.fields.getTextInputValue("medalhas")   || "Nenhuma"
    const winsLevel  = interaction.fields.getTextInputValue("wins_level") || "N/A"
    const cosmeticos = interaction.fields.getTextInputValue("cosmeticos") || "Nenhum"

    const ticket = getTicket(interaction.channelId)
    if (!ticket) return interaction.editReply({ content: "❌ Ticket não encontrado." })

    const result = createAnnouncement({ ticketId: ticket.id, userId: interaction.user.id, nick, uuid, bans, capas, vips, tags, medalhas, winsLevel, cosmeticos, valor })
    // FIX BUG-8: lastInsertRowid pode ser BigInt em versões recentes do better-sqlite3.
    // Converter para Number para garantir compatibilidade com getAnnouncement e embeds.
    const announcementId = Number(result.lastInsertRowid)
    if (!announcementId) {
      console.error("[ANUNCIO] Falha ao obter ID do anúncio criado:", result)
      return interaction.editReply({ content: "❌ Erro ao registrar anúncio. Tente novamente." })
    }
    const announcement = getAnnouncement(announcementId)

    deleteTempModalData(tempId)

    // Alerta de UUID duplicado adicionado ao container C2
    const duplicateAlertSuffix = (isDuplicateUUID && otherSellers?.length > 0)
      ? `\n\n🚨 **ALERTA: UUID DUPLICADO**\nEsta conta já foi anunciada por: ${otherSellers.map((id) => `<@${id}>`).join(", ")}\n\n**⚠️ Verifique se é tentativa de scam antes de aprovar!**\nUse \`/verificarconta ${nick}\` para checar o histórico.`
      : ""

    const reviewContainer = buildAnnouncementReviewC2(announcement, interaction.user)

    // Append duplicate warning text into the container when needed
    const reviewComponents = duplicateAlertSuffix
      ? [box(
          `## 📋 Novo Anúncio para Revisão\n\n**Vendedor:** ${interaction.user.tag} (${interaction.user.id})  **Nick:** ${announcement.nick}  **Valor:** R$ ${formatValor(announcement.valor)}\n\n**Bans:** ${announcement.bans || "Não informado"}\n**Capas:** ${announcement.capas || "Nenhuma"}   **VIPs:** ${announcement.vips || "Nenhum"}   **Tags:** ${announcement.tags || "Nenhuma"}\n**Medalhas:** ${announcement.medalhas || "Nenhuma"}   **Wins/Level:** ${announcement.wins_level ?? "N/A"}   **Cosméticos:** ${announcement.cosmeticos || "Nenhum"}${duplicateAlertSuffix}\n\n-# Revise com atenção antes de aprovar`,
          isDuplicateUUID ? 0xFF0000 : 0xFFA500
        )]
      : [reviewContainer]

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`approve_${announcementId}`).setLabel("✅ Aprovar").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`reject_${announcementId}`).setLabel("❌ Recusar").setStyle(ButtonStyle.Danger),
    )

    // FIX #8: mention staff with extra urgency if duplicate UUID
    const mentionContent = isDuplicateUUID
      ? `🚨 <@&${config.roles.staff}> **ATENÇÃO — UUID duplicado detectado!** Revise com cuidado antes de aprovar.`
      : `<@&${config.roles.staff}> Novo anúncio para revisão!`

    await interaction.channel.send({
      content: mentionContent,
      components: [appendRows(...reviewComponents, row)],
      flags: C2_FLAG,
    })

    addLog("announcement_created", interaction.user.id, String(announcementId), `Nick: ${nick}`)
    await interaction.editReply({ content: "✅ Anúncio enviado para aprovação! Aguarde a análise da staff." })
  } catch (err) {
    console.error("[ANUNCIO] Erro no modal final:", err)
    await interaction.editReply({ content: "❌ Erro ao processar o anúncio. Tente novamente." })
  }
}

// ─────────────────────────────────────────────
// APROVAÇÃO
// ─────────────────────────────────────────────

async function approveAnnouncementAction(interaction, announcementId, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const config = client.config
  const announcement = getAnnouncement(announcementId)

  if (!announcement) return interaction.editReply({ content: "Anúncio não encontrado." })
  if (announcement.status !== "pending") return interaction.editReply({ content: "Este anúncio já foi processado." })

  try {
    const seller = await client.users.fetch(announcement.user_id)
    const sellerRating = getUserAverageRating(announcement.user_id)
    const namemc = `https://namemc.com/profile/${announcement.uuid}`

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`interest_${announcementId}`).setLabel("Tenho Interesse").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setURL(namemc).setLabel("Ver no NameMC").setStyle(ButtonStyle.Link),
      buildFavoriteButton(announcementId),
    )

    const announcementChannel = await client.channels.fetch(config.channels.anuncios)
    const publicContainer = buildPublicAnnouncementC2(announcement, seller, sellerRating)
    const message = await announcementChannel.send({ components: [appendRows(publicContainer, row)], flags: C2_FLAG })

    approveAnnouncement(announcementId, message.id, interaction.user.id)

    // Disparar alertas
    const matchingAlerts = matchAlerts(announcement)
    for (const alert of matchingAlerts) {
      try {
        const alertUser = await client.users.fetch(alert.user_id)
        const f = alert.filters
        const filtersText = [
          f.nick ? `Nick: ${f.nick}` : null,
          f.minPrice ? `Min: R$ ${f.minPrice}` : null,
          f.maxPrice ? `Max: R$ ${f.maxPrice}` : null,
          f.vip ? `VIP: ${f.vip}` : null,
        ].filter(Boolean).join(" · ")

        await alertUser.send({
          embeds: [new EmbedBuilder()
            .setColor(COLORS.SUCCESS)
            .setTitle("🔔 Alerta: Conta Disponível!")
            .setDescription(`Um anúncio correspondeu ao seu alerta!\n\n**Filtros:** ${filtersText}`)
            .addFields(
              { name: "Nick", value: announcement.nick, inline: true },
              { name: "Valor", value: `R$ ${formatValor(announcement.valor)}`, inline: true },
              { name: "Ver Anúncio", value: `<#${config.channels.anuncios}>`, inline: false },
              { name: "📌 Ação", value: "Acesse o canal de anúncios para demonstrar interesse.", inline: false },
            )
            .setThumbnail(getSkinUrls(announcement.uuid).avatar)
            .setTimestamp()],
        })
        markAlertTriggered(alert.id)
      } catch { /* DM fechada */ }
    }

    addLog("announcement_approved", interaction.user.id, String(announcementId), `Aprovado por ${interaction.user.tag}`)

    // Fechar ticket
    const ticket = getTicket(interaction.channel.id)
    if (ticket) {
      closeTicket(interaction.channel.id)
      await interaction.channel.send({ content: `✅ Anúncio aprovado por ${interaction.user}! Canal será fechado em 10s.` })
      setTimeout(() => interaction.channel.delete().catch(() => {}), 10000)
    }

    // DM ao vendedor (melhorada — fix #10)
    try {
      await seller.send({ embeds: [buildApprovalDmEmbed(announcement, interaction.guild)] })
    } catch { /* DM fechada */ }

    await logAction(client, "announcement_approved", {
      userId: interaction.user.id,
      targetId: String(announcementId),
      details: `**Nick:** ${announcement.nick}\n**Valor:** R$ ${formatValor(announcement.valor)}\n**Vendedor:** <@${announcement.user_id}>`,
      thumbnail: getSkinUrls(announcement.uuid).body,
    })

    await interaction.editReply({ content: "✅ Anúncio aprovado e publicado!" })
  } catch (err) {
    console.error("[ANUNCIO] Erro ao aprovar:", err)
    await interaction.editReply({ content: "❌ Erro ao aprovar anúncio." })
  }
}

// ─────────────────────────────────────────────
// REJEIÇÃO
// ─────────────────────────────────────────────

export async function handleRejectReasonModal(interaction, params, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })
  const announcementId = parseInt(params[0])
  const reason = interaction.fields.getTextInputValue("reason")
  await rejectAnnouncementAction(interaction, announcementId, client, reason)
}

async function rejectAnnouncementAction(interaction, announcementId, client, reason = "Sem motivo informado") {
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const announcement = getAnnouncement(announcementId)
  if (!announcement) return interaction.editReply({ content: "Anúncio não encontrado." })
  if (announcement.status !== "pending") return interaction.editReply({ content: "Este anúncio já foi processado." })

  rejectAnnouncement(announcementId, interaction.user.id, reason)
  addLog("announcement_rejected", interaction.user.id, String(announcementId), `Motivo: ${reason}`)

  await logAction(client, "announcement_rejected", {
    userId: interaction.user.id,
    targetId: String(announcementId),
    details: `**Nick:** ${announcement.nick}\n**Valor:** R$ ${formatValor(announcement.valor)}\n**Vendedor:** <@${announcement.user_id}>\n**Motivo:** ${reason}`,
  })

  // DM ao vendedor (melhorada — fix #10)
  try {
    const seller = await client.users.fetch(announcement.user_id)
    await seller.send({ embeds: [buildRejectionDmEmbed(announcement, reason, interaction.guild)] })
  } catch { /* DM fechada */ }

  await interaction.channel.send({ content: `❌ Anúncio recusado por ${interaction.user}. Canal será fechado em 10s.` })
  setTimeout(() => interaction.channel.delete().catch(() => {}), 10000)
  await interaction.editReply({ content: "Anúncio recusado." })
}

// ─────────────────────────────────────────────
// ROUTER DE BOTÕES
// ─────────────────────────────────────────────

export async function handleAnnouncementButton(interaction, action, params, client) {
  const config = client.config

  if (action === "announce" && params[0] === "modal") {
    return showAnnouncementModalForm(interaction)
  }

  if (action === "open" && params[0] === "modal2") {
    const tempId = params.slice(1).join("_")
    const stored = getTempModalData(tempId)
    if (!stored) return interaction.reply({ content: "❌ Seus dados expiraram (limite de 1 hora). Abra um novo ticket de anúncio para recomeçar.", flags: MessageFlags.Ephemeral })

    const modal2 = new ModalBuilder().setCustomId(`announce_final_${tempId}`).setTitle("Informações Adicionais")
    modal2.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("tags").setLabel("Tags Especiais").setStyle(TextInputStyle.Short).setPlaceholder("Ex: [MVP], [LEGEND]").setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("medalhas").setLabel("Medalhas").setStyle(TextInputStyle.Short).setPlaceholder("Ex: Top 10 Bedwars, 1000 Wins").setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("wins_level").setLabel("Wins / Level").setStyle(TextInputStyle.Short).setPlaceholder("Ex: 5000 wins, Level 250").setRequired(false)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("cosmeticos").setLabel("Cosméticos").setStyle(TextInputStyle.Paragraph).setPlaceholder("Ex: Todas as danças, 50+ skins").setRequired(false)),
    )
    return interaction.showModal(modal2)
  }

  if (action === "approve" || action === "reject") {
    if (!interaction.member.roles.cache.has(config.roles.staff))
      return interaction.reply({ content: "❌ Apenas staff pode aprovar/rejeitar anúncios.", flags: MessageFlags.Ephemeral })

    const announcementId = parseInt(params[0])
    if (action === "approve") {
      return approveAnnouncementAction(interaction, announcementId, client)
    } else {
      const modal = new ModalBuilder().setCustomId(`reject_reason_${announcementId}`).setTitle("Motivo da Rejeição")
      const reasonInput = new TextInputBuilder().setCustomId("reason").setLabel("Motivo (será enviado ao vendedor)").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(500)
      modal.addComponents(new ActionRowBuilder().addComponents(reasonInput))
      return interaction.showModal(modal)
    }
  }

  if (action === "bump") {
    const { handleBumpAnnouncement } = await import("./negotiationHandler.js")
    return handleBumpAnnouncement(interaction, params, client)
  }

  if (action === "rate") {
    const { handleRatingButton } = await import("./negotiationHandler.js")
    return handleRatingButton(interaction, params, client)
  }

  if (action === "confirmclose") {
    const { handleConfirmClose } = await import("./negotiationHandler.js")
    return handleConfirmClose(interaction, params, client)
  }

  if (action === "cancelclose") {
    await interaction.update({ content: "Fechamento cancelado.", components: [] })
    return
  }

  // Encaminhar para negotiationHandler
  const { handleNegotiationButton } = await import("./negotiationHandler.js")
  return handleNegotiationButton(interaction, action, params, client)
}
