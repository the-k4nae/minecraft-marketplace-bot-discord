/**
 * utils/components.js — Components V2 + @magicyan/discord
 *
 * Substitui utils/embedBuilder.js inteiramente.
 * Toda mensagem usa flags: IsComponentsV2 e components: [ContainerBuilder]
 * em vez de embeds: [EmbedBuilder].
 *
 * Instalar dependência:
 *   npm install @magicyan/discord
 *
 * Compatibilidade: discord.js ^14.16.0 (Components V2 release)
 */

import {
  ContainerBuilder,
  SectionBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SeparatorSpacingSize,
} from "discord.js"

import {
  createRow,
  createLinkButton,
} from "@magicyan/discord"

import { getSkinUrls } from "./minecraftAPI.js"

// ─── Helpers locais (funções ausentes no @magicyan/discord) ─────────────────

/**
 * Cria um ButtonBuilder a partir de um objeto de opções.
 * @param {{ customId: string, label: string, style: ButtonStyle, disabled?: boolean }} opts
 */
export function createButton({ customId, label, style, disabled = false }) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(disabled)
}

/**
 * Trunca texto ao comprimento máximo, adicionando "…" se necessário.
 * @param {string} text
 * @param {number} max
 */
export function limit(text, max) {
  if (!text) return ""
  return text.length <= max ? text : text.slice(0, max - 1) + "…"
}

/**
 * Converte string vazia/whitespace para null.
 * @param {string|null|undefined} value
 */
export function toNull(value) {
  if (value === null || value === undefined) return null
  return value.trim() === "" ? null : value
}

// ─── Re-exportar helpers do @magicyan para os handlers não precisarem importar direto
export { createRow, createLinkButton }

// ─── Flag combinada (shorthand usado em todo o projeto)
export const CV2 = MessageFlags.IsComponentsV2
export const CV2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral

// ─── Cores como inteiros (ContainerBuilder não aceita hex string)
export const COLORS = {
  PRIMARY:  0x5865F2,
  SUCCESS:  0x00D166,
  DANGER:   0xFF4444,
  WARNING:  0xFFA500,
  INFO:     0x7289DA,
  GOLD:     0xFFD700,
  SOLD:     0x9B59B6,
  EXPIRED:  0x95A5A6,
  ESCROW:   0x3498DB,
  NEUTRAL:  0xB9BBBE,
  BRANDING: 0xFF7A59,
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

/** Converte hex string → integer para setAccentColor */
export function hexColor(hex) {
  return parseInt(hex.replace("#", ""), 16)
}

/** Formata valor monetário: 1500.5 → "1.500,50" */
export function formatValor(v) {
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Igual ao parseMoney original — aceita BR e EN */
export function parseMoney(raw) {
  if (!raw) return null
  const s = String(raw).trim().replace(/\s/g, "")
  if (!s) return null
  const n = s.includes(",")
    ? parseFloat(s.replace(/\./g, "").replace(",", "."))
    : parseFloat(s)
  return isNaN(n) || n <= 0 ? null : n
}

// ─── Builders base ────────────────────────────────────────────────────────────

/**
 * Cria um Container V2 básico.
 * @param {number|null} color - COLORS.X ou null
 * @returns {ContainerBuilder}
 */
export function container(color = null) {
  const c = new ContainerBuilder()
  if (color !== null) c.setAccentColor(color)
  return c
}

/** Cria um TextDisplay (conteúdo nunca pode ser vazio) */
export function text(content) {
  return new TextDisplayBuilder().setContent(content || "​")
}

/** Cria um separador */
export function separator(divider = true, spacing = SeparatorSpacingSize.Small) {
  return new SeparatorBuilder().setDivider(divider).setSpacing(spacing)
}

/** Cria um Thumbnail a partir de URL */
export function thumbnail(url, description = "​") {
  return new ThumbnailBuilder().setURL(url).setDescription(description || "​")
}

/** Cria uma MediaGallery com uma ou mais imagens */
export function mediaGallery(...urls) {
  const gallery = new MediaGalleryBuilder()
  for (const url of urls) {
    gallery.addItems({ media: { url } })
  }
  return gallery
}

/** Cria uma Section com texto e acessório (thumbnail ou botão) */
export function section(textContent, accessory = null) {
  const s = new SectionBuilder()
  s.addTextDisplayComponents(text(textContent || "​"))
  if (accessory) {
    if (accessory instanceof ThumbnailBuilder) s.setThumbnailAccessory(accessory)
    else if (accessory instanceof ButtonBuilder) s.setButtonAccessory(accessory)
  }
  return s
}

// ─── Resposta rápida (ephemeral inline) ───────────────────────────────────────

/** Mensagem de sucesso ephemeral (sem embed) */
export function successReply(message) {
  return {
    flags: CV2_EPHEMERAL,
    components: [container(COLORS.SUCCESS).addTextDisplayComponents(text(`✅ ${message}`))],
  }
}

/** Mensagem de erro ephemeral */
export function errorReply(message) {
  return {
    flags: CV2_EPHEMERAL,
    components: [container(COLORS.DANGER).addTextDisplayComponents(text(`❌ ${message}`))],
  }
}

/** Mensagem de aviso ephemeral */
export function warnReply(message) {
  return {
    flags: CV2_EPHEMERAL,
    components: [container(COLORS.WARNING).addTextDisplayComponents(text(`⚠️ ${message}`))],
  }
}

/** Info ephemeral */
export function infoReply(message) {
  return {
    flags: CV2_EPHEMERAL,
    components: [container(COLORS.INFO).addTextDisplayComponents(text(`ℹ️ ${message}`))],
  }
}

// ─── Painel de tickets ────────────────────────────────────────────────────────

export function buildTicketPanel(guild) {
  const c = container(COLORS.PRIMARY)
    .addTextDisplayComponents(text(
      `## 🎫 Central de Atendimento\n` +
      `-# ${guild.name}`
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      "Precisa de ajuda com algo? Selecione o tipo de atendimento abaixo e um membro da nossa equipe irá te ajudar.\n\n" +
      "🛠️ **Suporte** — Bugs, problemas técnicos ou erros\n" +
      "❓ **Dúvidas** — Regras, marketplace ou funcionalidades\n" +
      "🚨 **Denúncia** — Scams, comportamento suspeito ou abuso"
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text("-# ⏳ Tempo médio de resposta: até 24h  ·  Tenha prints em mãos antes de abrir"))
    .addActionRowComponents(
      createRow(
        createButton({ customId: "ticket_suporte",  label: "🛠️ Suporte",  style: ButtonStyle.Primary }),
        createButton({ customId: "ticket_duvidas",  label: "❓ Dúvidas",  style: ButtonStyle.Secondary }),
        createButton({ customId: "ticket_denuncia", label: "🚨 Denúncia", style: ButtonStyle.Danger }),
      )
    )

  return { flags: CV2, components: [c] }
}

export function buildAnuncioPanel(guild, bannerUrl = null) {
  const c = container(0x57F287)

  if (bannerUrl) {
    c.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(
        new MediaGalleryItemBuilder().setURL(bannerUrl)
      )
    )
  }

  c.addTextDisplayComponents(text(
      "Quer vender sua conta? Clique no botão abaixo!"
    ))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      "**Como funciona:**\n" +
      "• Clique em **Anunciar Conta**\n" +
      "• Responda as perguntas no ticket\n" +
      "• Aguarde a aprovação da equipe\n" +
      "• Seu anúncio será publicado aqui!"
    ))
    .addSeparatorComponents(separator())
    .addActionRowComponents(
      createRow(
        createButton({ customId: "announce_modal", label: "📢 Anunciar Conta", style: ButtonStyle.Success })
      )
    )

  return { flags: CV2, components: [c] }
}

// ─── Card de ticket (canal interno) ──────────────────────────────────────────

export function buildTicketCard(type, user) {
  const typeInfo = {
    suporte:  { emoji: "🛠️", label: "Suporte",  color: 0x5865F2,
      desc: "Descreva seu problema com o máximo de detalhes.\nEnvie prints ou qualquer prova que ajude a resolver mais rápido." },
    duvidas:  { emoji: "❓", label: "Dúvidas",  color: 0xFEE75C,
      desc: "Escreva sua dúvida com clareza.\nQuanto mais detalhado, mais rápido conseguimos te ajudar." },
    denuncia: { emoji: "🚨", label: "Denúncia", color: 0xED4245,
      desc: "Descreva o ocorrido detalhadamente.\nEnvie prints, IDs dos envolvidos e qualquer prova disponível." },
  }[type] ?? { emoji: "🎫", label: "Ticket", color: 0x5865F2,
    desc: "Descreva sua solicitação com detalhes." }

  const now = new Date()
  const openedAt = `${now.toLocaleDateString("pt-BR")} às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`

  const avatarUrl = user.displayAvatarURL({ size: 256, extension: "png" })

  const c = container(typeInfo.color)
    .addSectionComponents(
      section(
        `## ${typeInfo.emoji} Ticket de ${typeInfo.label}\n` +
        `${typeInfo.desc}\n\n` +
        `-# Aberto por ${user.username}  ·  ${openedAt}`,
        thumbnail(avatarUrl, user.username)
      )
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      `-# • Seja educado e objetivo  · Envie prints quando possível  ·  Não envie DMs para a staff`
    ))

  return { flags: CV2, components: [c] }
}

// ─── Anúncio público ──────────────────────────────────────────────────────────

export function buildPublicAnnouncement(announcement, seller, rating, options = {}) {
  const skin    = getSkinUrls(announcement.uuid || announcement.nick)
  const namemc  = `https://namemc.com/profile/${announcement.uuid ?? announcement.nick}`

  const stars = rating?.count > 0
    ? "★".repeat(Math.round(rating.average)) + "☆".repeat(5 - Math.round(rating.average)) + ` (${rating.average} — ${rating.count} aval.)`
    : "Sem avaliações"

  const extras = [
    announcement.tags       ? `**Tags:** ${announcement.tags}`             : null,
    announcement.medalhas   ? `**Medalhas:** ${announcement.medalhas}`     : null,
    announcement.wins_level ? `**Wins/Level:** ${announcement.wins_level}` : null,
    announcement.cosmeticos ? `**Cosméticos:** ${announcement.cosmeticos}` : null,
  ].filter(Boolean)

  const c = container(COLORS.PRIMARY)
    .addSectionComponents(
      section(
        `## 🎮 ${announcement.nick}\n` +
        `### R$ ${formatValor(announcement.valor)}\n` +
        `-# Vendedor: ${seller?.username ?? "Desconhecido"}  ·  ${stars}`,
        thumbnail(skin.avatar, announcement.nick)
      )
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      [`**Bans:** ${announcement.bans || "Nenhum"}`,
       `**VIPs/Ranks:** ${announcement.vips || "Nenhum"}`,
       `**Capas:** ${announcement.capas || "Nenhuma"}`,
       ...extras,
      ].join("\n")
    ))

  // Imagem: foto customizada ou body render da skin
  const imgUrl = announcement.photo_url || skin.body
  c.addSeparatorComponents(separator())
   .addMediaGalleryComponents(mediaGallery(imgUrl))

  c.addSeparatorComponents(separator())
   .addTextDisplayComponents(text(`-# ID #${announcement.id}`))

  // Botões: modo reservado desabilita o botão de interesse
  const interestBtn = options.reserved
    ? createButton({ customId: `interest_${announcement.id}`, label: "RESERVADO", style: ButtonStyle.Secondary, disabled: true })
    : createButton({ customId: `interest_${announcement.id}`, label: "Tenho Interesse", style: ButtonStyle.Success })

  c.addActionRowComponents(
    createRow(
      interestBtn,
      createLinkButton({ url: namemc, label: "Ver no NameMC" }),
      createButton({ customId: `fav_toggle_${announcement.id}`, label: "❤️ Favoritar", style: ButtonStyle.Secondary }),
    )
  )

  return { flags: CV2, components: [c] }
}

// ─── Review de anúncio (staff) ────────────────────────────────────────────────

export function buildAnnouncementReview(announcement, seller, mention = null) {
  const skin   = getSkinUrls(announcement.uuid || announcement.nick)
  const namemc = `https://namemc.com/profile/${announcement.uuid ?? announcement.nick}`

  const details = [
    `## 📋 Revisão de Anúncio #${announcement.id}`,
    `**Vendedor:** ${seller?.username ?? announcement.user_id}`,
    `**Nick:** ${announcement.nick}`,
    `**UUID:** \`${announcement.uuid ?? "não informado"}\``,
    `**Valor:** R$ ${formatValor(announcement.valor)}`,
    "",
    `**Bans:** ${announcement.bans || "Nenhum"}`,
    `**VIPs:** ${announcement.vips || "Nenhum"}`,
    `**Capas:** ${announcement.capas || "Nenhuma"}`,
    announcement.tags       ? `**Tags:** ${announcement.tags}`           : null,
    announcement.medalhas   ? `**Medalhas:** ${announcement.medalhas}`   : null,
    announcement.wins_level ? `**Wins/Level:** ${announcement.wins_level}` : null,
    announcement.cosmeticos ? `**Cosméticos:** ${limit(announcement.cosmeticos, 200)}` : null,
  ].filter(l => l !== null)

  const c = container(COLORS.WARNING)
  if (mention) c.addTextDisplayComponents(text(mention))
  c.addSectionComponents(
    section(details.join("\n"), thumbnail(skin.avatar, announcement.nick))
  )

  const reviewImg = announcement.photo_url || skin.body
  c.addSeparatorComponents(separator())
    .addMediaGalleryComponents(mediaGallery(reviewImg))

  c.addSeparatorComponents(separator())
   .addActionRowComponents(
     createRow(
       createButton({ customId: `approve_${announcement.id}`, label: "✅ Aprovar",  style: ButtonStyle.Success }),
       createButton({ customId: `reject_${announcement.id}`,  label: "❌ Recusar",  style: ButtonStyle.Danger }),
       createButton({ customId: `ann_editlog_${announcement.id}`, label: "📋 Edições", style: ButtonStyle.Secondary }),
       createLinkButton({ url: namemc, label: "NameMC" }),
     )
   )

  return { flags: CV2, components: [c] }
}

// ─── Canal de negociação ──────────────────────────────────────────────────────

export function buildNegotiationCard(announcement, buyer, seller) {
  const skin   = getSkinUrls(announcement.uuid || announcement.nick)
  const namemc = `https://namemc.com/profile/${announcement.uuid ?? announcement.nick}`

  const c = container(COLORS.ESCROW)
    .addSectionComponents(
      section(
        `## 🤝 Negociação — ${announcement.nick}\n` +
        `**Comprador:** ${buyer}\n` +
        `**Vendedor:** ${seller}\n` +
        `**Valor:** R$ ${formatValor(announcement.valor)}\n` +
        `[Ver no NameMC](${namemc})`,
        thumbnail(skin.avatar, announcement.nick)
      )
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text(
      "**📋 Regras da negociação**\n" +
      "1. Não compartilhe informações pessoais fora do servidor\n" +
      "2. Use **Chamar Staff** se precisar de intermediário\n" +
      "3. Não realize pagamentos sem confirmar o escrow\n" +
      "4. Ao finalizar, clique **Venda Concluída** para ambos confirmarem\n" +
      "5. Envie o comprovante antes de confirmar o recebimento\n\n" +
      "-# Proteja-se contra scams · Use sempre o sistema de escrow"
    ))
    .addSeparatorComponents(separator())
    .addActionRowComponents(
      createRow(
        createButton({ customId: `neg_complete_${announcement.id}`, label: "✅ Venda Concluída", style: ButtonStyle.Success }),
        createButton({ customId: `neg_cancel_${announcement.id}`,   label: "❌ Cancelar",        style: ButtonStyle.Danger }),
        createButton({ customId: `neg_callstaff`,                   label: "📣 Chamar Staff",    style: ButtonStyle.Secondary }),
      )
    )
    .addActionRowComponents(
      createRow(
        createButton({ customId: `escrow_seller_${announcement.id}`, label: "🔒 Confirmar Entrega (Vendedor)",    style: ButtonStyle.Primary }),
        createButton({ customId: `escrow_buyer_${announcement.id}`,  label: "✅ Confirmar Recebimento (Comprador)", style: ButtonStyle.Primary }),
      )
    )
    .addActionRowComponents(
      createRow(
        createButton({ customId: `neg_proof_${announcement.id}`, label: "📎 Comprovante",    style: ButtonStyle.Secondary }),
        createButton({ customId: `offer_make`,                    label: "💸 Fazer Oferta",  style: ButtonStyle.Secondary }),
        createButton({ customId: `mm_request`,                    label: "🛡 Middleman",     style: ButtonStyle.Secondary }),
      )
    )

  return { flags: CV2, components: [c] }
}

// ─── Venda concluída (canal de vendas) ───────────────────────────────────────

export function buildSaleCompletedCard(announcement, buyer, seller) {
  const skin = getSkinUrls(announcement.uuid || announcement.nick)

  const c = container(COLORS.SOLD)
    .addSectionComponents(
      section(
        `## 🎉 Venda Concluída!\n` +
        `**Conta:** ${announcement.nick}\n` +
        `**Valor:** R$ ${formatValor(announcement.valor)}\n` +
        `**Vendedor:** ${seller?.username ?? "?"}\n` +
        `**Comprador:** ${buyer?.username ?? "?"}`,
        thumbnail(skin.avatar, announcement.nick)
      )
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text("-# Transação confirmada via escrow · Não se esqueça de avaliar!"))

  return { flags: CV2, components: [c] }
}

// ─── DMs ──────────────────────────────────────────────────────────────────────

export function buildApprovalDm(announcement, guild) {
  const skin = getSkinUrls(announcement.uuid || announcement.nick)
  const c = container(COLORS.SUCCESS)
    .addSectionComponents(
      section(
        `## ✅ Anúncio Aprovado!\n` +
        `Sua conta **${announcement.nick}** está publicada em **${guild?.name ?? ""}**.\n` +
        `-# Valor: R$ ${formatValor(announcement.valor)}  ·  ID #${announcement.id}`,
        thumbnail(skin.avatar, announcement.nick)
      )
    )
    .addSeparatorComponents(separator())
    .addMediaGalleryComponents(mediaGallery(skin.body))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text("-# Aguarde compradores demonstrarem interesse no canal de anúncios."))
  return { flags: CV2, components: [c] }
}

export function buildRejectionDm(announcement, reason, guild) {
  const c = container(COLORS.DANGER)
    .addTextDisplayComponents(text(
      `## ❌ Anúncio Recusado\nSua conta **${announcement.nick}** foi recusada pela staff do servidor **${guild?.name ?? ""}**.\n\n` +
      `**Motivo:**\n${reason}\n\n` +
      `**O que fazer:** Corrija os problemas apontados e abra um novo ticket de anúncio.`
    ))
  return { flags: CV2, components: [c] }
}

export function buildNegotiationInterestDm(buyer, announcement, channel) {
  const skin = getSkinUrls(announcement.uuid || announcement.nick)  // skin da CONTA anunciada, não do comprador
  const c = container(COLORS.INFO)
    .addSectionComponents(
      section(
        `## 💬 Novo Interesse!\n**${buyer.username}** quer comprar sua conta **${announcement.nick}**.\n\n` +
        `**Valor anunciado:** R$ ${formatValor(announcement.valor)}\n` +
        `**Canal:** ${channel}`,
        thumbnail(skin.avatar, announcement.nick)
      )
    )
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text("-# Acesse o canal de negociação para conversar com o comprador."))
  return { flags: CV2, components: [c] }
}

export function buildSaleCompletedDm(announcement, role, partnerUsername, guild) {
  const isBuyer = role === "buyer"
  const skin    = getSkinUrls(announcement.uuid || announcement.nick)

  const c = container(COLORS.SOLD)
    .addSectionComponents(
      section(
        `## 🎉 ${isBuyer ? "Compra" : "Venda"} Concluída!\n` +
        `${isBuyer ? "Você comprou" : "Você vendeu"} a conta **${announcement.nick}** com sucesso!\n\n` +
        `**Valor:** R$ ${formatValor(announcement.valor)}\n` +
        `**${isBuyer ? "Vendedor" : "Comprador"}:** ${partnerUsername}\n\n` +
        `_Não se esqueça de **avaliar a transação** no canal de negociação!_`,
        thumbnail(skin.body, announcement.nick)
      )
    )
  return { flags: CV2, components: [c] }
}

export function buildBlacklistDm(reason, guild) {
  const c = container(COLORS.DANGER)
    .addTextDisplayComponents(text(
      `## ⛔ Você foi adicionado à Blacklist\nVocê não poderá criar anúncios ou negociar em **${guild?.name ?? ""}** enquanto estiver na blacklist.\n\n` +
      `**Motivo:** ${reason}\n\n` +
      `Se acredita que foi um engano, entre em contato com a staff no servidor.`
    ))
  return { flags: CV2, components: [c] }
}

export function buildBlacklistRemovedDm(guild) {
  const c = container(COLORS.SUCCESS)
    .addTextDisplayComponents(text(
      `## ✅ Removido da Blacklist\nVocê pode usar os serviços de **${guild?.name ?? ""}** normalmente agora.\nVolte ao servidor para criar anúncios e negociar.`
    ))
  return { flags: CV2, components: [c] }
}

// ─── Perfil / reputação ───────────────────────────────────────────────────────

export function buildProfileCard(target, rating, activeAnns, negStats) {
  const starsStr = rating.count > 0
    ? "★".repeat(Math.round(rating.average)) + "☆".repeat(5 - Math.round(rating.average)) + ` (${rating.average}/5 — ${rating.count} aval.)`
    : "Sem avaliações ainda"

  const c = container(COLORS.PRIMARY)
    .addSectionComponents(
      section(
        `## 👤 ${target.username}\n` +
        `**Reputação:** ${starsStr}\n` +
        `**Anúncios ativos:** ${activeAnns}\n` +
        `**Vendas concluídas:** ${negStats.completedAsSeller}\n` +
        `**Compras concluídas:** ${negStats.completedAsBuyer}\n` +
        `**Cancelamentos:** ${negStats.cancelledAsSeller + negStats.cancelledAsBuyer}`,
        thumbnail(target.displayAvatarURL({ size: 128 }), target.username)
      )
    )

  return { flags: CV2_EPHEMERAL, components: [c] }
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

export function buildRankingCard(entries) {
  const medals = ["🥇", "🥈", "🥉"]

  const lines = entries.map((e, i) => {
    const medal = medals[i] ?? `${i + 1}.`
    const stars  = e.avgRating > 0 ? `${"★".repeat(Math.round(e.avgRating))} ${e.avgRating}` : ""
    return `${medal} **${e.username}** · R$ ${formatValor(e.totalVolume)} ${stars ? `· ${stars}` : ""}`
  })

  const c = container(COLORS.GOLD)
    .addTextDisplayComponents(text(`## 🏆 Ranking de Vendedores\n${lines.join("\n")}`))
    .addSeparatorComponents(separator())
    .addTextDisplayComponents(text("-# Baseado no volume total vendido · Atualizado semanalmente"))

  return { flags: CV2, components: [c] }
}

// ─── Stats gerais ─────────────────────────────────────────────────────────────

export function buildStatsCard(stats) {
  const c = container(COLORS.INFO)
    .addTextDisplayComponents(text(
      `## 📊 Estatísticas do Servidor\n` +
      `**Tickets:** ${stats.totalTickets} (${stats.openTickets} abertos)\n` +
      `**Anúncios:** ${stats.totalAnnouncements} (${stats.activeAnnouncements} ativos · ${stats.pendingAnnouncements} pendentes)\n` +
      `**Negociações:** ${stats.totalNegotiations} (${stats.completedNegotiations} concluídas)\n` +
      `**Na blacklist:** ${stats.blacklistedUsers}\n` +
      `**Alertas ativos:** ${stats.activeAlerts}`
    ))

  return { flags: CV2_EPHEMERAL, components: [c] }
}

// ─── Meus anúncios ────────────────────────────────────────────────────────────

export function buildMeusAnunciosCard(user, anns, autoBumpFn) {
  const STATUS = { pending: "⏳", approved: "✅", rejected: "❌", sold: "💸", expired: "⌛" }
  const active = anns.filter(a => a.status === "approved")
  const sold   = anns.filter(a => a.status === "sold")
  const revenue = sold.reduce((s, a) => s + (a.valor ?? 0), 0)

  const header = `## 📋 Meus Anúncios\n**Total:** ${anns.length}  ·  Ativos: ${active.length}  ·  Vendidos: ${sold.length}\n💰 R$ ${formatValor(revenue)} em vendas`

  const lines = anns.slice(0, 10).map(a => {
    const ab   = a.status === "approved" && autoBumpFn?.(a.id)?.active ? "  🔔" : ""
    const date = new Date(a.created_at).toLocaleDateString("pt-BR")
    return `${STATUS[a.status] ?? "?"} **#${a.id}** ${a.nick}${ab}  ·  R$ ${formatValor(a.valor)}  ·  ${date}`
  })

  const c = container(COLORS.PRIMARY)
    .addSectionComponents(
      section(
        `${header}\n\n${lines.join("\n")}${anns.length > 10 ? `\n-# +${anns.length - 10} mais...` : ""}`,
        thumbnail(user.displayAvatarURL({ size: 64 }), user.username)
      )
    )

  return { flags: CV2_EPHEMERAL, components: [c] }
}

// ─── Oferta recebida (no canal de negociação) ─────────────────────────────────

export function buildOfferCard(offer, announcement, fromUser, negotiationId) {
  const c = container(COLORS.WARNING)
    .addTextDisplayComponents(text(
      `## 💸 Nova Oferta — ${announcement.nick}\n` +
      `**De:** ${fromUser.username}\n` +
      `**Valor original:** R$ ${formatValor(announcement.valor)}\n` +
      `**Oferta:** R$ ${formatValor(offer.value)}\n` +
      (offer.message ? `**Mensagem:** ${offer.message}` : "")
    ))
    .addSeparatorComponents(separator())
    .addActionRowComponents(
      createRow(
        createButton({ customId: `offer_accept_${offer.id}`,  label: "✅ Aceitar",      style: ButtonStyle.Success }),
        createButton({ customId: `offer_reject_${offer.id}`,  label: "❌ Recusar",      style: ButtonStyle.Danger }),
        createButton({ customId: `offer_counter_${offer.id}`, label: "🔄 Contraproposta", style: ButtonStyle.Secondary }),
      )
    )

  return { flags: CV2, components: [c] }
}

// ─── Compatibilidade — buildFavoriteButton ───────────────────────────────────
/**
 * Botão de favorito como ActionRow standalone.
 * NOTA: favoritosHandler.js também exporta buildFavoriteButton com estado correto
 * (isFavorited vindo do banco). Use a versão do favoritosHandler nos handlers
 * que têm acesso ao userId; use esta apenas quando não tiver contexto de usuário.
 */
export function buildFavoriteButton(announcementId, isFavorited = false) {
  return createRow(
    createButton({
      customId: `fav_toggle_${announcementId}`,
      label: isFavorited ? "💔 Desfavoritar" : "❤️ Favoritar",
      style: isFavorited ? ButtonStyle.Danger : ButtonStyle.Secondary,
    })
  )
}
