import { fileLog } from "./fileLogger.js"
import { CV2, container, text, separator, section, thumbnail } from "./components.js"

// Cores por tipo de log
const LOG_COLORS = {
  ticket_created:      0x5865F2,
  ticket_closed:       0xFF6B6B,
  ticket_claimed:      0x00D166,
  ticket_call_created: 0x7289DA,
  announcement_created:  0xFFA500,
  announcement_approved: 0x00D166,
  announcement_rejected: 0xFF4444,
  announcement_expired:  0xFF6B6B,
  announcement_bumped:   0x5865F2,
  announcement_edited:   0xFFA500,
  announcement_deleted:  0xAAAAAA,
  negotiation_started:   0x5865F2,
  negotiation_completed: 0x00D166,
  negotiation_cancelled: 0xFF4444,
  sale_completed:        0x00D166,
  blacklist_add:    0xFF0000,
  blacklist_remove: 0x00D166,
  staff_called:     0xFFA500,
  rating_created: 0xFFD700,
  duplicate_account_detected: 0xFF0000,
  suspicious_activity:        0xFFA500,
  escrow_confirmed:           0x00D166,
  bot_started: 0x00D166,
  bot_stopped: 0xFF6B6B,
  error:       0xFF0000,
  warning:     0xFFA500,
  config_changed:            0x5865F2,
  announcement_panel_setup:  0xFFA500,
}

const LOG_ICONS = {
  ticket_created:      "🎫 TICKET",
  ticket_closed:       "🎫 TICKET",
  ticket_claimed:      "🎫 TICKET",
  ticket_call_created: "🎫 TICKET",
  announcement_created:  "📢 ANÚNCIO",
  announcement_approved: "📢 ANÚNCIO",
  announcement_rejected: "📢 ANÚNCIO",
  announcement_expired:  "📢 ANÚNCIO",
  announcement_bumped:   "📢 ANÚNCIO",
  announcement_edited:   "📢 ANÚNCIO",
  announcement_deleted:  "📢 ANÚNCIO",
  negotiation_started:   "🤝 NEGOCIAÇÃO",
  negotiation_completed: "🤝 NEGOCIAÇÃO",
  negotiation_cancelled: "🤝 NEGOCIAÇÃO",
  sale_completed:        "💰 VENDA",
  blacklist_add:    "🔨 MODERAÇÃO",
  blacklist_remove: "🔨 MODERAÇÃO",
  staff_called:     "🔨 MODERAÇÃO",
  rating_created: "⭐ AVALIAÇÃO",
  duplicate_account_detected: "🚨 ANTI-SCAM",
  suspicious_activity:        "🚨 ANTI-SCAM",
  escrow_confirmed:           "🔒 ESCROW",
  bot_started: "🟢 SISTEMA",
  bot_stopped: "🔴 SISTEMA",
  error:       "❌ ERRO",
  warning:     "⚠️ AVISO",
  config_changed:            "⚙️ CONFIG",
  announcement_panel_setup:  "📢 ANÚNCIO",
}

const ANTISCAM_TYPES = new Set(["duplicate_account_detected", "suspicious_activity"])

function nowBR() {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
}

export async function sendLogEmbed(client, options) {
  try {
    const isAntiScam = ANTISCAM_TYPES.has(options.type)
    const antiScamChannelId = client.config?.channels?.antiscam
    const logsChannelId     = client.config?.channels?.logs

    const targetChannelId = isAntiScam && antiScamChannelId?.length > 0
      ? antiScamChannelId
      : logsChannelId
    if (!targetChannelId) return

    const logsChannel = await client.channels.fetch(targetChannelId).catch(() => null)
    if (!logsChannel) return

    const rawColor = options.color ?? LOG_COLORS[options.type] ?? 0x5865F2
    const color    = typeof rawColor === "string" ? parseInt(rawColor.replace("#", ""), 16) : rawColor
    const category = LOG_ICONS[options.type] ?? "📋 LOG"
    const emoji    = category.split(" ")[0]
    const ts       = nowBR()

    const c = container(color)

    // Mention anti-scam no topo (dentro do container - CV2 nao aceita content separado)
    const staffRoleId = client.config?.roles?.staff
    if (isAntiScam && staffRoleId) {
      c.addTextDisplayComponents(text(`<@&${staffRoleId}>`))
      c.addSeparatorComponents(separator())
    }

    // Cabecalho minimalista: emoji + bold titulo
    const titleLine = `${emoji} **${options.title}**`
    const headerLines = [titleLine]
    if (options.description) headerLines.push("", options.description)

    if (options.thumbnail) {
      c.addSectionComponents(section(headerLines.join("\n"), thumbnail(options.thumbnail, options.title)))
    } else {
      c.addTextDisplayComponents(text(headerLines.join("\n")))
    }

    // Campos — nome simples sem bold, valor direto
    if (options.fields?.length) {
      const fieldText = options.fields.map(f => `${f.name}: ${f.value}`).join("\n")
      c.addSeparatorComponents(separator())
        .addTextDisplayComponents(text(fieldText))
    }

    // Footer
    c.addSeparatorComponents(separator())
      .addTextDisplayComponents(text(`-# ${options.footer ?? "Log do Sistema"} · ${ts}`))

    await logsChannel.send({ flags: CV2, components: [c] })
  } catch (error) {
    fileLog.error({ err: error?.message }, "[LOGGER] Erro ao enviar log")
  }
}

export async function logAction(client, type, data = {}) {
  const titles = {
    ticket_created:      "Ticket Criado",
    ticket_closed:       "Ticket Fechado",
    ticket_claimed:      "Ticket Assumido",
    ticket_call_created: "Call Criada",
    announcement_created:  "Anuncio Criado",
    announcement_approved: "Anuncio Aprovado",
    announcement_rejected: "Anuncio Rejeitado",
    announcement_expired:  "Anuncio Expirado",
    announcement_bumped:   "Anúncio Bumped",
    announcement_edited:   "Anúncio Editado",
    announcement_deleted:  "Anúncio Deletado",
    negotiation_started:   "Negociação Iniciada",
    negotiation_completed: "Negociação Concluída",
    negotiation_cancelled: "Negociação Cancelada",
    sale_completed:        "Venda Concluída",
    blacklist_add:    "Adicionado à Blacklist",
    blacklist_remove: "Removido da Blacklist",
    staff_called:     "Staff Chamada",
    rating_created: "Avaliação Registrada",
    duplicate_account_detected: "Conta Duplicada Detectada",
    suspicious_activity:        "Atividade Suspeita",
    escrow_confirmed:           "Escrow Confirmado",
    config_changed:             "Configuração Alterada",
    announcement_panel_setup:   "Painel de Anúncios Configurado",
  }

  const fields = []
  if (data.userId)   fields.push({ name: "Executado por", value: `<@${data.userId}>`, inline: true })
  if (data.targetId)  fields.push({ name: "Alvo / ID",    value: String(data.targetId), inline: true })
  if (data.details)  fields.push({ name: "Detalhes",      value: data.details, inline: false })
  if (data.fields)   fields.push(...data.fields)

  await sendLogEmbed(client, {
    title:       titles[type] ?? type,
    description: data.description ?? null,
    type,
    fields,
    thumbnail:   data.thumbnail ?? null,
    footer:      data.footer ?? (data.targetId ? `ID: ${data.targetId}` : "Log do Sistema"),
  })
}

export async function logError(client, context, error) {
  const msg   = String(error?.message ?? error).substring(0, 800)
  const stack = (error?.stack ?? "N/A")
    .split("\n").slice(0, 8).map(l => l.trim()).join("\n").substring(0, 900)

  await sendLogEmbed(client, {
    title:       context,
    description: `**Mensagem:**\n\`\`\`\n${msg}\n\`\`\`\n**Stack:**\n\`\`\`\n${stack}\n\`\`\``,
    type:        "error",
    footer:      `Erro - ${context}`,
  })
}

export async function sendAntiScamAlert(client, type, data = {}) {
  const config = client.config
  const ts     = nowBR()

  const titles = {
    duplicate_uuid:      "UUID Duplicado Detectado",
    suspicious_activity: "Atividade Suspeita",
  }
  const colors = {
    duplicate_uuid:      0xFF0000,
    suspicious_activity: 0xFFA500,
  }

  const color = colors[type] ?? 0xFF0000
  const title = titles[type] ?? "Alerta Anti-Scam"

  const fieldLines = []
  if (data.userId)   fieldLines.push(`Usuario: <@${data.userId}>`)
  if (data.targetId) fieldLines.push(`Alvo / ID: ${data.targetId}`)
  if (data.details)  fieldLines.push(`Detalhes: ${data.details}`)

  const buildCard = (withMention) => {
    const c = container(color)

    if (withMention && config.roles?.staff) {
      c.addTextDisplayComponents(text(`<@&${config.roles.staff}>`))
      c.addSeparatorComponents(separator())
    }

    const header = `🚨 **${title}**`
    if (data.thumbnail) {
      c.addSectionComponents(section(header, thumbnail(data.thumbnail, title)))
    } else {
      c.addTextDisplayComponents(text(header))
    }

    if (fieldLines.length) {
      c.addSeparatorComponents(separator())
        .addTextDisplayComponents(text(fieldLines.join("\n")))
    }

    c.addSeparatorComponents(separator())
      .addTextDisplayComponents(text(`-# Anti-Scam · ${ts}`))

    return { flags: CV2, components: [c] }
  }

  const antiscamChannelId = config?.channels?.antiscam
  if (antiscamChannelId?.length > 0) {
    try {
      const ch = await client.channels.fetch(antiscamChannelId).catch(() => null)
      if (ch) await ch.send(buildCard(true))
    } catch (err) {
      fileLog.error({ err: err?.message }, "[ANTISCAM] Erro ao enviar para canal antiscam")
    }
  }

  try {
    const logsChannelId = config?.channels?.logs
    if (logsChannelId) {
      const logsChannel = await client.channels.fetch(logsChannelId).catch(() => null)
      if (logsChannel) await logsChannel.send(buildCard(false))
    }
  } catch { /* silencioso */ }
}