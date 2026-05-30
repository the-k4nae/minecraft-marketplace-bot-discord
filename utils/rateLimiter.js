/**
 * utils/rateLimiter.js
 *
 * Rate limiter com janela deslizante (sliding window) em memória.
 *
 * Diferença em relação ao cooldown fixo atual:
 *   - Cooldown fixo: "você pode agir 1x a cada 30s" — penaliza quem age no início da janela
 *   - Sliding window: "máximo N ações nos últimos X segundos" — mais justo e granular
 *
 * Exemplos de uso:
 *   const ok = slidingWindow("user123", "create_ticket", 3, 60_000)
 *   // true = permitido | false = bloqueado (3 tickets em 60s)
 *
 *   const { allowed, remaining, resetIn } = checkLimit("user123", "bump", 2, 86_400_000)
 *   // 2 bumps por 24h, com info de estado
 */

// Map<key, timestamp[]> — cada entrada é uma lista de timestamps de ações
const _windows = new Map()

// Purge automático a cada 10 minutos para evitar memory leak
setInterval(() => {
  const now = Date.now()
  for (const [key, timestamps] of _windows.entries()) {
    // Se a janela mais recente já expirou (precisaria do TTL), removemos a chave
    // Simplificação: remove entradas com mais de 24h sem atividade
    const lastActivity = timestamps[timestamps.length - 1] ?? 0
    if (now - lastActivity > 24 * 60 * 60 * 1000) {
      _windows.delete(key)
    }
  }
}, 10 * 60 * 1000)

/**
 * Verifica e registra uma ação no sliding window.
 *
 * @param {string}  userId    — ID do usuário
 * @param {string}  action    — Nome da ação (ex: "create_announcement")
 * @param {number}  maxCount  — Número máximo de ações na janela
 * @param {number}  windowMs  — Tamanho da janela em ms
 * @returns {{ allowed: boolean, count: number, remaining: number, resetIn: number }}
 */
export function checkLimit(userId, action, maxCount, windowMs) {
  const key = `${userId}:${action}`
  const now = Date.now()
  const cutoff = now - windowMs

  // Busca ou cria a janela e remove timestamps expirados
  const timestamps = (_windows.get(key) ?? []).filter(t => t > cutoff)

  if (timestamps.length >= maxCount) {
    const oldest  = timestamps[0]
    const resetIn = Math.ceil((oldest + windowMs - now) / 1000)
    _windows.set(key, timestamps)
    return { allowed: false, count: timestamps.length, remaining: 0, resetIn }
  }

  timestamps.push(now)
  _windows.set(key, timestamps)
  return { allowed: true, count: timestamps.length, remaining: maxCount - timestamps.length, resetIn: 0 }
}

/**
 * Versão simplificada: retorna true se a ação é permitida, false se está bloqueada.
 */
export function slidingWindow(userId, action, maxCount, windowMs) {
  return checkLimit(userId, action, maxCount, windowMs).allowed
}

/**
 * Reseta o contador de um usuário para uma ação específica.
 * Útil após uma ação ser cancelada ou revertida por staff.
 */
export function resetLimit(userId, action) {
  _windows.delete(`${userId}:${action}`)
}

/**
 * Retorna o estado atual de um limite sem registrar uma nova ação.
 */
export function peekLimit(userId, action, maxCount, windowMs) {
  const key = `${userId}:${action}`
  const now = Date.now()
  const cutoff = now - windowMs
  const timestamps = (_windows.get(key) ?? []).filter(t => t > cutoff)

  if (timestamps.length >= maxCount) {
    const resetIn = Math.ceil((timestamps[0] + windowMs - now) / 1000)
    return { blocked: true, count: timestamps.length, remaining: 0, resetIn }
  }
  return { blocked: false, count: timestamps.length, remaining: maxCount - timestamps.length, resetIn: 0 }
}

/**
 * Limites pré-definidos para ações do bot.
 * Centralizados aqui para fácil ajuste.
 */
export const LIMITS = {
  // Anúncios: 1 criação a cada 30 minutos
  CREATE_ANNOUNCEMENT: { max: 1,  window: 30 * 60 * 1000 },
  // Interesse em anúncio: 5 tentativas por hora (prevenção de spam em vários anúncios)
  INTEREST_GLOBAL:     { max: 5,  window: 60 * 60 * 1000 },
  // Ofertas: 10 por hora
  MAKE_OFFER:          { max: 10, window: 60 * 60 * 1000 },
  // Tickets: 3 por hora
  OPEN_TICKET:         { max: 3,  window: 60 * 60 * 1000 },
  // Bump manual: 1 por 24h (já controlado via DB, mas double-check na camada da API)
  MANUAL_BUMP:         { max: 1,  window: 24 * 60 * 60 * 1000 },
  // Comandos gerais: 20 por minuto (anti-spam de slash commands)
  COMMAND_GENERAL:     { max: 20, window: 60 * 1000 },
}

/**
 * Verifica um limite pré-definido por nome.
 * @param {string} userId
 * @param {keyof LIMITS} limitName
 * @returns {{ allowed: boolean, remaining: number, resetIn: number }}
 */
export function checkNamedLimit(userId, limitName) {
  const def = LIMITS[limitName]
  if (!def) throw new Error(`Limite desconhecido: ${limitName}`)
  const result = checkLimit(userId, limitName.toLowerCase(), def.max, def.window)
  return { allowed: result.allowed, remaining: result.remaining, resetIn: result.resetIn }
}
