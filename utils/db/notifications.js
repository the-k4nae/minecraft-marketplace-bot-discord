/** utils/db/notifications.js — Notificações de novos anúncios por DM */

import { S } from "./core.js"

/**
 * Retorna se o usuário tem notificações ativadas.
 * Padrão: false (opt-in).
 */
export function isNotificationEnabled(userId) {
  const row = S.getNotification.get(userId)
  return row ? row.enabled === 1 : false
}

/**
 * Ativa ou desativa notificações para o usuário.
 */
export function setNotification(userId, enabled) {
  S.upsertNotification.run(userId, enabled ? 1 : 0, enabled ? 1 : 0)
}

/**
 * Retorna todos os user_ids com notificações ativas.
 */
export function getAllNotificationSubscribers() {
  return S.getAllNotifSubscribers.all().map(r => r.user_id)
}
