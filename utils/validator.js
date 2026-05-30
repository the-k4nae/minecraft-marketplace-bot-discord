/**
 * validator.js — Validações de segurança e inputs
 *
 * Centraliza todas as validações do bot para consistência
 */

import { getDatabase, isBlacklisted, getUserActiveNegotiations, getActiveReservation } from "./database.js"

/**
 * Verifica se usuário está na blacklist
 * @param {string} userId - ID do usuário
 * @returns {boolean}
 */
export function isUserBlacklisted(userId) {
  return isBlacklisted(userId)
}

/**
 * Verifica se anúncio pertence ao usuário
 * @param {Object} announcement - Anúncio
 * @param {string} userId - ID do usuário
 * @returns {boolean}
 */
export function userOwnsAnnouncement(announcement, userId) {
  return announcement && announcement.user_id === userId
}

/**
 * Verifica se usuário é staff
 * @param {Object} member - GuildMember do Discord
 * @param {string} staffRoleId - ID do cargo staff
 * @returns {boolean}
 */
export function isStaff(member, staffRoleId) {
  return member?.roles?.cache?.has(staffRoleId)
}

/**
 * Verifica se usuário tem permissão de administrador
 * @param {Object} member - GuildMember do Discord
 * @returns {boolean}
 */
export function isAdmin(member) {
  return member?.permissions?.has("Administrator")
}

/**
 * Valida valor monetário
 * @param {string} raw - Valor em string
 * @returns {Object} { valid: boolean, value: number|null, error: string|null }
 */
export function validateMoney(raw) {
  if (!raw || raw.trim() === "") {
    return { valid: true, value: null, error: null }
  }

  const s = raw.trim().replace(/\s/g, "")
  if (!s) return { valid: false, value: null, error: "Valor vazio" }

  // Valida formato antes de converter:
  // Aceita: 300 | 1500.50 | 1.500,00 | 200,00
  // Rejeita: 1.2.3 | 1,2,3 | 1.2.3.4
  const BR_FORMAT    = /^\d{1,3}(\.\d{3})+(,\d{0,2})?$/ // 1.500 ou 1.500,00
  const DECIMAL_COMMA = /^\d+(,\d{0,2})?$/               // 200 ou 200,50
  const DECIMAL_DOT   = /^\d+(\.\d{0,2})?$/              // 200 ou 200.50

  const isValid = BR_FORMAT.test(s) || DECIMAL_COMMA.test(s) || DECIMAL_DOT.test(s)
  if (!isValid) {
    return { valid: false, value: null, error: "Formato inválido. Use ex: 300, 1500.50, ou 1.500,00" }
  }

  // Remove formatação e converte
  let num
  if (s.includes(",")) {
    num = parseFloat(s.replace(/\./g, "").replace(",", "."))
  } else {
    num = parseFloat(s)
  }

  if (isNaN(num)) {
    return { valid: false, value: null, error: "Formato inválido. Use ex: 300, 1500.50, ou 1.500,00" }
  }

  if (num <= 0) {
    return { valid: false, value: null, error: "Valor deve ser maior que zero" }
  }

  if (num > 999999) {
    return { valid: false, value: null, error: "Valor não pode exceder 999.999" }
  }

  return { valid: true, value: num.toFixed(2), error: null }
}

/**
 * Valida ID do Discord
 * @param {string} id - ID em string
 * @returns {Object} { valid: boolean, normalizedId: string|null, error: string|null }
 */
export function validateDiscordId(id) {
  if (!id || typeof id !== "string") {
    return { valid: false, normalizedId: null, error: "ID vazio" }
  }

  const normalized = id.replace(/[^0-9]/g, "")
  if (normalized.length < 17 || normalized.length > 20) {
    return { valid: false, normalizedId: null, error: "ID do Discord deve ter 17-20 dígitos" }
  }

  return { valid: true, normalizedId: normalized, error: null }
}

/**
 * Valida duração em horas
 * @param {string|number} hours - Duração
 * @param {number} min - Mínimo
 * @param {number} max - Máximo
 * @returns {Object} { valid: boolean, value: number|null, error: string|null }
 */
export function validateHours(hours, min = 1, max = 72) {
  const num = parseInt(hours)
  if (isNaN(num)) {
    return { valid: false, value: null, error: "Valor inválido" }
  }
  if (num < min || num > max) {
    return { valid: false, value: null, error: `Duração deve ser entre ${min} e ${max} horas` }
  }
  return { valid: true, value: num, error: null }
}

/**
 * Valida texto/nick
 * @param {string} text - Texto
 * @param {number} maxLength - Tamanho máximo
 * @param {boolean} required - É obrigatório?
 * @returns {Object} { valid: boolean, value: string|null, error: string|null }
 */
export function validateText(text, maxLength = 100, required = false) {
  if (!text || text.trim() === "") {
    if (required) {
      return { valid: false, value: null, error: "Campo obrigatório" }
    }
    return { valid: true, value: null, error: null }
  }

  const trimmed = text.trim()
  if (trimmed.length > maxLength) {
    return { valid: false, value: null, error: `Texto não pode exceder ${maxLength} caracteres` }
  }

  return { valid: true, value: trimmed, error: null }
}

/**
 * Verifica se anúncio pode ser editado
 * @param {Object} announcement - Anúncio
 * @returns {Object} { canEdit: boolean, reason: string|null }
 */
export function canEditAnnouncement(announcement) {
  if (!announcement) {
    return { canEdit: false, reason: "Anúncio não encontrado" }
  }
  if (!["approved", "pending"].includes(announcement.status)) {
    return { canEdit: false, reason: "Anúncio não pode ser editado (vendido/expirado/recusado)" }
  }
  return { canEdit: true, reason: null }
}

/**
 * Verifica se anúncio pode ser deletado
 * @param {Object} announcement - Anúncio
 * @returns {Object} { canDelete: boolean, reason: string|null }
 */
export function canDeleteAnnouncement(announcement) {
  if (!announcement) {
    return { canDelete: false, reason: "Anúncio não encontrado" }
  }
  if (announcement.status === "sold") {
    return { canDelete: false, reason: "Não é possível deletar anúncio já vendido" }
  }
  return { canDelete: true, reason: null }
}

/**
 * Verifica se há negociação ativa para o anúncio
 * @param {string} announcementId - ID do anúncio
 * @param {string} userId - ID do usuário
 * @returns {Promise<Object>} { hasActive: boolean, count: number }
 */
export async function checkActiveNegotiations(announcementId, userId) {
  try {
    const activeNegs = getUserActiveNegotiations(userId)
    const hasActive = activeNegs.some(n => n.announcement_id == announcementId)
    return { hasActive, count: activeNegs.length }
  } catch {
    return { hasActive: false, count: 0 }
  }
}

/**
 * Verifica se há reserva ativa
 * @param {string} announcementId - ID do anúncio
 * @returns {Object} { hasReservation: boolean, reservation: Object|null }
 */
export function checkActiveReservation(announcementId) {
  const reservation = getActiveReservation(announcementId)
  return {
    hasReservation: !!reservation,
    reservation,
  }
}

/**
 * Verifica cooldown de bump (24h)
 * @param {Object} announcement - Anúncio
 * @returns {Object} { canBump: boolean, remainingHours: number }
 */
export function canBumpAnnouncement(announcement) {
  const lastBump = announcement.bumped_at || announcement.approved_at || announcement.created_at
  const hoursSince = (Date.now() - new Date(lastBump).getTime()) / (1000 * 60 * 60)
  const remaining = Math.ceil(24 - hoursSince)

  return {
    canBump: hoursSince >= 24,
    remainingHours: remaining > 0 ? remaining : 0,
  }
}

/**
 * Sanitiza string para uso em banco de dados
 * Remove caracteres perigosos e normaliza
 * @param {string} str - String
 * @returns {string}
 */
export function sanitizeString(str) {
  if (!str) return ""
  return str
    .replace(/[<>\"\'\\;]/g, "") // Remove caracteres potencialmente perigosos
    .trim()
    .normalize("NFC")
}

/**
 * Valida URL (básico)
 * @param {string} url - URL
 * @returns {boolean}
 */
export function isValidUrl(url) {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}
