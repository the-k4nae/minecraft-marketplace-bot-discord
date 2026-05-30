/**
 * minecraftAPI.js — v2
 *
 * FIX #4: Cache em memória de UUIDs com TTL de 1h.
 * Evita requests repetidas à API Mojang (rate limit: ~600/10min por IP).
 * Cache negativo (nick inexistente) dura 5 minutos para evitar spam.
 */

import fetch from "node-fetch"
import { fileLog } from "./fileLogger.js"

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
      fileLog.warn("[MOJANG] Rate limit atingido. Cache temporário de 2min aplicado.")
      return "RATE_LIMITED"
    }

    if (!response.ok) {
      fileLog.error({ status: response.status }, "[MOJANG] Erro na API")
      return null
    }

    const data = await response.json()
    const result = { uuid: data.id, name: data.name }
    uuidCache.set(key, { result, expiresAt: now + UUID_TTL })
    return result

  } catch (error) {
    if (error.name === "TimeoutError") {
      fileLog.error({ nickname }, "[MOJANG] Timeout ao buscar UUID")
    } else {
      fileLog.error({ err: error.message }, "[MOJANG] Erro ao buscar UUID")
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
 * Formata UUID sem dashes para o formato com dashes (requerido por algumas APIs).
 * @param {string} id
 */
function formatUUID(id) {
  if (!id || id.includes("-")) return id
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`
}

/**
 * Gera URLs de skin do jogador via Visage (visage.surgeplay.com).
 * Renders 3D isométricos de alta qualidade. Fallback: minotar.net
 * @param {string} identifier - UUID (preferido) ou nickname
 */
export function getSkinUrls(identifier) {
  const id = formatUUID(identifier)
  return {
    // Render completo do corpo (3D isométrico)
    body:   `https://visage.surgeplay.com/full/200/${id}.png`,
    // Render somente da cabeça (3D)
    head:   `https://visage.surgeplay.com/head/150/${id}.png`,
    // Face frontal (2D, mais leve e rápida)
    avatar: `https://visage.surgeplay.com/face/150/${id}.png`,
    // Fallbacks caso Visage esteja fora
    avatarFallback: `https://minotar.net/avatar/${id}/150`,
    bodyFallback:   `https://minotar.net/body/${id}/200`,
  }
}

export async function validateNickname(nickname) {
  return (await getPlayerUUID(nickname)) !== null
}
