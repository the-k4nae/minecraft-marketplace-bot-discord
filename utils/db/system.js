/** utils/db/system.js — Estatísticas, configuração dinâmica, logs e dados temporários */

import { getDb, S } from "./core.js"
import { fileLog } from "../fileLogger.js"

// ── Logs ──────────────────────────────────────────────────────────────────────

export function addLog(action, userId, targetId = null, details = null) {
  const r = S.addLog.run(action, userId, targetId, details)
  return { lastInsertRowid: r.lastInsertRowid }
}

export function getLogsByAction(action) {
  return S.getLogsByAction.all(action)
}

export function purgeOldLogs(daysToKeep = 90) {
  const r = S.purgeOldLogs.run(daysToKeep)
  if (r.changes > 0) fileLog.info({ changes: r.changes, daysToKeep }, "[DB] Purge: logs removidos")
  return r.changes
}

// ── Edit logs ─────────────────────────────────────────────────────────────────

export function addEditLog(announcementId, userId, changes) {
  const { campo, oldValue, newValue } = changes
  const r = S.addEditLog.run(announcementId, userId, campo, String(oldValue ?? ""), String(newValue ?? ""))
  return { id: r.lastInsertRowid }
}

export function getEditLogs(announcementId) {
  return S.getEditLogs.all(announcementId)
}

// ── Temp modal data ───────────────────────────────────────────────────────────

export function saveTempModalData(data) {
  S.cleanTempModal.run(Date.now() - 3_600_000)
  const id = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  S.insertTempModal.run(id, JSON.stringify(data), Date.now())
  return id
}

export function updateTempModalData(id, data) {
  S.updateTempModal.run(JSON.stringify(data), Date.now(), id)
}

export function getTempModalData(id) {
  const row = S.getTempModal.get(id)
  return row ? JSON.parse(row.data) : null
}

export function deleteTempModalData(id) {
  S.deleteTempModal.run(id)
}

export function purgeExpiredTempData() {
  const r = S.purgeExpiredTempData.run(Date.now() - 3_600_000)
  if (r.changes > 0) fileLog.info({ changes: r.changes }, "[DB] Purge: temp_modal expirados")
  return r.changes
}

// ── Config dinâmica ───────────────────────────────────────────────────────────

export function updateConfig(key, value) {
  S.updateConfig.run(key, String(value), String(value))
}

export function getConfig() {
  const rows = S.getConfigAll.all()
  if (!rows.length) return null
  const result = {}
  for (const { key, value } of rows) {
    const keys = key.split(".")
    let obj = result
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {}
      obj = obj[keys[i]]
    }
    obj[keys[keys.length - 1]] = isNaN(value) ? value : Number(value)
  }
  return result
}

// ── Estatísticas ──────────────────────────────────────────────────────────────

export function getStats() {
  const tickets = S.ticketStats.all()
  const anns    = S.annGroupStats.all()
  const negs    = S.negGroupStats.all()
  const tm  = rows => Object.fromEntries(rows.map(r => [r.status, r.cnt]))
  const tm2 = rows => rows.reduce((s, r) => s + r.cnt, 0)
  const t = tm(tickets); const a = tm(anns); const n = tm(negs)
  return {
    totalTickets:          tm2(tickets),
    openTickets:           t.open       ?? 0,
    closedTickets:         t.closed     ?? 0,
    totalAnnouncements:    tm2(anns),
    activeAnnouncements:   a.approved   ?? 0,
    pendingAnnouncements:  a.pending    ?? 0,
    soldAnnouncements:     a.sold       ?? 0,
    totalNegotiations:     tm2(negs),
    completedNegotiations: n.completed  ?? 0,
    blacklistedUsers:      S.countBlacklist.get().c,
    activeAlerts:          S.countActiveAlerts.get().c,
    activeReservations:    S.countActiveRes.get().c,
    autoBumpsActive:       S.countActiveBumps.get().c,
  }
}

export function getWeeklyStats() {
  const r = getDb().prepare(`
    SELECT
      (SELECT COUNT(*) FROM tickets      WHERE created_at  >= datetime('now','-7 days')) as newTickets,
      (SELECT COUNT(*) FROM tickets      WHERE closed_at   >= datetime('now','-7 days')) as closedTickets,
      (SELECT COUNT(*) FROM announcements WHERE created_at  >= datetime('now','-7 days')) as newAnnouncements,
      (SELECT COUNT(*) FROM announcements WHERE approved_at >= datetime('now','-7 days')) as approvedAds,
      (SELECT COUNT(*) FROM announcements WHERE sold_at     >= datetime('now','-7 days')) as soldCount,
      (SELECT IFNULL(SUM(valor),0) FROM announcements WHERE sold_at >= datetime('now','-7 days')) as totalRevenue,
      (SELECT COUNT(*) FROM negotiations  WHERE created_at  >= datetime('now','-7 days')) as newNegotiations,
      (SELECT COUNT(*) FROM negotiations  WHERE completed_at >= datetime('now','-7 days')) as completedNegs,
      (SELECT COUNT(*) FROM ratings        WHERE created_at  >= datetime('now','-7 days')) as newRatings,
      (SELECT ROUND(AVG(stars),1) FROM ratings WHERE created_at >= datetime('now','-7 days')) as avgRating
  `).get()

  const topRow = getDb().prepare(`
    SELECT a.user_id, COUNT(*) as cnt
    FROM announcements a
    WHERE a.sold_at >= datetime('now','-7 days')
    GROUP BY a.user_id ORDER BY cnt DESC LIMIT 1
  `).get()

  return {
    ...r,
    totalRevenue: (r.totalRevenue ?? 0).toFixed(2),
    avgRating:    r.avgRating ?? "N/A",
    topSeller:    topRow ? [topRow.user_id, topRow.cnt] : null,
  }
}

export function saveWeeklyReport(stats) {
  addLog("weekly_report", "system", null, JSON.stringify(stats))
}
