/**
 * utils/fileLogger.js
 *
 * Logger em arquivo usando pino com rotação diária.
 * Garante que erros críticos (unhandledRejection, uncaughtException)
 * sejam persistidos mesmo quando o bot está offline e não consegue
 * enviar mensagens para o Discord.
 *
 * Uso:
 *   import { fileLog, fileLogError } from "./fileLogger.js"
 *   fileLog.info("Bot iniciado")
 *   fileLogError("contexto", error)
 *
 * Fallback: se pino não estiver instalado, usa console + fs manual.
 */

import { createWriteStream, mkdirSync, renameSync, existsSync, statSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname  = dirname(fileURLToPath(import.meta.url))
const LOGS_DIR   = join(__dirname, "..", "logs")
const MAX_SIZE_MB = 10  // rotaciona quando o arquivo chega em 10 MB

mkdirSync(LOGS_DIR, { recursive: true })

// ─── Rotação simples por tamanho ─────────────────────────────────────────────

function getLogPath() {
  return join(LOGS_DIR, "bot.log")
}

function rotateLogs() {
  const logPath = getLogPath()
  if (!existsSync(logPath)) return
  try {
    const { size } = statSync(logPath)
    if (size > MAX_SIZE_MB * 1024 * 1024) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      renameSync(logPath, join(LOGS_DIR, `bot-${stamp}.log`))
    }
  } catch { /* silencioso */ }
}

// ─── Tenta usar pino; cai para implementação mínima se não disponível ────────

let _logger = null

async function buildLogger() {
  try {
    const { default: pino } = await import("pino")
    const { default: pinoPretty } = await import("pino-pretty").catch(() => ({ default: null }))

    rotateLogs()
    const fileStream = createWriteStream(getLogPath(), { flags: "a" })

    // Saída para arquivo (JSON) + stdout (legível em dev)
    const streams = [{ stream: fileStream }]
    if (process.env.NODE_ENV !== "production" && pinoPretty) {
      streams.push({ stream: pinoPretty({ colorize: true, translateTime: "HH:MM:ss" }) })
    } else if (process.env.NODE_ENV !== "production") {
      streams.push({ stream: process.stdout })
    }

    _logger = pino(
      { level: process.env.LOG_LEVEL ?? "info", timestamp: pino.stdTimeFunctions.isoTime },
      pino.multistream(streams),
    )
  } catch {
    // Fallback: implementação mínima sem dependência externa
    _logger = buildFallbackLogger()
  }
}

function buildFallbackLogger() {
  rotateLogs()
  const stream = createWriteStream(getLogPath(), { flags: "a" })

  const write = (level, obj, msg) => {
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...obj }) + "\n"
    stream.write(line)
    if (process.env.NODE_ENV !== "production") {
      process.stdout.write(`[${level.toUpperCase()}] ${msg} ${obj && Object.keys(obj).length ? JSON.stringify(obj) : ""}\n`)
    }
  }

  return {
    info:  (obj, msg) => typeof obj === "string" ? write("info",  {}, obj) : write("info",  obj, msg ?? ""),
    warn:  (obj, msg) => typeof obj === "string" ? write("warn",  {}, obj) : write("warn",  obj, msg ?? ""),
    error: (obj, msg) => typeof obj === "string" ? write("error", {}, obj) : write("error", obj, msg ?? ""),
    debug: (obj, msg) => typeof obj === "string" ? write("debug", {}, obj) : write("debug", obj, msg ?? ""),
    child: () => buildFallbackLogger(),
  }
}

// Inicializa de forma assíncrona mas expõe síncrono via proxy
await buildLogger()

export const fileLog = _logger

/**
 * Loga erro com stack trace no arquivo.
 * @param {string} context — Onde o erro ocorreu (ex: "negotiationHandler")
 * @param {Error|any} error
 */
export function fileLogError(context, error) {
  if (!_logger) return
  _logger.error({
    context,
    message: String(error?.message ?? error),
    stack:   error?.stack?.substring(0, 2000) ?? "N/A",
  }, `Erro em ${context}`)
}

/**
 * Loga evento auditável (ação do usuário, venda, etc.)
 * Útil para compliance ou investigação de fraudes.
 */
export function fileLogAudit(action, data = {}) {
  if (!_logger) return
  _logger.info({ audit: true, action, ...data }, `[AUDIT] ${action}`)
}
