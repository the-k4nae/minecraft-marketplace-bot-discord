/**
 * cooldown.js — v2
 *
 * FIX #3: Cooldowns persistidos no SQLite.
 * Antes usava Collection em memória — resetava no restart.
 * Agora cooldowns sobrevivem a restarts, deploys e crashes.
 *
 * Mantém compatibilidade total com a API anterior: checkCooldown(userId, action, ms)
 */

import { checkAndSetCooldown } from "./database.js"

/**
 * Verifica e define cooldown para um usuário/ação.
 * @param {string} userId
 * @param {string} action
 * @param {number} cooldownMs
 * @returns {{ onCooldown: boolean, remaining: number }}
 */
export function checkCooldown(userId, action, cooldownMs = 10000) {
  return checkAndSetCooldown(userId, action, cooldownMs)
}
