import { EmbedBuilder } from "discord.js"

/**
 * Cores por tipo de log
 */
const LOG_COLORS = {
  // Tickets
  ticket_created: "#5865F2",
  ticket_closed: "#FF6B6B",
  ticket_claimed: "#00D166",
  ticket_call_created: "#7289DA",

  // Anuncios
  announcement_created: "#FFA500",
  announcement_approved: "#00FF00",
  announcement_rejected: "#FF0000",
  announcement_expired: "#FF6B6B",
  announcement_bumped: "#5865F2",
  announcement_edited: "#FFA500",

  // Negociacoes
  negotiation_started: "#5865F2",
  negotiation_completed: "#00FF00",
  negotiation_cancelled: "#FF0000",
  sale_completed: "#00D166",

  // Moderacao
  blacklist_add: "#FF0000",
  blacklist_remove: "#00FF00",
  staff_called: "#FFA500",

  // Avaliacoes
  rating_created: "#FFD700",

  // Anti-Scam
  duplicate_account_detected: "#FF0000",
  suspicious_activity: "#FFA500",
  escrow_confirmed: "#00D166",

  // Sistema
  bot_started: "#00FF00",
  bot_stopped: "#FF6B6B",
  error: "#FF0000",
  warning: "#FFA500",
}

/**
 * Icones por tipo de log
 */
const LOG_ICONS = {
  ticket_created: "TICKET",
  ticket_closed: "TICKET",
  ticket_claimed: "TICKET",
  ticket_call_created: "TICKET",
  announcement_created: "ANUNCIO",
  announcement_approved: "ANUNCIO",
  announcement_rejected: "ANUNCIO",
  announcement_expired: "ANUNCIO",
  announcement_bumped: "ANUNCIO",
  announcement_edited: "ANUNCIO",
  negotiation_started: "NEGOCIACAO",
  negotiation_completed: "NEGOCIACAO",
  negotiation_cancelled: "NEGOCIACAO",
  sale_completed: "VENDA",
  blacklist_add: "MODERACAO",
  blacklist_remove: "MODERACAO",
  staff_called: "MODERACAO",
  rating_created: "AVALIACAO",
  duplicate_account_detected: "ANTI-SCAM",
  suspicious_activity: "ANTI-SCAM",
  escrow_confirmed: "ESCROW",
  bot_started: "SISTEMA",
  bot_stopped: "SISTEMA",
  error: "ERRO",
  warning: "AVISO",
}

/**
 * Envia uma embed de log para o canal de logs
 * @param {import("discord.js").Client} client
 * @param {object} options
 * @param {string} options.title - Titulo do log
 * @param {string} options.description - Descricao do log
 * @param {string} [options.color] - Cor hex do embed
 * @param {string} [options.type] - Tipo do log para cor automatica
 * @param {Array} [options.fields] - Campos adicionais
 * @param {string} [options.thumbnail] - URL da thumbnail
 * @param {string} [options.footer] - Texto do footer
 */
const ANTISCAM_TYPES = new Set(["duplicate_account_detected", "suspicious_activity"])

export async function sendLogEmbed(client, options) {
  try {
    // FIX #6: Alertas anti-scam vão para canal dedicado (se configurado) + mention à staff
    const isAntiScam = ANTISCAM_TYPES.has(options.type)
    const antiScamChannelId = client.config?.channels?.antiscam
    const logsChannelId = client.config?.channels?.logs

    const targetChannelId = isAntiScam && antiScamChannelId && antiScamChannelId.length > 0 ? antiScamChannelId : logsChannelId
    if (!targetChannelId) return

    const logsChannel = await client.channels.fetch(targetChannelId).catch(() => null)
    if (!logsChannel) return

    const color = options.color || LOG_COLORS[options.type] || "#5865F2"
    const category = LOG_ICONS[options.type] || "LOG"

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(`[${category}] ${options.title}`)
      .setTimestamp()

    if (options.description) {
      embed.setDescription(options.description)
    }

    if (options.fields && options.fields.length > 0) {
      embed.addFields(options.fields)
    }

    if (options.thumbnail) {
      embed.setThumbnail(options.thumbnail)
    }

    embed.setFooter({ text: options.footer || `Log do Sistema` })

    const staffRoleId = client.config?.roles?.staff
    const content = isAntiScam && staffRoleId
      ? `🚨 <@&${staffRoleId}> — Atenção anti-scam!`
      : undefined

    await logsChannel.send({ content, embeds: [embed] })
  } catch (error) {
    // Silencioso - logs nunca devem crashar o bot
    console.error("[LOGGER] Erro ao enviar log:", error.message)
  }
}

/**
 * Envia log detalhado de uma acao
 * @param {import("discord.js").Client} client
 * @param {string} type - Tipo da acao
 * @param {object} data - Dados do log
 * @param {string} [data.userId] - ID do usuario que executou
 * @param {string} [data.targetId] - ID do alvo
 * @param {string} [data.details] - Detalhes extras
 * @param {Array} [data.fields] - Campos adicionais
 * @param {string} [data.thumbnail] - Thumbnail
 */
export async function logAction(client, type, data = {}) {
  const titles = {
    ticket_created: "Ticket Criado",
    ticket_closed: "Ticket Fechado",
    ticket_claimed: "Ticket Assumido",
    ticket_call_created: "Call Criada",
    announcement_created: "Anuncio Criado",
    announcement_approved: "Anuncio Aprovado",
    announcement_rejected: "Anuncio Rejeitado",
    announcement_expired: "Anuncio Expirado",
    announcement_bumped: "Anuncio Atualizado (Bump)",
    announcement_edited: "Anuncio Editado",
    negotiation_started: "Negociacao Iniciada",
    negotiation_completed: "Negociacao Concluida",
    negotiation_cancelled: "Negociacao Cancelada",
    sale_completed: "Venda Concluida",
    blacklist_add: "Adicionado a Blacklist",
    blacklist_remove: "Removido da Blacklist",
    staff_called: "Staff Chamada",
    rating_created: "Avaliacao Registrada",
    duplicate_account_detected: "Conta Duplicada Detectada",
    suspicious_activity: "Atividade Suspeita",
    escrow_confirmed: "Escrow Confirmado",
  }

  const fields = []

  if (data.userId) {
    fields.push({ name: "Executado por", value: `<@${data.userId}>`, inline: true })
  }

  if (data.targetId) {
    fields.push({ name: "Alvo", value: data.targetId, inline: true })
  }

  if (data.details) {
    fields.push({ name: "Detalhes", value: data.details, inline: false })
  }

  if (data.fields) {
    fields.push(...data.fields)
  }

  await sendLogEmbed(client, {
    title: titles[type] || type,
    description: data.description || null,
    type,
    fields,
    thumbnail: data.thumbnail || null,
    footer: data.footer || `ID: ${data.targetId || "N/A"}`,
  })
}

/**
 * Log formatado de erro
 */
export async function logError(client, context, error) {
  await sendLogEmbed(client, {
    title: `Erro: ${context}`,
    description: `\`\`\`${String(error.message || error).substring(0, 1000)}\`\`\``,
    type: "error",
    fields: [
      { name: "Stack", value: `\`\`\`${String(error.stack || "N/A").substring(0, 500)}\`\`\``, inline: false },
    ],
  })
}

/**
 * FIX #6: Envia alerta de anti-scam para canal dedicado (se configurado) + canal de logs.
 * Alerta de UUID duplicado e atividade suspeita não se perdem no log geral.
 *
 * @param {import("discord.js").Client} client
 * @param {"duplicate_uuid"|"suspicious_activity"} type
 * @param {object} data
 */
export async function sendAntiScamAlert(client, type, data = {}) {
  const config = client.config

  const titles = {
    duplicate_uuid: "🚨 UUID Duplicado Detectado",
    suspicious_activity: "⚠️ Atividade Suspeita",
  }

  const colors = {
    duplicate_uuid: "#FF0000",
    suspicious_activity: "#FFA500",
  }

  const fields = []
  if (data.userId)  fields.push({ name: "Usuário",  value: `<@${data.userId}>`,   inline: true })
  if (data.targetId) fields.push({ name: "Alvo/ID", value: String(data.targetId), inline: true })
  if (data.details)  fields.push({ name: "Detalhes", value: data.details, inline: false })

  const embed = new EmbedBuilder()
    .setColor(colors[type] ?? "#FF0000")
    .setTitle(titles[type] ?? "🚨 Alerta Anti-Scam")
    .addFields(fields)
    .setTimestamp()
    .setFooter({ text: `Anti-Scam | ${type}` })

  if (data.thumbnail) embed.setThumbnail(data.thumbnail)

  // Enviar para canal antiscam dedicado (se configurado)
  const antiscamChannelId = config?.channels?.antiscam
  if (antiscamChannelId && antiscamChannelId.length > 0) {
    try {
      const ch = await client.channels.fetch(antiscamChannelId)
      if (ch) {
        const mention = `<@&${config.roles.staff}>`
        await ch.send({ content: mention, embeds: [embed] })
      }
    } catch (err) {
      console.error("[ANTISCAM] Erro ao enviar para canal antiscam:", err.message)
    }
  }

  // Sempre enviar também para o canal de logs
  try {
    const logsChannelId = config?.channels?.logs
    if (logsChannelId) {
      const logsChannel = await client.channels.fetch(logsChannelId)
      if (logsChannel) await logsChannel.send({ embeds: [embed] })
    }
  } catch { /* silencioso */ }
}
