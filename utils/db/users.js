/** utils/db/users.js — Blacklist, avaliações, favoritos, alertas, cooldowns e auto-bump */

import { S, alertRowToObj } from "./core.js"
import { fileLog } from "../fileLogger.js"

// ── Blacklist ─────────────────────────────────────────────────────────────────

export function addToBlacklist(userId, reason, createdBy) {
  S.addBlacklist.run(userId, reason, createdBy, reason, createdBy)
  return getBlacklistEntry(userId)
}

export function removeFromBlacklist(userId) {
  return S.removeBlacklist.run(userId).changes > 0
}

export function getBlacklist() {
  return S.getBlacklist.all()
}

export function isBlacklisted(userId) {
  return !!S.isBlacklisted.get(userId)
}

export function getBlacklistEntry(userId) {
  return S.getBlacklistEntry.get(userId) ?? null
}

// ── Avaliações ────────────────────────────────────────────────────────────────

export function createRating(data) {
  const r = S.createRating.run(data.negotiationId, data.raterId, data.ratedId, data.stars, data.comment ?? null)
  return { id: r.lastInsertRowid, ...data }
}

export function getUserRatings(userId) {
  return S.getUserRatings.all(userId)
}

export function getUserAverageRating(userId) {
  const row = S.getUserAvgRating.get(userId)
  return {
    average: row?.count > 0 ? parseFloat(row.average).toFixed(1) : 0,
    count: row?.count ?? 0,
  }
}

export function hasAlreadyRated(negotiationId, raterId) {
  return !!S.hasRated.get(negotiationId, raterId)
}

// ── Favoritos ─────────────────────────────────────────────────────────────────

export function addFavorite(userId, announcementId) {
  return S.addFavorite.run(userId, announcementId).changes > 0
}

export function removeFavorite(userId, announcementId) {
  return S.removeFavorite.run(userId, announcementId).changes > 0
}

export function isFavorited(userId, announcementId) {
  return !!S.isFavorited.get(userId, announcementId)
}

export function getUserFavorites(userId) {
  return S.getUserFavorites.all(userId)
}

export function getFavoriters(announcementId) {
  return S.getFavoriters.all(announcementId).map(r => r.user_id)
}

export function countFavoriters(announcementId) {
  return S.countFavoriters.get(announcementId).c
}

export function deleteFavoritesByAnnouncement(announcementId) {
  S.deleteFavsByAnn.run(announcementId)
}

// ── Alertas ───────────────────────────────────────────────────────────────────

export function createAlert(userId, filters) {
  const r = S.createAlert.run(userId, filters.nick ?? null, filters.minPrice ?? null, filters.maxPrice ?? null, filters.vip ?? null)
  return { id: r.lastInsertRowid, user_id: userId, filters, active: true }
}

export function getUserAlerts(userId) {
  return S.getUserAlerts.all(userId).map(alertRowToObj)
}

export function deleteAlert(alertId, userId) {
  return S.deleteAlert.run(alertId, userId).changes > 0
}

export function getAllActiveAlerts() {
  return S.getAllActiveAlerts.all().map(alertRowToObj)
}

export function markAlertTriggered(alertId) {
  S.markAlertTriggered.run(alertId)
}

export function matchAlerts(announcement) {
  return S.matchAlerts.all(
    announcement.user_id,
    announcement.nick,
    announcement.valor, announcement.valor,
    announcement.vips ?? "",
    announcement.tags ?? "",
  ).map(alertRowToObj)
}

// ── Auto bump ─────────────────────────────────────────────────────────────────

export function enableAutoBump(announcementId, userId) {
  S.enableAutoBump.run(announcementId, userId)
  return getAutoBumpStatus(announcementId)
}

export function disableAutoBump(announcementId) {
  S.disableAutoBump.run(announcementId)
}

export function getAutoBumpStatus(announcementId) {
  const row = S.getAutoBumpStatus.get(announcementId)
  return row ? { ...row, active: row.active === 1 } : null
}

export function getAutoBumpsDue() {
  return S.getAutoBumpsDue.all().map(r => ({ ...r, active: r.active === 1 }))
}

export function recordAutoBump(announcementId) {
  S.recordAutoBump.run(announcementId)
  S.autoBumpAnn.run(announcementId)
}

// ── Cooldowns ─────────────────────────────────────────────────────────────────

export function checkAndSetCooldown(userId, action, cooldownMs) {
  const key = `${userId}:${action}`
  const now = Date.now()
  const row = S.getCooldown.get(key)
  if (row && row.expires_at > now) {
    return { onCooldown: true, remaining: Math.ceil((row.expires_at - now) / 1000) }
  }
  S.setCooldown.run(key, now + cooldownMs)
  return { onCooldown: false, remaining: 0 }
}

export function clearCooldown(userId, action) {
  S.deleteCooldown.run(`${userId}:${action}`)
}

export function purgeExpiredCooldowns() {
  const r = S.purgeExpiredCooldowns.run(Date.now())
  if (r.changes > 0) fileLog.info({ changes: r.changes }, "[DB] Purge: cooldowns expirados")
  return r.changes
}

// ── Atividade suspeita ────────────────────────────────────────────────────────

export function getAllSuspiciousUsers() {
  const flagMap = new Map()
  const ensureUser = uid => { if (!flagMap.has(uid)) flagMap.set(uid, []); return flagMap.get(uid) }

  for (const r of S.rejectedSuspicious.all())
    ensureUser(r.user_id).push({ type: "many_rejections", count: r.c })

  for (const r of S.sharedUUIDs.all()) {
    const sellers = r.sellers.split(",")
    for (const uid of sellers)
      ensureUser(uid).push({ type: "shared_uuid", uuid: r.uuid, sellers })
  }

  for (const r of S.cancelledNegsSuspicious.all())
    ensureUser(r.user_id).push({ type: "many_cancelled_negotiations", count: r.c })

  return [...flagMap.entries()].map(([uid, flags]) => ({ uid, flags }))
}

export function getUserSuspiciousActivity(userId) {
  const flags = []
  const rejections = S.userRejections.get(userId).c
  if (rejections >= 3) flags.push({ type: "many_rejections", count: rejections })

  const uuids = S.userUUIDs.all(userId).map(r => r.uuid)
  for (const uuid of uuids) {
    const sellers = S.getDupeSellers?.all(uuid).map(r => r.user_id) ?? []
    if (sellers.length > 1) flags.push({ type: "shared_uuid", uuid, sellers })
  }

  const cancelled = S.userCancelled.get(userId, userId).c
  if (cancelled >= 3) flags.push({ type: "many_cancelled_negotiations", count: cancelled })
  return flags
}

// ── Templates de anúncio ───────────────────────────────────────────────────────

export function saveAnnouncementTemplate(userId, data) {
  S.saveTemplate.run(
    userId,
    data.nick       || null,
    data.bans       || null,
    data.capas      || null,
    data.vips       || null,
    data.tags       || null,
    data.medalhas   || null,
    data.winsLevel  || data.wins_level || null,
    data.cosmeticos || null,
    data.valor      ? parseFloat(data.valor) : null
  )
}

export function getAnnouncementTemplate(userId) {
  return S.getTemplate.get(userId) ?? null
}

export function deleteAnnouncementTemplate(userId) {
  S.deleteTemplate.run(userId)
}
