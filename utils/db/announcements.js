/** utils/db/announcements.js — Anúncios e histórico de preços */

import { getDb, S, rowToAnnouncement, parseValor } from "./core.js"

export function createAnnouncement(data) {
  const r = S.createAnnouncement.run(
    data.ticketId ?? null, data.userId, data.nick, data.uuid ?? null,
    data.bans ?? null, data.capas ?? null, data.vips ?? null,
    data.tags ?? null, data.medalhas ?? null, data.winsLevel ?? null,
    data.cosmeticos ?? null, parseValor(data.valor),
  )
  return { lastInsertRowid: r.lastInsertRowid }
}

export function getAnnouncement(id) {
  return rowToAnnouncement(S.getAnnouncement.get(id))
}

export function getPendingAnnouncements() {
  return S.getPendingAnns.all().map(rowToAnnouncement)
}

export function getUserActiveAnnouncements(userId) {
  return S.getUserActiveAnns.all(userId).map(rowToAnnouncement)
}

export function getUserAllAnnouncements(userId) {
  return S.getUserAllAnns.all(userId).map(rowToAnnouncement)
}

export function getAllAnnouncements() {
  return S.getAllAnns.all().map(rowToAnnouncement)
}

export function getAnnouncementsPaginated(page = 0, pageSize = 12) {
  const offset = page * pageSize
  const rows   = S.getAnnsPaged.all(pageSize, offset).map(rowToAnnouncement)
  const total  = S.countAnns.get().c
  return { rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export function getAnnouncementsByStatus(status) {
  return S.getAnnsByStatus.all(status).map(rowToAnnouncement)
}

export function approveAnnouncement(id, messageId, approvedBy) {
  const result = S.approveAnn.run(messageId, approvedBy, id)
  return result.changes > 0  // false = outro processo já aprovou
}

export function rejectAnnouncement(id, rejectedBy, reason = null) {
  const result = S.rejectAnn.run(rejectedBy, reason, id)
  return result.changes > 0  // false = outro processo já processou este anúncio
}

export function markAnnouncementSold(id) {
  S.markSold.run(id)
  return getAnnouncement(id)
}

export function markAnnouncementExpired(id) {
  S.markExpired.run(id)
}

export function deleteAnnouncement(id) {
  return S.deleteAnn.run(id).changes > 0
}

export function bumpAnnouncement(id) {
  S.bumpAnn.run(id)
}

export function getExpiredAnnouncements(expirationDays) {
  return S.getExpiredAnns.all(expirationDays).map(rowToAnnouncement)
}

export function getSoonExpiringAnnouncements(expirationDays, warningDays = 3) {
  return S.getSoonExpiringAnns.all(expirationDays - warningDays, expirationDays).map(rowToAnnouncement)
}

export function markExpirationNotified(id) {
  S.markExpirationNotified.run(id)
}

export function getNickPriceHistory(nick) {
  return S.getNickPriceHistory.all(nick)
}

export function updateAnnouncement(id, fields) {
  const allowed = ["valor", "bans", "capas", "vips", "tags", "medalhas", "wins_level", "cosmeticos", "message_id", "status"]
  const entries = Object.entries(fields).filter(([k]) => allowed.includes(k))
  if (!entries.length) return getAnnouncement(id)
  const normalized = entries.map(([k, v]) => [k, k === "valor" ? parseValor(v) : v])
  const set  = normalized.map(([k]) => `${k} = ?`).join(", ")
  const vals = normalized.map(([, v]) => v)
  getDb().prepare(`UPDATE announcements SET ${set} WHERE id = ?`).run(...vals, id)
  return getAnnouncement(id)
}

export function updateAnnouncementPhoto(id, photoUrl) {
  S.updateAnnPhoto.run(photoUrl, id)
}

export function getAnnouncementsByUUID(uuid) {
  return S.getAnnsByUUID.all(uuid).map(rowToAnnouncement)
}

/** Retorna TODOS os anúncios com este UUID nos últimos 90 dias (inclui rejeitados/expirados/deletados via soft-delete).
 *  Usado pela detecção de scam para identificar contas que já foram anunciadas por outros,
 *  mesmo que o anúncio anterior tenha sido rejeitado, expirado ou removido. */
export function getAnnouncementsByUUIDRecent(uuid) {
  return S.getAnnsByUUIDRecent.all(uuid).map(rowToAnnouncement)
}

export function getAnnouncementsByNick(nick) {
  return S.getAnnsByNick.all(nick).map(rowToAnnouncement)
}

export function getDuplicateAccountSellers(uuid) {
  return S.getDupeSellers.all(uuid).map(r => r.user_id)
}

export function searchAnnouncements({ nick, minPrice, maxPrice, tag, capa, status = "approved" } = {}) {
  let sql    = `SELECT * FROM announcements WHERE status = ?`
  const params = [status]
  if (nick)             { sql += ` AND nick LIKE ? COLLATE NOCASE`; params.push(`%${nick}%`) }
  if (minPrice != null) { sql += ` AND valor >= ?`; params.push(parseValor(minPrice)) }
  if (maxPrice != null) { sql += ` AND valor <= ?`; params.push(parseValor(maxPrice)) }
  if (tag)              { sql += ` AND (tags LIKE ? COLLATE NOCASE OR vips LIKE ? COLLATE NOCASE)`; params.push(`%${tag}%`, `%${tag}%`) }
  if (capa)             { sql += ` AND capas LIKE ? COLLATE NOCASE`; params.push(`%${capa}%`) }
  sql += ` ORDER BY created_at DESC`
  return getDb().prepare(sql).all(...params).map(rowToAnnouncement)
}

export function getAnnouncementStats() {
  return S.annStats.get()
}

/**
 * Remove anúncios finalizados (rejected/expired/sold) com mais de daysToKeep dias.
 * Limpa também edit_logs e favorites associados na mesma transação.
 * @param {number} daysToKeep
 * @returns {number} linhas removidas
 */
export function purgeOldAnnouncements(daysToKeep = 90) {
  const db = getDb()
  const cutoff = new Date(Date.now() - daysToKeep * 86_400_000).toISOString().slice(0, 19)
  const deleted = db.transaction(() => {
    db.prepare(`
      DELETE FROM edit_logs
      WHERE announcement_id IN (
        SELECT id FROM announcements
        WHERE status IN ('rejected','expired','sold') AND created_at < ?
      )
    `).run(cutoff)
    db.prepare(`
      DELETE FROM favorites
      WHERE announcement_id IN (
        SELECT id FROM announcements
        WHERE status IN ('rejected','expired','sold') AND created_at < ?
      )
    `).run(cutoff)
    return db.prepare(`
      DELETE FROM announcements
      WHERE status IN ('rejected','expired','sold') AND created_at < ?
    `).run(cutoff).changes
  })()
  return deleted
}

// ── Perfil e Ranking ────────────────────────────────────────────────────────────────────────

export function getUserAnnouncementStats(userId) {
  return S.getUserAnnStats.get(userId) ?? { total: 0, active: 0, sold: 0, totalValue: 0 }
}

export function getLatestUserAnnouncement(userId) {
  return rowToAnnouncement(S.getLatestUserAnn.get(userId))
}

export function getRankingBySales()  { return S.rankingBySales.all() }
export function getRankingByRating() { return S.rankingByRating.all() }
export function getRankingByAnns()   { return S.rankingByAnns.all() }
