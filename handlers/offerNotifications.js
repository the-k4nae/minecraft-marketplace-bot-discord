/**
 * FEATURE 3 — Notificação de oferta/contra-oferta por DM (CV2)
 *
 * Substitui o `buyer.send(texto simples)` atual em salesHandler.js
 * por containers CV2 ricos com todas as informações relevantes e um botão de link
 * direto para o canal de negociação.
 */

import { ButtonStyle } from "discord.js"
import { getAnnouncement } from "../utils/database.js"
import {
  container, text, separator, section, thumbnail,
  createRow, createButton, createLinkButton, formatValor, COLORS,
} from "../utils/components.js"
import { getSkinUrls } from "../utils/minecraftAPI.js"

// ─── Cores personalizadas ────────────────────────────────────────────────────

const C = {
  NEW_OFFER:    0x5865F2,
  COUNTER:      0xFFA500,
  ACCEPTED:     0x00D166,
  REJECTED:     0xFF6B6B,
}

// ─── Helper: botão deep-link para o canal ────────────────────────────────────

function channelLink(channel) {
  return createLinkButton({
    url: `https://discord.com/channels/${channel.guildId}/${channel.id}`,
    label: "Ir para a Negociação ↗",
  })
}

// ─── 1. Nova oferta recebida → notificar VENDEDOR ────────────────────────────

export async function notifyNewOffer(client, negotiation, offer, announcement, channel) {
  try {
    const seller = await client.users.fetch(negotiation.seller_id)
    const buyer  = await client.users.fetch(negotiation.buyer_id)
    const skin   = announcement?.uuid ? getSkinUrls(announcement.uuid) : null

    const c = container(C.NEW_OFFER)
    c.addSectionComponents(
      section(
        `## 💸 Nova Oferta Recebida!\n**${buyer.username}** fez uma oferta pela sua conta **${announcement?.nick ?? ""}**.`,
        skin ? thumbnail(skin.avatar, announcement.nick) : undefined
      )
    )
    c.addSeparatorComponents(separator())
    c.addTextDisplayComponents(text(
      `**Valor anunciado:** R$ ${formatValor(announcement?.valor)}\n` +
      `**Oferta recebida:** R$ ${formatValor(offer.value)}\n` +
      `**Diferença:** ${_diffStr(announcement?.valor, offer.value)}\n` +
      (offer.message ? `\n> _${offer.message}_\n` : "") +
      `\n**Ação necessária:** Acesse o canal para aceitar, recusar ou fazer uma contraproposta.\n\n` +
      `-# Oferta #${offer.id} · Negociação #${negotiation.id}`
    ))
    c.addActionRowComponents(createRow(channelLink(channel)))

    await seller.send({ components: [c] })
  } catch { /* DM fechada */ }
}

// ─── 2. Contra-oferta → notificar COMPRADOR ──────────────────────────────────

export async function notifyCounterOffer(client, negotiation, originalOffer, counterOffer, announcement, channel) {
  try {
    const buyer  = await client.users.fetch(negotiation.buyer_id)
    const seller = await client.users.fetch(negotiation.seller_id)
    const skin   = announcement?.uuid ? getSkinUrls(announcement.uuid) : null

    const c = container(C.COUNTER)
    c.addSectionComponents(
      section(
        `## 🔄 Contra-Oferta do Vendedor!\n**${seller.username}** respondeu com uma contraproposta pela conta **${announcement?.nick ?? ""}**.`,
        skin ? thumbnail(skin.avatar, announcement.nick) : undefined
      )
    )
    c.addSeparatorComponents(separator())
    c.addTextDisplayComponents(text(
      `**Sua oferta:** R$ ${formatValor(originalOffer.value)}\n` +
      `**Contraproposta:** R$ ${formatValor(counterOffer.value)}\n` +
      `**Diferença:** ${_diffStr(originalOffer.value, counterOffer.value)}\n` +
      (counterOffer.message ? `\n> _${counterOffer.message}_\n` : "") +
      `\n**Ação necessária:** Você pode aceitar, recusar ou fazer uma nova oferta no canal.\n\n` +
      `-# Contra-oferta #${counterOffer.id} · Negociação #${negotiation.id}`
    ))
    c.addActionRowComponents(createRow(channelLink(channel)))

    await buyer.send({ components: [c] })
  } catch { /* DM fechada */ }
}

// ─── 3. Oferta aceita → notificar COMPRADOR ──────────────────────────────────

export async function notifyOfferAccepted(client, negotiation, offer, announcement, channel) {
  try {
    const buyer  = await client.users.fetch(negotiation.buyer_id)
    const skin   = announcement?.uuid ? getSkinUrls(announcement.uuid) : null

    const c = container(C.ACCEPTED)
    c.addSectionComponents(
      section(
        `## ✅ Oferta Aceita!\nO vendedor **aceitou** sua oferta de **R$ ${formatValor(offer.value)}** pela conta **${announcement?.nick ?? ""}**!`,
        skin ? thumbnail(skin.avatar, announcement.nick) : undefined
      )
    )
    c.addSeparatorComponents(separator())
    c.addTextDisplayComponents(text(
      `**Próximo passo:** Combine o pagamento no canal e use os botões de escrow para confirmar a transação.\n\n` +
      `-# Oferta #${offer.id} · Negociação #${negotiation.id}`
    ))
    c.addActionRowComponents(createRow(channelLink(channel)))

    await buyer.send({ components: [c] })
  } catch { /* DM fechada */ }
}

// ─── 4. Oferta recusada → notificar COMPRADOR ────────────────────────────────

export async function notifyOfferRejected(client, negotiation, offer, announcement, channel) {
  try {
    const buyer = await client.users.fetch(negotiation.buyer_id)
    const skin  = announcement?.uuid ? getSkinUrls(announcement.uuid) : null

    const c = container(C.REJECTED)
    c.addSectionComponents(
      section(
        `## ❌ Oferta Recusada\nO vendedor **recusou** sua oferta de **R$ ${formatValor(offer.value)}** pela conta **${announcement?.nick ?? ""}**.`,
        skin ? thumbnail(skin.avatar, announcement.nick) : undefined
      )
    )
    c.addSeparatorComponents(separator())
    c.addTextDisplayComponents(text(
      `**Próximo passo:** Você pode fazer uma nova oferta ou encerrar a negociação.\n\n` +
      `-# Oferta #${offer.id} · Negociação #${negotiation.id}`
    ))
    c.addActionRowComponents(createRow(channelLink(channel)))

    await buyer.send({ components: [c] })
  } catch { /* DM fechada */ }
}

// ─── Helper interno ───────────────────────────────────────────────────────────

function _diffStr(original, offered) {
  const o = parseFloat(String(original).replace(",", ".")) || 0
  const n = parseFloat(String(offered).replace(",", "."))  || 0
  const d = n - o
  if (d === 0) return "Sem diferença"
  const sign = d > 0 ? "+" : ""
  const pct  = o > 0 ? ` (${sign}${((d / o) * 100).toFixed(0)}%)` : ""
  return `${sign}R$ ${formatValor(Math.abs(d))}${pct}`
}
