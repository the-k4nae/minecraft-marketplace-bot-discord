/**
 * scheduler.js — v4
 *
 * Tarefas agendadas usando node-cron (horários fixos, sobrevive a restarts).
 * Melhorias:
 *  - Cron real em vez de setInterval (fix #6)
 *  - Auto-close de tickets inativos (fix #13)
 *  - Auto-close + aviso via DM para inatividade
 */

import cron from "node-cron"
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js"
import {
  getExpiredAnnouncements, markAnnouncementExpired,
  getSoonExpiringAnnouncements, markExpirationNotified,
  getAutoBumpsDue, recordAutoBump, getAnnouncement,
  getUserAverageRating, getExpiredReservations, cancelReservation,
  getWeeklyStats, saveWeeklyReport, purgeOldLogs, addLog,
  getInactiveTicketChannels, markInactivityWarned,
  getChannelsToAutoClose, closeTicket,
  purgeExpiredCooldowns, purgeExpiredTempData,
  disableAutoBump, updateAnnouncement, deleteFavoritesByAnnouncement,
} from "./database.js"
import { formatValor, buildPublicAnnouncementC2 } from "./embedBuilder.js"
import { generateTranscript as genTranscript, sendTranscriptToLogs } from "./transcript.js"
import { buildFavoriteButton, notifyFavoritersOnBump } from "../handlers/favoritosHandler.js"
import { C2_FLAG } from "./cv2.js"

// ─────────────────────────────────────────────
// EXPIRAÇÃO DE ANÚNCIOS — a cada hora
// ─────────────────────────────────────────────

async function checkExpirations(client) {
  const config = client.config
  const expirationDays = config.limits?.announcementExpirationDays ?? 30

  // Expirar anúncios vencidos
  const expired = getExpiredAnnouncements(expirationDays)
  for (const announcement of expired) {
    markAnnouncementExpired(announcement.id)
    // FIX S-4: Limpar favoritos do anúncio expirado
    try { deleteFavoritesByAnnouncement(announcement.id) } catch { /* ok */ }
    addLog("announcement_expired", "system", String(announcement.id), `${announcement.nick} expirado após ${expirationDays} dias`)

    // Remover do canal de anúncios
    try {
      const ch = await client.channels.fetch(config.channels.anuncios)
      const msg = await ch.messages.fetch(announcement.message_id).catch(() => null)
      if (msg) await msg.delete()
    } catch { /* ok */ }

    // DM ao vendedor
    try {
      const seller = await client.users.fetch(announcement.user_id)
      await seller.send({
        embeds: [new EmbedBuilder()
          .setColor("#FF6B6B")
          .setTitle("⌛ Anúncio Expirado")
          .setDescription(`Seu anúncio da conta **${announcement.nick}** expirou após **${expirationDays} dias**.\nCrie um novo anúncio pelo sistema de tickets se ainda deseja vender.`)
          .addFields(
            { name: "Conta", value: announcement.nick, inline: true },
            { name: "Valor", value: `R$ ${formatValor(announcement.valor)}`, inline: true },
          )
          .setFooter({ text: "Use o painel de tickets para reanunciar" })
          .setTimestamp()],
      })
    } catch { /* DM fechada */ }
  }
  if (expired.length) console.log(`[SCHEDULER] ${expired.length} anúncio(s) expirado(s)`)

  // Aviso 3 dias antes de expirar
  const soonExpiring = getSoonExpiringAnnouncements(expirationDays, 3)
  for (const announcement of soonExpiring) {
    const refDate = announcement.bumped_at || announcement.created_at
    const daysLeft = Math.ceil(expirationDays - ((Date.now() - new Date(refDate).getTime()) / 86_400_000))
    try {
      const seller = await client.users.fetch(announcement.user_id)
      await seller.send({
        embeds: [new EmbedBuilder()
          .setColor("#FFA500")
          .setTitle("⚠️ Anúncio Perto de Expirar")
          .setDescription(`Seu anúncio de **${announcement.nick}** expira em **${daysLeft} dia(s)**!\nFaça um bump no seu anúncio pelo menu **/meusanuncios** para renovar o prazo.`)
          .addFields(
            { name: "Dias Restantes", value: String(daysLeft), inline: true },
            { name: "Valor", value: `R$ ${formatValor(announcement.valor)}`, inline: true },
          )
          .setTimestamp()],
      })
      markExpirationNotified(announcement.id)
    } catch { markExpirationNotified(announcement.id) }
  }
}

// ─────────────────────────────────────────────
// AUTO BUMP — a cada 30 minutos
// ─────────────────────────────────────────────

async function processAutoBumps(client) {
  const due = getAutoBumpsDue()
  if (!due.length) return

  console.log(`[AUTOBUMP] Processando ${due.length} bump(s)...`)
  const config = client.config

  for (const autoBump of due) {
    const announcement = getAnnouncement(autoBump.announcement_id)
    if (!announcement || announcement.status !== "approved") {
      disableAutoBump(autoBump.announcement_id)
      continue
    }

    try {
      const announcementChannel = await client.channels.fetch(config.channels.anuncios)
      try {
        const old = await announcementChannel.messages.fetch(announcement.message_id)
        await old.delete()
      } catch { /* ok */ }

      const seller = await client.users.fetch(announcement.user_id)
      const sellerRating = getUserAverageRating(announcement.user_id)
      const namemc = `https://namemc.com/profile/${announcement.uuid}`

      const bumpContainer = buildPublicAnnouncementC2(announcement, seller, sellerRating)
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`interest_${announcement.id}`).setLabel("Tenho Interesse").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setURL(namemc).setLabel("Ver no NameMC").setStyle(ButtonStyle.Link),
        buildFavoriteButton(announcement.id),
      )

      const newMsg = await announcementChannel.send({ components: [appendRows(bumpContainer, row)], flags: C2_FLAG })
      recordAutoBump(announcement.id)

      // Atualizar message_id no banco
      updateAnnouncement(announcement.id, { message_id: newMsg.id })

      // Notificar favoritadores do bump
      notifyFavoritersOnBump(client, getAnnouncement(announcement.id)).catch(() => {})

      addLog("announcement_bumped", "autobump", String(announcement.id), `Auto-bump: ${announcement.nick}`)
    } catch (err) {
      console.error(`[AUTOBUMP] Erro ao bumpar ${autoBump.announcement_id}:`, err.message)
    }
  }
}

// ─────────────────────────────────────────────
// RESERVAS EXPIRADAS — a cada 5 minutos
// ─────────────────────────────────────────────

async function checkReservations(client) {
  const expired = getExpiredReservations()
  const config = client.config

  for (const reservation of expired) {
    cancelReservation(reservation.id)
    const announcement = getAnnouncement(reservation.announcement_id)
    if (!announcement || announcement.status !== "approved") continue

    try {
      const ch = await client.channels.fetch(config.channels.anuncios)
      const msg = await ch.messages.fetch(announcement.message_id).catch(() => null)
      if (msg) {
        const namemc = `https://namemc.com/profile/${announcement.uuid}`
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`interest_${announcement.id}`).setLabel("Tenho Interesse").setStyle(ButtonStyle.Success),
          new ButtonBuilder().setURL(namemc).setLabel("Ver no NameMC").setStyle(ButtonStyle.Link),
          buildFavoriteButton(announcement.id),
        )
        await msg.edit({ components: [row] })
      }
    } catch { /* ok */ }

    try {
      const seller = await client.users.fetch(reservation.seller_id)
      await seller.send({
        embeds: [new EmbedBuilder()
          .setColor("#FFA500")
          .setTitle("🔓 Reserva Expirada")
          .setDescription(`A reserva da conta **${announcement.nick}** expirou. O anúncio voltou a ficar disponível para todos.`)
          .setTimestamp()],
      })
    } catch { /* ok */ }

    addLog("reservation_expired", "system", String(reservation.announcement_id), `Reserva expirada: ${announcement.nick}`)
  }
}

// ─────────────────────────────────────────────
// AUTO-CLOSE POR INATIVIDADE (fix #13) — a cada hora
// ─────────────────────────────────────────────

async function checkInactiveTickets(client) {
  const config = client.config

  // Tickets sem mensagem há 48h → avisar
  const inactive = getInactiveTicketChannels(48)
  for (const entry of inactive) {
    try {
      const channel = await client.channels.fetch(entry.channel_id).catch(() => null)
      if (!channel) { markInactivityWarned(entry.channel_id); continue }

      const warnEmbed = new EmbedBuilder()
        .setColor("#FFA500")
        .setTitle("⚠️ Ticket Inativo")
        .setDescription(
          `Este ticket está inativo há **48 horas**.\n\n` +
          `Ele será **fechado automaticamente em 24 horas** se não houver resposta.\n` +
          `Se ainda precisar de atendimento, envie uma mensagem aqui.`
        )
        .setFooter({ text: "Feche o ticket manualmente se não precisar mais" })
        .setTimestamp()

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("close_ticket")
          .setLabel("Fechar Ticket")
          .setStyle(ButtonStyle.Danger),
      )

      await channel.send({
        content: `<@${entry.user_id}>`,
        embeds: [warnEmbed],
        components: [row],
      })

      markInactivityWarned(entry.channel_id)
      addLog("ticket_inactivity_warned", "system", entry.channel_id, "Aviso de inatividade enviado")
      console.log(`[SCHEDULER] Aviso de inatividade enviado: #${channel.name}`)
    } catch (err) {
      console.error(`[SCHEDULER] Erro ao avisar inatividade ${entry.channel_id}:`, err.message)
    }
  }

  // Tickets que já foram avisados há 24h → fechar automaticamente
  const toClose = getChannelsToAutoClose(24)
  for (const entry of toClose) {
    try {
      const channel = await client.channels.fetch(entry.channel_id).catch(() => null)
      if (!channel) { closeTicket(entry.channel_id); continue }

      // Gerar transcript
      const transcript = await genTranscript(channel)
      if (transcript && config.channels.logs) {
        await sendTranscriptToLogs(client, config.channels.logs, transcript, channel.name, "Sistema (inatividade)")
      }

      await channel.send({
        embeds: [new EmbedBuilder()
          .setColor("#FF4444")
          .setTitle("🔒 Ticket Fechado por Inatividade")
          .setDescription("Este ticket foi fechado automaticamente após **72 horas de inatividade**.\nO transcript foi salvo nos logs.")
          .setTimestamp()],
      })

      closeTicket(entry.channel_id)
      addLog("ticket_auto_closed", "system", entry.channel_id, "Fechado por inatividade")

      setTimeout(async () => {
        try { await channel.delete() } catch { /* ok */ }
      }, 5000)

      console.log(`[SCHEDULER] Ticket auto-fechado por inatividade: #${channel.name}`)
    } catch (err) {
      console.error(`[SCHEDULER] Erro ao auto-fechar ${entry.channel_id}:`, err.message)
    }
  }
}

// ─────────────────────────────────────────────
// RELATÓRIO SEMANAL — domingo às 09:00
// ─────────────────────────────────────────────

async function sendWeeklyReport(client) {
  const config = client.config
  if (!config.channels?.logs) return

  const stats = getWeeklyStats()
  saveWeeklyReport(stats)

  const topSellerText = stats.topSeller ? `<@${stats.topSeller[0]}> (${stats.topSeller[1]} vendas)` : "Nenhum"

  const embed = new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle("📊 Relatório Semanal Automático")
    .setDescription("Resumo das atividades dos últimos **7 dias**")
    .addFields(
      { name: "🎫 Tickets", value: `Novos: **${stats.newTickets}** · Fechados: **${stats.closedTickets}**`, inline: false },
      { name: "📢 Anúncios", value: `Novos: **${stats.newAnnouncements}** · Aprovados: **${stats.approvedAds}** · Vendidos: **${stats.soldCount}**`, inline: false },
      { name: "💰 Volume Negociado", value: `R$ **${stats.totalRevenue}** em **${stats.completedNegs}** venda(s)`, inline: false },
      { name: "🤝 Negociações", value: `Abertas: **${stats.newNegotiations}** · Concluídas: **${stats.completedNegs}**`, inline: false },
      { name: "⭐ Avaliações", value: `Total: **${stats.newRatings}** · Média: **${stats.avgRating}**`, inline: false },
      { name: "🏆 Top Vendedor", value: topSellerText, inline: false },
    )
    .setFooter({ text: "Gerado automaticamente todo domingo às 09:00" })
    .setTimestamp()

  try {
    const ch = await client.channels.fetch(config.channels.logs)
    await ch.send({ embeds: [embed] })
    console.log("[SCHEDULER] Relatório semanal enviado!")
  } catch (err) {
    console.error("[SCHEDULER] Erro ao enviar relatório semanal:", err.message)
  }
}

// ─────────────────────────────────────────────
// REGISTRO DE TODOS OS JOBS
// ─────────────────────────────────────────────

export function startSchedulers(client) {
  // Expirações — todo início de hora
  cron.schedule("0 * * * *", () => checkExpirations(client).catch(console.error), { timezone: "America/Sao_Paulo" })

  // Auto bump — a cada 30 minutos
  cron.schedule("*/30 * * * *", () => processAutoBumps(client).catch(console.error))

  // Reservas expiradas — a cada 5 minutos
  cron.schedule("*/5 * * * *", () => checkReservations(client).catch(console.error))

  // Tickets inativos — a cada hora (minuto 30)
  cron.schedule("30 * * * *", () => checkInactiveTickets(client).catch(console.error), { timezone: "America/Sao_Paulo" })

  // Relatório semanal — domingo às 09:00
  cron.schedule("0 9 * * 0", () => sendWeeklyReport(client).catch(console.error), { timezone: "America/Sao_Paulo" })

  // Purge de cooldowns expirados — todo dia às 02:00
  cron.schedule("0 2 * * *", () => {
    purgeExpiredCooldowns()
  }, { timezone: "America/Sao_Paulo" })

  // Purge de temp_modal_data expirados — todo dia às 02:30
  cron.schedule("30 2 * * *", () => {
    purgeExpiredTempData()
  }, { timezone: "America/Sao_Paulo" })

  // Purge de logs — todo dia às 03:00
  cron.schedule("0 3 * * *", () => {
    const removed = purgeOldLogs(90)
    if (removed) console.log(`[SCHEDULER] Purge: ${removed} logs removidos`)
  }, { timezone: "America/Sao_Paulo" })

  // Executar imediatamente ao iniciar
  checkExpirations(client).catch(console.error)
  processAutoBumps(client).catch(console.error)
  checkReservations(client).catch(console.error)
  checkInactiveTickets(client).catch(console.error)

  console.log("[SCHEDULER] Todos os jobs agendados com node-cron ✓")
}

// Compat com index.js antigo
export const startExpirationChecker = (client) => {}
export const startAutoBumpProcessor = (client) => {}
export const startReservationChecker = (client) => {}
export const startWeeklyReport = (client) => {}
export const startLogPurge = () => {}
