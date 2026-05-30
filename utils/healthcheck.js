/**
 * utils/healthcheck.js — v2
 *
 * Melhorias:
 *  - db_size_mb: tamanho real do arquivo SQLite em disco
 *  - active_negotiations, pending_announcements: métricas operacionais
 *  - memory_mb: consumo de heap do processo
 *  - Endpoint /metrics para monitoramento mais detalhado (Prometheus-friendly)
 *  - Endpoint /ready separado de /health (K8s readiness vs liveness probe)
 */

import { createServer }  from "http"
import { statSync }      from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { getStats }      from "./database.js"
import { fileLog }       from "./fileLogger.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH   = join(__dirname, "..", "bot-data.sqlite")

let _client = null
let _server = null

// Cache de 5s para evitar queries excessivas
let _cachedResponse  = null
let _cacheExpiry     = 0
const CACHE_TTL_MS   = 5_000

function getDbSizeMb() {
  try { return +(statSync(DB_PATH).size / 1_048_576).toFixed(2) }
  catch { return null }
}

function buildHealthBody() {
  const now     = Date.now()
  const isReady = _client?.isReady() ?? false
  let stats = {}
  try { stats = getStats() } catch { /* db pode não estar pronto */ }

  return {
    status:    isReady ? "ok" : "degraded",
    uptime_s:  Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    bot: {
      tag:    _client?.user?.username ?? null,
      ready:  isReady,
      guilds: _client?.guilds?.cache?.size ?? 0,
      ws_ping_ms: _client?.ws?.ping ?? -1,
    },
    db: {
      size_mb:              getDbSizeMb(),
      open_tickets:         stats.openTickets          ?? 0,
      active_announcements: stats.activeAnnouncements  ?? 0,
      pending_announcements: stats.pendingAnnouncements ?? 0,
      active_negotiations:  stats.totalNegotiations    ?? 0,
      completed_sales:      stats.completedNegotiations ?? 0,
      blacklisted_users:    stats.blacklistedUsers      ?? 0,
    },
    process: {
      memory_mb:  +(process.memoryUsage().heapUsed / 1_048_576).toFixed(1),
      node_version: process.version,
      pid:         process.pid,
    },
  }
}

function buildMetrics(data) {
  // Formato Prometheus (text/plain) para integração com Grafana, etc.
  const lines = [
    `# HELP bot_uptime_seconds Uptime do bot em segundos`,
    `# TYPE bot_uptime_seconds gauge`,
    `bot_uptime_seconds ${data.uptime_s}`,
    `# HELP bot_ws_ping_ms Ping WebSocket do Discord em ms`,
    `# TYPE bot_ws_ping_ms gauge`,
    `bot_ws_ping_ms ${data.bot.ws_ping_ms}`,
    `# HELP bot_memory_mb Uso de heap em MB`,
    `# TYPE bot_memory_mb gauge`,
    `bot_memory_mb ${data.process.memory_mb}`,
    `# HELP bot_db_size_mb Tamanho do banco em MB`,
    `# TYPE bot_db_size_mb gauge`,
    `bot_db_size_mb ${data.db.size_mb ?? 0}`,
    `# HELP bot_open_tickets Tickets abertos`,
    `# TYPE bot_open_tickets gauge`,
    `bot_open_tickets ${data.db.open_tickets}`,
    `# HELP bot_active_announcements Anúncios aprovados ativos`,
    `# TYPE bot_active_announcements gauge`,
    `bot_active_announcements ${data.db.active_announcements}`,
    `# HELP bot_pending_announcements Anúncios aguardando aprovação`,
    `# TYPE bot_pending_announcements gauge`,
    `bot_pending_announcements ${data.db.pending_announcements}`,
  ]
  return lines.join("\n") + "\n"
}

export function startHealthcheck(client) {
  _client = client
  const PORT = parseInt(process.env.HEALTHCHECK_PORT ?? "3000")

  _server = createServer((req, res) => {
    const url = req.url?.split("?")[0]

    // ── /health ou / — liveness probe ──────────────────────────────────────
    if (url === "/health" || url === "/") {
      const now = Date.now()
      let data

      if (_cachedResponse && now < _cacheExpiry) {
        data = _cachedResponse
      } else {
        data = buildHealthBody()
        _cachedResponse = data
        _cacheExpiry    = now + CACHE_TTL_MS
      }

      const isReady = data.bot.ready
      res.writeHead(isReady ? 200 : 503, {
        "Content-Type":  "application/json",
        "Cache-Control": "no-cache",
      })
      res.end(JSON.stringify(data, null, 2))
      return
    }

    // ── /ready — readiness probe (K8s / Railway) ────────────────────────────
    if (url === "/ready") {
      const isReady = _client?.isReady() ?? false
      res.writeHead(isReady ? 200 : 503, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ ready: isReady }))
      return
    }

    // ── /metrics — Prometheus scrape endpoint ───────────────────────────────
    if (url === "/metrics") {
      const data = buildHealthBody()
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" })
      res.end(buildMetrics(data))
      return
    }

    res.writeHead(404).end('{"error":"not found"}')
  })

  _server.listen(PORT, "0.0.0.0", () => {
    fileLog.info({ port: PORT }, "[HEALTHCHECK] Servidor iniciado")
  })

  _server.on("error", err => {
    fileLog.error({ err: err.message }, "[HEALTHCHECK] Erro no servidor")
  })
}

export function stopHealthcheck() {
  _server?.close()
}
