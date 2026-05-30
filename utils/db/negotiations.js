/** utils/db/negotiations.js — Negociações, escrow, middleman, ofertas, reservas e comprovantes */

import { getDb, S, rowToNegotiation } from "./core.js"
import { getAnnouncement } from "./announcements.js"

// ── Negociações ───────────────────────────────────────────────────────────────

export function createNegotiation(announcementId, buyerId, sellerId, ticketChannelId) {
  const r = S.createNeg.run(announcementId, buyerId, sellerId, ticketChannelId)
  return { lastInsertRowid: r.lastInsertRowid }
}

export function getNegotiationByChannel(channelId) {
  return rowToNegotiation(S.getNegByChannel.get(channelId))
}

export function getNegotiationById(id) {
  return rowToNegotiation(S.getNegById.get(id))
}

export function completeNegotiation(channelId) {
  S.completeNeg.run(channelId)
  return getNegotiationByChannel(channelId)
}

export function cancelNegotiation(channelId) {
  S.cancelNeg.run(channelId)
  return getNegotiationByChannel(channelId)
}

export function getUserActiveNegotiations(userId) {
  return S.getUserActiveNegs.all(userId, userId).map(rowToNegotiation)
}

export function getUserPurchaseHistory(userId) {
  const negs = S.getPurchaseHistory.all(userId).map(rowToNegotiation)
  return negs.map(n => ({ negotiation: n, announcement: getAnnouncement(n.announcement_id) }))
}

export function getUserNegotiationStats(userId) {
  const b = S.negStatsBuyer.all(userId)
  const s = S.negStatsSeller.all(userId)
  const toMap = rows => Object.fromEntries(rows.map(r => [r.status, r.cnt]))
  const bm = toMap(b); const sm = toMap(s)
  return {
    totalAsBuyer:      b.reduce((a, r) => a + r.cnt, 0),
    completedAsBuyer:  bm.completed ?? 0,
    cancelledAsBuyer:  bm.cancelled ?? 0,
    totalAsSeller:     s.reduce((a, r) => a + r.cnt, 0),
    completedAsSeller: sm.completed ?? 0,
    cancelledAsSeller: sm.cancelled ?? 0,
  }
}

export function getStuckNegotiations() {
  return S.getStuckNegs.all()
}

export function updateNegotiationActivity(channelId) {
  S.updateNegActivity.run(channelId)
}

// ── Timeout de comprador ──────────────────────────────────────────────────────

export function updateBuyerActivity(negotiationId) {
  S.updateBuyerActivity.run(negotiationId)
}

export function getInactiveNegotiations(hours) {
  return S.getInactiveNegsForTimeout.all(hours).map(rowToNegotiation)
}

export function getNegotiationsNearTimeout(warnHours, timeoutHours) {
  return S.getNegsNearTimeout.all(warnHours, timeoutHours).map(rowToNegotiation)
}

export function markNegotiationTimeoutWarned(id) {
  S.markNegTimeoutWarned.run(id)
}

// ── Escrow ────────────────────────────────────────────────────────────────────

export function setEscrowStatus(channelId, party, confirmed) {
  const col   = party === "seller" ? "escrow_seller_confirmed"    : "escrow_buyer_confirmed"
  const atCol = party === "seller" ? "escrow_seller_confirmed_at" : "escrow_buyer_confirmed_at"
  getDb().prepare(`UPDATE negotiations SET ${col} = ?, ${atCol} = datetime('now') WHERE ticket_channel_id = ?`)
    .run(confirmed ? 1 : 0, channelId)
  return getNegotiationByChannel(channelId)
}

export function getEscrowStatus(channelId) {
  const n = getNegotiationByChannel(channelId)
  return n ? n.escrow : null
}

export function setEscrowIntermediary(channelId, staffId) {
  S.setEscrowIntermediary.run(staffId, channelId)
  return getNegotiationByChannel(channelId)
}

// ── Middleman ─────────────────────────────────────────────────────────────────

export function getMiddlemanStatus(channelId) {
  return S.getMiddlemanStatus.get(channelId) ?? null
}

export function setMiddlemanRequested(channelId, requestedBy) {
  S.setMiddlemanRequested.run(requestedBy, channelId)
}

export function setMiddlemanActive(channelId, staffId) {
  S.setMiddlemanActive.run(staffId, channelId)
}

export function setMiddlemanResolution(channelId, _staffId, status, resolution = null) {
  S.setMiddlemanResolution.run(status, resolution, channelId)
}

export function getExpiredMiddlemanRequests(timeoutMinutes = 15) {
  return S.getExpiredMmRequests.all(timeoutMinutes)
}

// ── Comprovantes ──────────────────────────────────────────────────────────────

export function addPaymentProof(negotiationId, userId, url, filename = null) {
  const r = S.addProof.run(negotiationId, userId, url, filename)
  return { id: r.lastInsertRowid, negotiation_id: negotiationId, user_id: userId, url, filename }
}

export function getPaymentProofs(negotiationId) {
  return S.getProofs.all(negotiationId)
}

// ── Ofertas ───────────────────────────────────────────────────────────────────

export function createOffer(negotiationId, fromUserId, toUserId, value, message = null) {
  const r = S.createOffer.run(negotiationId, fromUserId, toUserId, value, message)
  return { id: r.lastInsertRowid, negotiation_id: negotiationId, from_user_id: fromUserId, to_user_id: toUserId, value, message, status: "pending" }
}

export function getOffersByNegotiation(negotiationId) {
  return S.getOffersByNeg.all(negotiationId)
}

export function getLastPendingOffer(negotiationId) {
  return S.getLastPendingOffer.get(negotiationId) ?? null
}

export function respondOffer(offerId, status) {
  S.respondOffer.run(status, offerId)
  return S.getOfferById.get(offerId)
}

export function getOfferById(offerId) {
  return S.getOfferById.get(offerId) ?? null
}

// ── Reservas ──────────────────────────────────────────────────────────────────

export function createReservation(announcementId, sellerId, buyerId, durationHours = 24) {
  cancelReservationByAnnouncement(announcementId)
  const expiresAt = new Date(Date.now() + durationHours * 3_600_000).toISOString()
  const r = S.createReservation.run(announcementId, sellerId, buyerId, expiresAt)
  return { id: r.lastInsertRowid, announcement_id: announcementId, seller_id: sellerId, buyer_id: buyerId, status: "active", expires_at: expiresAt }
}

export function getActiveReservation(announcementId) {
  return S.getActiveReservation.get(announcementId) ?? null
}

export function cancelReservationByAnnouncement(announcementId) {
  S.cancelResByAnn.run(announcementId)
}

export function cancelReservation(reservationId) {
  S.cancelResById.run(reservationId)
}

export function getExpiredReservations() {
  return S.getExpiredRes.all()
}
