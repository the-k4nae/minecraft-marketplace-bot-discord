/**
 * healthcheck.js
 *
 * FIX #13: Endpoint HTTP simples para monitoramento externo.
 * Responde em http://localhost:PORT/health com status do bot.
 * Compatível com UptimeRobot, Betterstack, Docker HEALTHCHECK, etc.
 *
 * Porta padrão: 3000 (configurável via env HEALTHCHECK_PORT)
 */

import { createServer } from "http"
import { getStats } from "./database.js"

let _client = null
let _server = null

// FIX S-3: Cache de 5 segundos para evitar queries excessivas ao banco
let _cachedResponse = null
let _cacheExpiry = 0

export function startHealthcheck(client) {
  _client = client
  const PORT = parseInt(process.env.HEALTHCHECK_PORT ?? "3000")

  _server = createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      const now = Date.now()
      let body

      if (_cachedResponse && now < _cacheExpiry) {
        body = _cachedResponse
      } else {
        const isReady = _client?.isReady() ?? false
        let stats = {}
        try { stats = getStats() } catch { /* db pode não estar pronto */ }

        body = JSON.stringify({
          status: isReady ? "ok" : "degraded",
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          bot: {
            tag: _client?.user?.tag ?? null,
            ready: isReady,
            guilds: _client?.guilds?.cache?.size ?? 0,
            ping: _client?.ws?.ping ?? -1,
          },
          db: {
            tickets: stats.totalTickets ?? 0,
            announcements: stats.totalAnnouncements ?? 0,
            negotiations: stats.totalNegotiations ?? 0,
          },
        })
        _cachedResponse = body
        _cacheExpiry = now + 5000
      }

      const isReady = _client?.isReady() ?? false
      res.writeHead(isReady ? 200 : 503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      })
      res.end(body)
      return
    }

    res.writeHead(404).end('{"error":"not found"}')
  })

  _server.listen(PORT, "0.0.0.0", () => {
    console.log(`[HEALTHCHECK] Servidor rodando em http://0.0.0.0:${PORT}/health`)
  })

  _server.on("error", (err) => {
    console.error("[HEALTHCHECK] Erro no servidor:", err.message)
  })
}

export function stopHealthcheck() {
  _server?.close()
}
