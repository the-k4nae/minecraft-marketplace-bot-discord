/**
 * minecraftAPI.js — v2
 *
 * FIX #4: Cache em memória de UUIDs com TTL de 1h.
 * Evita requests repetidas à API Mojang (rate limit: ~600/10min por IP).
 * Cache negativo (nick inexistente) dura 5 minutos para evitar spam.
 */

import fetch from "node-fetch"

const uuidCache = new Map()  // nick.toLowerCase() → { uuid, name, expiresAt }
const UUID_TTL       = 60 * 60 * 1000   // 1h para hits
const NEGATIVE_TTL   =  5 * 60 * 1000   // 5min para misses (nick não existe)

/**
 * Busca UUID de um jogador pelo nickname, com cache.
 * @param {string} nickname
 * @returns {Promise<{uuid: string, name: string} | null>}
 */
export async function getPlayerUUID(nickname) {
  const key = nickname.toLowerCase()
  const now = Date.now()

  // Verificar cache
  const cached = uuidCache.get(key)
  if (cached) {
    if (now < cached.expiresAt) {
      if (cached.result === "RATE_LIMITED") return "RATE_LIMITED"
      return cached.result  // null = nick não existe (cache negativo)
    }
    uuidCache.delete(key)
  }

  try {
    const response = await fetch(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(nickname)}`,
      { signal: AbortSignal.timeout(5000) }  // timeout de 5s
    )

    if (response.status === 404) {
      uuidCache.set(key, { result: null, expiresAt: now + NEGATIVE_TTL })
      return null
    }

    if (response.status === 429) {
      // Cache the rate limit for 2 minutes to avoid hammering the API
      uuidCache.set(key, { result: "RATE_LIMITED", expiresAt: now + 2 * 60 * 1000 })
      console.warn("[MOJANG] Rate limit atingido. Cache temporário de 2min aplicado.")
      return "RATE_LIMITED"
    }

    if (!response.ok) {
      console.error("[MOJANG] Erro na API:", response.status)
      return null
    }

    const data = await response.json()
    const result = { uuid: data.id, name: data.name }
    uuidCache.set(key, { result, expiresAt: now + UUID_TTL })
    return result

  } catch (error) {
    if (error.name === "TimeoutError") {
      console.error("[MOJANG] Timeout ao buscar UUID de:", nickname)
    } else {
      console.error("[MOJANG] Erro ao buscar UUID:", error.message)
    }
    return null
  }
}

/**
 * Invalida cache de um nick específico (ex: após editar anúncio).
 */
export function invalidateUUIDCache(nickname) {
  uuidCache.delete(nickname.toLowerCase())
}

/**
 * FIX B-3: Limpa entradas expiradas do cache periodicamente (a cada 30min).
 */
function purgeExpiredUUIDCache() {
  const now = Date.now()
  for (const [key, val] of uuidCache.entries()) {
    if (now >= val.expiresAt) uuidCache.delete(key)
  }
}
setInterval(purgeExpiredUUIDCache, 30 * 60 * 1000)

/**
 * Retorna tamanho atual do cache (para debug/stats).
 */
export function getUUIDCacheSize() {
  return uuidCache.size
}

/**
 * Gera URLs de skin do jogador.
 * Usa mc-heads.net como primária (mais estável) e crafatar como alternativa.
 * O Discord tenta a URL e exibe em branco se o serviço estiver fora.
 * @param {string} identifier - UUID ou nickname
 */
export function getSkinUrls(identifier) {
  // mc-heads.net é mais estável que crafatar para rate limit
  return {
    body:   `https://mc-heads.net/body/${identifier}/100`,
    head:   `https://mc-heads.net/head/${identifier}/100`,
    avatar: `https://mc-heads.net/avatar/${identifier}/100`,
  }
}

export async function validateNickname(nickname) {
  return (await getPlayerUUID(nickname)) !== null
}
