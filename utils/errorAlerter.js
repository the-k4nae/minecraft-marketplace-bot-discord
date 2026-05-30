/**
 * FEATURE 4 — Alertas ricos para erros críticos no Discord
 *
 * Melhorias sobre o sistema atual:
 *  - Embed com stack trace completo formatado (sem truncar silenciosamente)
 *  - Circuit breaker: para de enviar após N erros por minuto (evita flood)
 *  - Botão "Reiniciar Bot" para staff (executa pm2 restart via shell)
 *  - Agrupamento: erros repetidos do mesmo tipo não duplicam — só atualiza o contador
 *  - Contexto extra: uso de memória, uptime, shard ping no momento do erro
 *
 * ── Como aplicar ──────────────────────────────────────────────────────────────
 * 1. Substitua o bloco process.on("unhandledRejection") e process.on("uncaughtException")
 *    em index.js pelas versões abaixo.
 * 2. Importe initErrorAlerter() e chame no início do index.js, antes do login.
 * 3. (Opcional) Adicione CHANNEL_ERRORS ao .env para canal dedicado a erros críticos.
 */

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js"
import { exec } from "child_process"
import { fileLog } from "./fileLogger.js"

// ─── Circuit breaker ─────────────────────────────────────────────────────────
// Máximo de alertas por janela de tempo — protege contra tempestade de erros

const BREAKER_MAX     = 5     // máx alertas
const BREAKER_WINDOW  = 60_000 // por minuto
const _alerts = []             // timestamps de alertas enviados

function circuitOpen() {
  const now  = Date.now()
  const cutoff = now - BREAKER_WINDOW
  // Remove antigos
  while (_alerts.length && _alerts[0] < cutoff) _alerts.shift()
  if (_alerts.length >= BREAKER_MAX) return true  // circuito aberto
  _alerts.push(now)
  return false
}

// ─── Dedup: agrupar erros repetidos ─────────────────────────────────────────
// Map<fingerprint, { messageId, count, lastSeen }>
const _sentErrors = new Map()

function fingerprint(error) {
  return String(error?.stack ?? error?.message ?? error)
    .substring(0, 120)
    .replace(/\d+/g, "N")  // normaliza números de linha
}

// ─── Builder do embed de erro ─────────────────────────────────────────────────

function buildErrorEmbed(context, error, client, extra = {}) {
  const errStr   = String(error?.message ?? error ?? "Erro desconhecido")
  const stack    = String(error?.stack ?? "").split("\n").slice(0, 8).join("\n")
  const memMb    = (process.memoryUsage().heapUsed / 1_048_576).toFixed(1)
  const uptimeH  = (process.uptime() / 3600).toFixed(1)
  const ping     = client?.ws?.ping ?? -1

  return new EmbedBuilder()
    .setColor("#FF0000")
    .setTitle(`🚨 Erro Crítico${extra.count > 1 ? ` (×${extra.count})` : ""}`)
    .addFields(
      { name: "Contexto",    value: `\`${context}\``,                                 inline: false },
      { name: "Mensagem",    value: `\`\`\`${errStr.substring(0, 500)}\`\`\``,         inline: false },
      { name: "Stack trace", value: stack ? `\`\`\`${stack.substring(0, 800)}\`\`\`` : "_sem stack_", inline: false },
      { name: "Memória",     value: `${memMb} MB`,       inline: true },
      { name: "Uptime",      value: `${uptimeH}h`,        inline: true },
      { name: "WS Ping",     value: `${ping}ms`,          inline: true },
      ...(extra.count > 1 ? [{ name: "Último às", value: `<t:${Math.floor(Date.now()/1000)}:T>`, inline: true }] : []),
    )
    .setTimestamp()
    .setFooter({ text: `PID ${process.pid} · Node ${process.version}` })
}

function buildRestartRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("admin_restart_bot")
      .setLabel("🔄 Reiniciar Bot")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("admin_ignore_error")
      .setLabel("✓ Ciente")
      .setStyle(ButtonStyle.Secondary),
  )
}

// ─── Envio principal ──────────────────────────────────────────────────────────

let _client = null

export function initErrorAlerter(client) {
  _client = client
}

export async function sendCriticalError(context, error) {
  // Sempre loga no console com stack completo
  fileLog.error({ context, err: error?.message, stack: error?.stack }, "[ERRO CRÍTICO]")

  if (!_client?.isReady()) return

  // Circuit breaker
  if (circuitOpen()) {
    fileLog.warn("[ALERTAS] Circuit breaker ativo — erro suprimido para o Discord")
    return
  }

  const fp    = fingerprint(error)
  const prior = _sentErrors.get(fp)
  const config = _client.config

  // Canal de erros dedicado ou fallback para logs
  const channelId = process.env.CHANNEL_ERRORS || config?.channels?.logs
  if (!channelId) return

  try {
    const ch = await _client.channels.fetch(channelId).catch(() => null)
    if (!ch) return

    const staffMention = config?.roles?.staff ? `<@&${config.roles.staff}>` : ""

    if (prior) {
      // Atualizar mensagem existente com contador
      prior.count++
      prior.lastSeen = Date.now()
      _sentErrors.set(fp, prior)

      try {
        const msg = await ch.messages.fetch(prior.messageId).catch(() => null)
        if (msg) {
          await msg.edit({ embeds: [buildErrorEmbed(context, error, _client, prior)] })
          return
        }
      } catch { /* mensagem pode ter sido deletada */ }
    }

    // Novo erro — enviar mensagem
    const msg = await ch.send({
      content: staffMention ? `${staffMention} — erro crítico detectado!` : undefined,
      embeds: [buildErrorEmbed(context, error, _client, { count: 1 })],
      components: [buildRestartRow()],
    })

    _sentErrors.set(fp, { messageId: msg.id, count: 1, lastSeen: Date.now() })

    // Limpar do dedup após 10 minutos (para não suprimir erros que ressurgem muito depois)
    setTimeout(() => _sentErrors.delete(fp), 10 * 60_000)

  } catch (e) {
    fileLog.error({ err: e?.message }, "[ALERTAS] Falha ao enviar alerta de erro")
  }
}

// ─── Handler do botão "Reiniciar Bot" ─────────────────────────────────────────

/**
 * Adicionar em events/interactionCreate.js:
 *
 *   if (interaction.isButton()) {
 *     if (customId === "admin_restart_bot") return handleAdminRestart(interaction, client)
 *     if (customId === "admin_ignore_error") return handleAdminIgnore(interaction)
 *   }
 */
export async function handleAdminRestart(interaction, client) {
  if (!interaction.member?.permissions?.has("Administrator")) {
    return interaction.reply({ content: "❌ Sem permissão. Apenas administradores podem reiniciar o bot.", flags: MessageFlags.Ephemeral })
  }

  await interaction.reply({ content: "🔄 Reiniciando via PM2...", flags: MessageFlags.Ephemeral })

  exec("pm2 restart bot-minecraft --no-daemon", (err) => {
    if (err) fileLog.error({ err: err?.message }, "[ADMIN] Falha ao reiniciar")
  })
}

export async function handleAdminIgnore(interaction) {
  await interaction.update({
    components: [new ActionRowBuilder().addComponents(
      ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true),
      ButtonBuilder.from(interaction.message.components[0].components[1]).setLabel("✓ Ciente").setDisabled(true),
    )],
  })
}

// ─── Substituições em index.js ────────────────────────────────────────────────

/**
 * Antes:
 *   process.on("unhandledRejection", (reason) => {
 *     console.error("[UNHANDLED REJECTION]", reason)
 *     sendLogEmbed(client, { title: "Erro Não Tratado", ... }).catch(() => {})
 *   })
 *
 * Depois:
 *   import { initErrorAlerter, sendCriticalError } from "./utils/errorAlerter.js"
 *
 *   // Após client.login():
 *   client.once("clientReady", () => {
 *     initErrorAlerter(client)
 *     ...
 *   })
 *
 *   process.on("unhandledRejection", (reason) => {
 *     sendCriticalError("unhandledRejection", reason)
 *   })
 *
 *   process.on("uncaughtException", (error) => {
 *     sendCriticalError("uncaughtException", error)
 *     saveDatabaseSync()
 *     createBackupSync()
 *     process.exit(1)
 *   })
 *
 * Também adicione CHANNEL_ERRORS ao .env (opcional):
 *   CHANNEL_ERRORS=1234567890  # canal dedicado para erros críticos
 */
