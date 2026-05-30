/**
 * utils/scheduler.js — v5
 *
 * Melhoria v5: prevenção de sobreposição de tarefas (task overlap prevention).
 *
 * Problema original: se uma tarefa (ex: checkExpirations) demorar mais que seu
 * intervalo de agendamento, uma nova instância dela inicia antes da anterior
 * terminar — causando queries duplicadas, DMs duplicadas e condições de corrida.
 *
 * Solução: wrapper `runExclusive(name, fn)` mantém um Set de tarefas em execução.
 * Se uma tarefa do mesmo nome já está rodando, a nova invocação é ignorada com log.
 */

import cron from "node-cron"
import {
  getExpiredAnnouncements, markAnnouncementExpired,
  getSoonExpiringAnnouncements, markExpirationNotified,
  getAutoBumpsDue, recordAutoBump, bumpAnnouncement, getAnnouncement,
  getUserAverageRating, getExpiredReservations, cancelReservation,
  getWeeklyStats, saveWeeklyReport, purgeOldLogs, purgeOldAnnouncements, addLog,
  getInactiveTicketChannels, markInactivityWarned,
  getChannelsToAutoClose, closeTicket, getStuckNegotiations, cancelNegotiation,
  purgeExpiredCooldowns, purgeExpiredTempData,
  disableAutoBump, updateAnnouncement, deleteFavoritesByAnnouncement,
  getExpiredMiddlemanRequests, setMiddlemanResolution,
} from "./database.js"
import {
  CV2, container, text, COLORS, formatValor, buildPublicAnnouncement,
} from "./components.js"
import { logAction, sendLogEmbed } from "./logger.js"
import { fileLog } from "./fileLogger.js"
import { generateTranscript as genTranscript, sendTranscriptToLogs } from "./transcript.js"
import { notifyFavoritersOnBump } from "../handlers/favoritosHandler.js"
import { checkNegotiationTimeouts } from "./negotiationTimeout.js"

// ─── Task exclusion lock ─────────────────────────────────────────────────────

const _running = new Set()

/**
 * Executa uma tarefa de forma exclusiva: se já estiver rodando, pula e loga.
 * @param {string} name — Nome único da tarefa
 * @param {Function} fn — Função assíncrona
 */
async function runExclusive(name, fn) {
  if (_running.has(name)) {
    fileLog.warn({ task: name }, "[SCHEDULER] Tarefa ainda em execução — pulando")
    return
  }
  _running.add(name)
  const start = Date.now()
  try {
    await fn()
  } catch (err) {
    fileLog.error({ task: name, err: err.message }, "[SCHEDULER] Erro na tarefa")
  } finally {
    _running.delete(name)
    const elapsed = Date.now() - start
    if (elapsed > 5_000) {
      fileLog.warn({ task: name, elapsed }, "[SCHEDULER] Tarefa demorou muito")
    }
  }
}

// ─────────────────────────────────────────────
// EXPIRAÇÃO DE ANÚNCIOS — a cada hora
// ─────────────────────────────────────────────

async function checkExpirations(client) {
  const config = client.config
  const expirationDays = config.limits?.announcementExpirationDays ?? 30

  const expired = getExpiredAnnouncements(expirationDays)
  for (const announcement of expired) {
    markAnnouncementExpired(announcement.id)
    try { deleteFavoritesByAnnouncement(announcement.id) } catch { /* ok */ }
    addLog("announcement_expired", "system", String(announcement.id), `${announcement.nick} expirado após ${expirationDays} dias`)

    try {
      const ch  = await client.channels.fetch(config.channels.anuncios)
      const msg = await ch.messages.fetch(announcement.message_id).catch(() => null)
      if (msg) await msg.delete()
    } catch { /* ok */ }

    try {
      const seller = await client.users.fetch(announcement.user_id)
      const ec = container(COLORS.DANGER)
        .addTextDisplayComponents(text(
          `## ⌛ Anúncio Expirado\nSeu anúncio **${announcement.nick}** expirou após **${expirationDays} dias**.\nCrie um novo anúncio pelo painel de tickets.\n\n**Conta:** ${announcement.nick}  ·  **Valor:** R$ ${formatValor(announcement.valor)}\n-# Use o painel de tickets para reanunciar`
        ))
      await seller.send({ components: [ec] })
    } catch { /* DM fechada */ }
  }
  if (expired.length) fileLog.info({ count: expired.length }, "[SCHEDULER] Anúncios expirados")

  // Aviso 3 dias antes
  const soonExpiring = getSoonExpiringAnnouncements(expirationDays, 3)
  for (const announcement of soonExpiring) {
    try {
      markExpirationNotified(announcement.id)
      const seller = await client.users.fetch(announcement.user_id)
      const wc = container(COLORS.WARNING)
        .addTextDisplayComponents(text(
          `## ⚠️ Anúncio Expirando em Breve\nSeu anúncio **${announcement.nick}** vai expirar em aproximadamente **3 dias**.\nFaça um bump para renovar por mais ${expirationDays} dias.`
        ))
      await seller.send({ components: [wc] })
    } catch { /* DM fechada */ }
  }
}

// ─────────────────────────────────────────────
// AUTO BUMP — a cada 30 minutos
// ─────────────────────────────────────────────

async function processAutoBumps(client) {
  const config = client.config
  const autoBumps = getAutoBumpsDue()

  for (const autoBump of autoBumps) {
    try {
      const announcement = getAnnouncement(autoBump.announcement_id)
      if (!announcement || announcement.status !== "approved") {
        disableAutoBump(autoBump.announcement_id)
        continue
      }

      recordAutoBump(autoBump.announcement_id)

      const ch = await client.channels.fetch(config.channels.anuncios).catch(() => null)
      if (!ch) continue

      const oldMsg = announcement.message_id
        ? await ch.messages.fetch(announcement.message_id).catch(() => null)
        : null
      if (oldMsg) await oldMsg.delete().catch(() => {})

      const rating    = getUserAverageRating(announcement.user_id)
      const seller    = await client.users.fetch(announcement.user_id).catch(() => ({ username: announcement.nick }))
      const pub       = buildPublicAnnouncement(announcement, seller, rating)
      const newMsg    = await ch.send(pub)

      updateAnnouncement(announcement.id, { message_id: newMsg.id })
      await notifyFavoritersOnBump(client, announcement.id, announcement)
    } catch (err) {
      fileLog.error({ announcementId: announcement?.id, err: err.message }, "[SCHEDULER] Erro no auto-bump")
    }
  }
  if (autoBumps.length) fileLog.info({ count: autoBumps.length }, "[SCHEDULER] Auto-bump concluído")
}

// ─────────────────────────────────────────────
// RESERVAS EXPIRADAS — a cada 5 minutos
// ─────────────────────────────────────────────

async function checkReservations(client) {
  const expired = getExpiredReservations()
  for (const res of expired) {
    cancelReservation(res.id)
    addLog("reservation_expired", "system", String(res.id), `Reserva do anúncio #${res.announcement_id} expirou`)

    try {
      const buyer = await client.users.fetch(res.buyer_id)
      const rc = container(COLORS.DANGER)
        .addTextDisplayComponents(text(
          `## ⌛ Reserva Expirada\nA reserva do anúncio **#${res.announcement_id}** expirou. O anúncio está disponível novamente.`
        ))
      await buyer.send({ components: [rc] })
    } catch { /* DM fechada */ }
  }
}

// ─────────────────────────────────────────────
// MIDDLEMAN EXPIRADO — a cada 5 minutos
// ─────────────────────────────────────────────

async function expireMiddlemanRequests(client) {
  const timeoutMinutes = client.config.limits?.middlemanTimeoutMinutes ?? 15
  const expired = getExpiredMiddlemanRequests(timeoutMinutes)

  for (const neg of expired) {
    setMiddlemanResolution(neg.ticket_channel_id, null, "expired", "Tempo de resposta da staff esgotado")
    addLog("middleman_expired", "system", String(neg.id), "Solicitação de middleman expirou")

    try {
      const ch = await client.channels.fetch(neg.ticket_channel_id).catch(() => null)
      if (ch) {
        const mc = container(COLORS.DANGER)
          .addTextDisplayComponents(text(
            `## ⌛ Middleman Expirado\nA solicitação de intermediário não foi atendida pela staff dentro do prazo. Prossiga a negociação normalmente ou abra um ticket de suporte.`
          ))
        await ch.send({ flags: CV2, components: [mc] })
      }
    } catch { /* ok */ }
  }
}

// ─────────────────────────────────────────────
// INATIVIDADE DE TICKETS — a cada 30 minutos
// ─────────────────────────────────────────────

async function checkInactiveTickets(client) {
  const config = client.config
  const inactiveHours  = config.limits?.ticketInactivityHours  ?? 48
  const autoCloseHours = config.limits?.ticketAutoCloseHours   ?? 24

  // Aviso de inatividade
  const inactiveChannels = getInactiveTicketChannels(inactiveHours)
  for (const row of inactiveChannels) {
    try {
      const ch = await client.channels.fetch(row.channel_id).catch(() => null)
      if (!ch) continue

      markInactivityWarned(row.channel_id)
      const ic = container(COLORS.WARNING)
        .addTextDisplayComponents(text(
          `## ⚠️ Ticket Inativo\n<@${row.user_id}> Este ticket está inativo há mais de **${inactiveHours}h**.\nSe não houver resposta em **${autoCloseHours}h**, será fechado automaticamente.`
        ))
      await ch.send({ flags: CV2, components: [ic] })
    } catch { /* ok */ }
  }

  // Auto-close após aviso
  const toClose = getChannelsToAutoClose(autoCloseHours)
  for (const row of toClose) {
    try {
      const ch = await client.channels.fetch(row.channel_id).catch(() => null)
      if (!ch) continue

      closeTicket(row.channel_id)
      const transcript = await genTranscript(ch)
      const cc = container(COLORS.DANGER)
        .addTextDisplayComponents(text(
          `## 🔒 Ticket Fechado por Inatividade\nEste ticket foi fechado automaticamente por inatividade.`
        ))
      await ch.send({ flags: CV2, components: [cc] })

      await sendTranscriptToLogs(client, ch, transcript, "auto-fechamento por inatividade")
      await ch.delete().catch(() => {})
    } catch (err) {
      fileLog.error({ channelId: row.channel_id, err: err.message }, "[SCHEDULER] Erro ao fechar ticket inativo")
    }
  }

  if (inactiveChannels.length || toClose.length) {
    fileLog.info({ warned: inactiveChannels.length, closed: toClose.length }, "[SCHEDULER] Inatividade de tickets processada")
  }
}

// ─────────────────────────────────────────────
// RELATÓRIO SEMANAL — domingo 9h
// ─────────────────────────────────────────────

async function sendWeeklyReport(client) {
  const config = client.config
  const stats = getWeeklyStats()
  saveWeeklyReport(stats)

  const fields = [
    { name: "🎫 Tickets",       value: `Novos: ${stats.newTickets} | Fechados: ${stats.closedTickets}`, inline: false },
    { name: "📢 Anúncios",      value: `Novos: ${stats.newAnnouncements} | Aprovados: ${stats.approvedAds} | Vendidos: ${stats.soldCount}`, inline: false },
    { name: "💰 Volume",        value: `R$ ${stats.totalRevenue}`, inline: true },
    { name: "🤝 Negociações",   value: `${stats.newNegotiations} (${stats.completedNegs} concluídas)`, inline: true },
    { name: "⭐ Avaliação",     value: `${stats.avgRating} ★ (${stats.newRatings} avaliações)`, inline: true },
  ]

  if (stats.topSeller) {
    fields.push({ name: "🏆 Top Vendedor", value: `<@${stats.topSeller[0]}> — ${stats.topSeller[1]} venda(s)`, inline: false })
  }

  await sendLogEmbed(client, {
    title:  "Relatório Semanal",
    fields,
    color:  "#5865F2",
  }).catch(() => {})

  // DM para admins configurados
  const adminIds = Array.isArray(config.admins) ? config.admins : []
  if (!adminIds.length) return

  const reportText =
    `## 📊 Relatório Semanal — ${new Date().toLocaleDateString("pt-BR")}\n` +
    `🎫 **Tickets:** ${stats.newTickets} novos · ${stats.closedTickets} fechados\n` +
    `📢 **Anúncios:** ${stats.newAnnouncements} novos · ${stats.approvedAds} aprovados · ${stats.soldCount} vendidos\n` +
    `💰 **Volume:** R$ ${stats.totalRevenue}\n` +
    `🤝 **Negociações:** ${stats.newNegotiations} abertas · ${stats.completedNegs} concluídas\n` +
    `⭐ **Avaliação média:** ${stats.avgRating} \u2605 (${stats.newRatings} avaliações)` +
    (stats.topSeller ? `\n🏆 **Top vendedor:** <@${stats.topSeller[0]}> — ${stats.topSeller[1]} venda(s)` : "")

  for (const adminId of adminIds) {
    try {
      const admin = await client.users.fetch(adminId)
      await admin.send({
        flags: CV2,
        components: [
          container(0x5865F2).addTextDisplayComponents(text(reportText))
        ],
      })
    } catch { /* DM fechada ou admin não encontrado */ }
  }
}

// ─────────────────────────────────────────────
// MANUTENÇÃO DIÁRIA — 2h
// ─────────────────────────────────────────────

async function dailyMaintenance() {
  purgeOldLogs(90)
  purgeExpiredCooldowns()
  purgeExpiredTempData()
  const purgeDays = 90
  const purgedAnns = purgeOldAnnouncements(purgeDays)
  if (purgedAnns > 0) fileLog.info({ count: purgedAnns, days: purgeDays }, "[SCHEDULER] Anúncios antigos removidos")
  fileLog.info("[SCHEDULER] Manutenção diária concluída")
}

// ─────────────────────────────────────────────
// NEGOCIAÇÕES TRAVADAS — 3h
// ─────────────────────────────────────────────

async function cleanStuckNegotiations(client) {
  const stuck = getStuckNegotiations()
  for (const neg of stuck) {
    cancelNegotiation(neg.ticket_channel_id)
    addLog("negotiation_stuck_cancelled", "system", String(neg.id), "Cancelada por travamento (sem atividade)")
  }
  if (stuck.length) fileLog.info({ count: stuck.length }, "[SCHEDULER] Negociações travadas canceladas")
}

// ─────────────────────────────────────────────
// REGISTRO DE TAREFAS
// ─────────────────────────────────────────────

export function startSchedulers(client) {
  // Expiração de anúncios — a cada hora (minuto 0)
  cron.schedule("0 * * * *", () =>
    runExclusive("checkExpirations", () => checkExpirations(client)), { timezone: "America/Sao_Paulo" })

  // Auto bump — a cada 30 minutos
  cron.schedule("*/30 * * * *", () =>
    runExclusive("processAutoBumps", () => processAutoBumps(client)), { timezone: "America/Sao_Paulo" })

  // Reservas expiradas — a cada 5 minutos
  cron.schedule("*/5 * * * *", () =>
    runExclusive("checkReservations", () => checkReservations(client)), { timezone: "America/Sao_Paulo" })

  // Middleman expirado — a cada 5 minutos
  cron.schedule("*/5 * * * *", () =>
    runExclusive("expireMiddlemanRequests", () => expireMiddlemanRequests(client)), { timezone: "America/Sao_Paulo" })

  // Inatividade de tickets — a cada 30 minutos (minuto 30)
  cron.schedule("30 * * * *", () =>
    runExclusive("checkInactiveTickets", () => checkInactiveTickets(client)), { timezone: "America/Sao_Paulo" })

  // Relatório semanal — domingo 9h
  cron.schedule("0 9 * * 0", () =>
    runExclusive("sendWeeklyReport", () => sendWeeklyReport(client)), { timezone: "America/Sao_Paulo" })

  // Manutenção — 2h da manhã
  cron.schedule("0 2 * * *", () =>
    runExclusive("dailyMaintenance", dailyMaintenance), { timezone: "America/Sao_Paulo" })

  // Negociações travadas — 3h da manhã
  cron.schedule("0 3 * * *", () =>
    runExclusive("cleanStuckNegotiations", () => cleanStuckNegotiations(client)), { timezone: "America/Sao_Paulo" })

    // Timeout de compradores inativos — a cada 30min (minutos 15 e 45, intercalado com outros jobs)
    cron.schedule("15,45 * * * *", () =>
      runExclusive("checkNegotiationTimeouts", () => checkNegotiationTimeouts(client)), { timezone: "America/Sao_Paulo" })

  fileLog.info("[SCHEDULER] Tarefas agendadas com proteção anti-sobreposição.")
}
