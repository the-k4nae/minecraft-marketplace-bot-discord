/**
 * utils/negotiationTimeout.js
 *
 * Timeout automático de negociações sem atividade do comprador.
 *
 * Como funciona:
 *  - A cada 30min, o scheduler verifica negociações 'active' onde o comprador
 *    não interagiu há mais de X horas (padrão: 24h, configurável em config.limits)
 *  - Primeiro aviso: mensagem no canal ao atingir 75% do prazo
 *  - Cancelamento automático: ao atingir 100% do prazo
 *  - Vendedor recebe DM e o canal é deletado
 */

import {
  getInactiveNegotiations, getNegotiationsNearTimeout,
  markNegotiationTimeoutWarned, cancelNegotiation, addLog,
} from "./database.js"
import { CV2, container, text, COLORS } from "./components.js"
import { sendLogEmbed } from "./logger.js"
import { fileLog } from "./fileLogger.js"

/**
 * Chamada a cada 30min pelo cron.
 * - Avisa negociações que atingiram 75% do prazo sem atividade do comprador
 * - Cancela negociações que ultrapassaram o prazo
 */
export async function checkNegotiationTimeouts(client) {
  const timeoutHours = client.config.limits?.negotiationTimeoutHours ?? 24
  const warnAt = timeoutHours * 0.75  // avisa aos 75% (ex: 18h se timeout=24h)

  // ── 1. Aviso de proximidade ──────────────────────────────────────────────
  const nearTimeout = getNegotiationsNearTimeout(warnAt, timeoutHours)

  for (const neg of nearTimeout) {
    try {
      const ch = await client.channels.fetch(neg.ticket_channel_id).catch(() => null)
      if (!ch) continue

      const remainingH = Math.ceil(timeoutHours - warnAt)
      markNegotiationTimeoutWarned(neg.id)

      const wc = container(COLORS.WARNING)
        .addTextDisplayComponents(text(
          `## ⏰ Aviso de Inatividade\n<@${neg.buyer_id}> — Esta negociação será **cancelada automaticamente em ${remainingH}h** ` +
          `por falta de atividade.\n\nInteraja no canal para renovar o prazo ou clique em ❌ Cancelar ` +
          `se não tiver mais interesse.`
        ))
      await ch.send({ flags: CV2, components: [wc] })
    } catch { /* canal pode ter sido deletado */ }
  }

  // ── 2. Cancelamento automático ───────────────────────────────────────────
  const timedOut = getInactiveNegotiations(timeoutHours)

  for (const neg of timedOut) {
    try {
      cancelNegotiation(neg.ticket_channel_id)
      addLog("negotiation_timeout", "system", String(neg.id),
        `Cancelada por inatividade do comprador após ${timeoutHours}h`)

      const ch = await client.channels.fetch(neg.ticket_channel_id).catch(() => null)

      // DM ao comprador
      try {
        const buyer = await client.users.fetch(neg.buyer_id)
        const bc = container(COLORS.DANGER)
          .addTextDisplayComponents(text(
            `## ❌ Negociação Cancelada por Inatividade\nSua negociação foi cancelada automaticamente após **${timeoutHours}h** sem atividade.\nSe ainda tiver interesse, acesse o canal de anúncios e demonstre interesse novamente.`
          ))
        await buyer.send({ components: [bc] })
      } catch { /* DM fechada */ }

      // DM ao vendedor
      try {
        const seller = await client.users.fetch(neg.seller_id)
        const sc = container(COLORS.DANGER)
          .addTextDisplayComponents(text(
            `## ❌ Negociação Cancelada por Inatividade do Comprador\nA negociação foi cancelada pois o comprador ficou inativo por **${timeoutHours}h**.\nSeu anúncio continua disponível no canal de anúncios.`
          ))
        await seller.send({ components: [sc] })
      } catch { /* DM fechada */ }

      // Aviso e deleção do canal
      if (ch) {
        const closec = container(COLORS.DANGER)
          .addTextDisplayComponents(text(
            `## 🔒 Canal Encerrado — Inatividade\nNegociação cancelada automaticamente por inatividade do comprador. Canal removido em 15s.`
          ))
        await ch.send({ flags: CV2, components: [closec] })
        setTimeout(() => ch.delete().catch(() => {}), 15_000)
      }

      await sendLogEmbed(client, {
        title: "Negociação Cancelada por Timeout",
        type: "negotiation_cancelled",
        fields: [
          { name: "Comprador", value: `<@${neg.buyer_id}>`, inline: true },
          { name: "Vendedor",  value: `<@${neg.seller_id}>`, inline: true },
          { name: "Neg. ID",   value: String(neg.id), inline: true },
          { name: "Motivo",    value: `Inativo por ${timeoutHours}h`, inline: false },
        ],
      })
    } catch (err) {
      fileLog.error({ negId: neg.id, err: err.message }, "[TIMEOUT] Erro ao cancelar negociação")
    }
  }

  if (nearTimeout.length || timedOut.length) {
    fileLog.info({ warned: nearTimeout.length, cancelled: timedOut.length }, "[SCHEDULER] Timeout negociações processado")
  }
}

/**
 * Registrar atividade do COMPRADOR numa negociação.
 * Chamar em events/interactionCreate.js para qualquer interação do comprador
 * dentro de um canal de negociação.
 *
 * Exemplo de uso em interactionCreate.js:
 *   import { trackBuyerActivity } from "../utils/negotiationTimeout.js"
 *   // No handler de botões, antes do roteamento:
 *   await trackBuyerActivity(interaction)
 */
export async function trackBuyerActivity(interaction) {
  // Importação lazy para evitar dependência circular
  const { getNegotiationByChannel, updateBuyerActivity } = await import("./database.js")
  const neg = getNegotiationByChannel(interaction.channelId)
  if (neg && neg.status === "active" && interaction.user.id === neg.buyer_id) {
    updateBuyerActivity(neg.id)
  }
}

