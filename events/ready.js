/**
 * ready.js — v2
 *
 * Status dinâmico real: cada rotação busca dados frescos do banco
 * e escolhe a mensagem mais relevante no momento.
 *
 * Lógica de prioridade:
 *  1. Se há tickets abertos → mostra quantos aguardam atendimento
 *  2. Se há negociações ativas → mostra quantas estão em andamento
 *  3. Se há anúncios pendentes de aprovação → alerta a staff
 *  4. Rotação normal com dados reais (anúncios, vendas, ranking)
 */

import { ActivityType } from "discord.js"
import { getStats } from "../utils/database.js"
import { fileLog } from "../utils/fileLogger.js"

// Intervalo entre cada troca de status (ms)
const STATUS_INTERVAL_MS = 20_000

export default function ready(client) {
  fileLog.info({ username: client.user.username }, "Bot logado")

  // Cache leve: não busca o banco a cada tick se não mudou nada
  let lastStats = null
  let lastFetch = 0
  const CACHE_TTL = 15_000 // 15s

  function fetchStats() {
    const now = Date.now()
    if (!lastStats || now - lastFetch > CACHE_TTL) {
      try {
        lastStats = getStats()
        lastFetch = now
      } catch {
        // banco pode estar inicializando — retorna último cache
      }
    }
    return lastStats ?? {}
  }

  // Pool de status — cada entrada recebe os stats frescos e retorna
  // { name, type } ou null (null = pular essa entrada nesta rodada)
  const statusPool = [
    // ── Prioridade alta: situações que precisam de atenção ──────────────
    (s) => s.openTickets > 0
      ? { name: `${s.openTickets} ticket${s.openTickets > 1 ? "s" : ""} aberto${s.openTickets > 1 ? "s" : ""}`, type: ActivityType.Watching }
      : null,

    (s) => s.pendingAnnouncements > 0
      ? { name: `${s.pendingAnnouncements} anúncio${s.pendingAnnouncements > 1 ? "s" : ""} aguardando aprovação`, type: ActivityType.Watching }
      : null,

    (s) => s.totalNegotiations - s.completedNegotiations > 0
      ? { name: `${s.totalNegotiations - s.completedNegotiations} negociação${(s.totalNegotiations - s.completedNegotiations) > 1 ? "ões" : ""} ativa${(s.totalNegotiations - s.completedNegotiations) > 1 ? "s" : ""}`, type: ActivityType.Watching }
      : null,

    // ── Informativas: dados reais do servidor ───────────────────────────
    (s) => ({
      name: `${s.activeAnnouncements} conta${s.activeAnnouncements !== 1 ? "s" : ""} à venda`,
      type: ActivityType.Watching,
    }),

    (s) => s.soldAnnouncements > 0
      ? { name: `${s.soldAnnouncements} venda${s.soldAnnouncements !== 1 ? "s" : ""} concluída${s.soldAnnouncements !== 1 ? "s" : ""}`, type: ActivityType.Watching }
      : null,

    (s) => s.activeAlerts > 0
      ? { name: `${s.activeAlerts} alerta${s.activeAlerts !== 1 ? "s" : ""} de interesse ativo${s.activeAlerts !== 1 ? "s" : ""}`, type: ActivityType.Watching }
      : null,

    // ── Fixas: branding ─────────────────────────────────────────────────
    () => ({ name: "Protegendo o servidor", type: ActivityType.Playing }),
    () => ({ name: "Use /ajuda para começar", type: ActivityType.Watching }),
  ]

  let poolIndex = 0

  function updateStatus() {
    try {
      const stats = fetchStats()
      let attempts = 0

      // Avança até encontrar uma entrada não-nula (máx: tamanho do pool)
      while (attempts < statusPool.length) {
        const fn = statusPool[poolIndex % statusPool.length]
        poolIndex++
        attempts++

        const result = fn(stats)
        if (result) {
          client.user.setActivity(result.name, { type: result.type })
          return
        }
      }

      // Fallback absoluto
      client.user.setActivity(`${stats.activeAnnouncements ?? 0} contas à venda`, { type: ActivityType.Watching })
    } catch (err) {
      fileLog.error({ err: err.message }, "[STATUS] Erro ao atualizar status")
    }
  }

  // Disparar imediatamente e depois em intervalo fixo
  updateStatus()
  const statusInterval = setInterval(updateStatus, STATUS_INTERVAL_MS)

  client._statusInterval = statusInterval
  fileLog.info("[STATUS] Status dinâmico iniciado")
}
