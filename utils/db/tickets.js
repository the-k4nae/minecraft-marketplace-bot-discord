/** utils/db/tickets.js — Tickets e controle de inatividade */

import { S } from "./core.js"

// ── Tickets ──────────────────────────────────────────────────────────────────

export function createTicket(channelId, userId, type) {
  const r = S.createTicket.run(channelId, userId, type)
  return { lastInsertRowid: r.lastInsertRowid }
}

export function getTicket(channelId) {
  return S.getTicket.get(channelId) ?? null
}

export function getTicketById(id) {
  return S.getTicketById.get(id) ?? null
}

export function getUserOpenTickets(userId, type) {
  return S.getUserOpenTickets.all(userId, type)
}

export function getAllUserOpenTickets(userId) {
  return S.getAllUserOpenTickets.all(userId)
}

export function closeTicket(channelId) {
  S.closeTicket.run(channelId)
  return getTicket(channelId)
}

export function updateTicketClaimed(channelId, staffId) {
  S.updateTicketClaimed.run(staffId, channelId)
  return getTicket(channelId)
}

export function saveTicketVoiceChannel(channelId, voiceChannelId) {
  S.saveTicketVoice.run(voiceChannelId, channelId)
}

// ── Inatividade ───────────────────────────────────────────────────────────────

export function updateChannelActivity(channelId) {
  S.updateChannelActivity.run(channelId)
}

export function getInactiveTicketChannels(hoursThreshold = 48) {
  return S.getInactiveChannels.all(hoursThreshold)
}

export function markInactivityWarned(channelId) {
  S.markInactivityWarned.run(channelId)
}

export function getChannelsToAutoClose(hoursAfterWarning = 24) {
  return S.getChannelsToAutoClose.all(hoursAfterWarning)
}
