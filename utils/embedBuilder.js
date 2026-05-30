/**
 * embedBuilder.js — v5 (Melhorado)
 *
 * Melhorias:
 *  - Palette de cores expandida
 *  - Funções utilitárias para embeds consistentes
 *  - Formatação padronizada de textos
 */

import { EmbedBuilder } from "discord.js"
import { getSkinUrls } from "./minecraftAPI.js"

// Palette principal
export const COLORS = {
  PRIMARY:   "#5865F2",  // Discord blurple
  SUCCESS:   "#00D166",  // Verde
  DANGER:    "#FF4444",  // Vermelho
  WARNING:   "#FFA500",  // Laranja
  INFO:      "#7289DA",  // Azul claro
  GOLD:      "#FFD700",  // Dourado
  DARK:      "#2C2F33",  // Fundo escuro
  SOLD:      "#9B59B6",  // Roxo
  EXPIRED:   "#95A5A6",  // Cinza
  ESCROW:    "#3498DB",  // Azul
  NEUTRAL:   "#B9BBBE",  // Cinza claro
  BRANDING:  "#FF7A59",  // Coral (destaque)
}

// Emojis padronizados por categoria
export const EMOJIS = {
  ticket:    "🎫",
  stats:     "📊",
  anuncios:  "📢",
  compra:    "🛒",
  venda:     "💰",
  reputacao: "⭐",
  ranking:   "🏆",
  alerta:    "🔔",
  favorito:  "❤️",
  denuncia:  "🚨",
  sucesso:   "✅",
  erro:      "❌",
  aviso:     "⚠️",
  info:      "ℹ️",
}

/** Formata número para moeda BRL, ex: 200 → "200,00", 1500.5 → "1.500,50" */
export function formatValor(v) {
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/**
 * Cria um embed básico padronizado
 * @param {Object} options - { title, description, color, footer, thumbnail }
 * @returns {EmbedBuilder}
 */
export function createBaseEmbed({ title, description, color = COLORS.PRIMARY, footer, thumbnail, author }) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTimestamp()

  if (title) embed.setTitle(title)
  if (description) embed.setDescription(description)
  if (author) embed.setAuthor(author)
  if (thumbnail) embed.setThumbnail(thumbnail)
  if (footer) embed.setFooter(footer)

  return embed
}

/**
 * Cria embed de sucesso
 * @param {string} title - Título
 * @param {string} description - Descrição
 * @param {string} footerText - Texto do footer (opcional)
 * @returns {EmbedBuilder}
 */
export function createSuccessEmbed(title, description, footerText) {
  return createBaseEmbed({
    title,
    description,
    color: COLORS.SUCCESS,
    footer: { text: footerText || "Operação realizada com sucesso" },
  })
}

/**
 * Cria embed de erro
 * @param {string} title - Título
 * @param {string} description - Descrição
 * @returns {EmbedBuilder}
 */
export function createErrorEmbed(title, description) {
  return createBaseEmbed({
    title,
    description,
    color: COLORS.DANGER,
    footer: { text: "Se precisar de ajuda, abra um ticket" },
  })
}

/**
 * Cria embed de aviso
 * @param {string} title - Título
 * @param {string} description - Descrição
 * @returns {EmbedBuilder}
 */
export function createWarningEmbed(title, description) {
  return createBaseEmbed({
    title,
    description,
    color: COLORS.WARNING,
  })
}

/**
 * Formata texto para exibição (truncar se muito longo)
 * @param {string} text - Texto
 * @param {number} maxLength - Tamanho máximo
 * @returns {string}
 */
export function truncateText(text, maxLength = 100) {
  if (!text) return ""
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength) + "..."
}

/**
 * Cria campo de embed padronizado
 * @param {string} name - Nome do campo
 * @param {string} value - Valor
 * @param {boolean} inline - Inline
 * @returns {Object}
 */
export function createField(name, value, inline = false) {
  return { name, value: value || "N/A", inline }
}

/**
 * Converte string de valor monetário em número.
 * Aceita formatos BR ("30.000,00", "300,00") e EN ("30,000.00", "300.00") e sem separadores ("30000").
 * Retorna null se inválido.
 */
export function parseMoney(raw) {
  if (!raw) return null
  const s = raw.trim().replace(/\s/g, "")
  if (!s) return null

  const hasComma = s.includes(",")
  const hasDot   = s.includes(".")
  let num

  if (hasComma && hasDot) {
    // Determina qual é o separador decimal pelo último que aparece
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      // Vírgula é decimal BR: "30.000,00" → 30000
      num = parseFloat(s.replace(/\./g, "").replace(",", "."))
    } else {
      // Ponto é decimal EN: "30,000.00" → 30000
      num = parseFloat(s.replace(/,/g, ""))
    }
  } else if (hasComma && !hasDot) {
    const parts = s.split(",")
    if (parts.length === 2 && parts[1].length === 3 && /^\d+$/.test(parts[1])) {
      // "30,000" → milhar EN → 30000
      num = parseFloat(s.replace(/,/g, ""))
    } else {
      // "300,00" → decimal BR → 300
      num = parseFloat(s.replace(",", "."))
    }
  } else if (!hasComma && hasDot) {
    const parts = s.split(".")
    if (parts.length === 2 && parts[1].length === 3 && /^\d+$/.test(parts[1])) {
      // "30.000" → milhar BR → 30000
      num = parseFloat(s.replace(/\./g, ""))
    } else {
      // "300.00" → decimal EN → 300
      num = parseFloat(s)
    }
  } else {
    num = parseFloat(s)
  }

  return isNaN(num) ? null : num
}

// ─────────────────────────────────────────────
// TICKET EMBEDS
// ─────────────────────────────────────────────

export function createTicketEmbed(type, user) {
  const typeConfig = {
    suporte:  { color: COLORS.PRIMARY,  title: "🎫 Ticket de Suporte",  desc: "Nossa equipe está pronta para ajudá-lo." },
    duvidas:  { color: COLORS.INFO,     title: "❓ Ticket de Dúvidas",  desc: "Tire suas dúvidas com nossa equipe." },
    denuncia: { color: COLORS.DANGER,   title: "🚨 Ticket de Denúncia", desc: "Relate um problema ou denúncia." },
    anunciar: { color: COLORS.SUCCESS,  title: "📢 Anunciar Conta",     desc: "Preencha os dados para anunciar sua conta Minecraft." },
  }
  const cfg = typeConfig[type] ?? { color: COLORS.PRIMARY, title: type, desc: "Ticket criado." }

  return new EmbedBuilder()
    .setColor(cfg.color)
    .setTitle(cfg.title)
    .setDescription(`Olá ${user}, bem-vindo ao seu ticket!\n\n${cfg.desc}`)
    .addFields(
      { name: "Usuário", value: `${user} (${user.id})`, inline: true },
      { name: "Tipo", value: cfg.title, inline: true },
      { name: "Criado em", value: `<t:${Math.floor(Date.now() / 1000)}:F>`, inline: true },
      { name: "Staff Responsável", value: "Aguardando", inline: true },
    )
    .setFooter({ text: "Use o menu abaixo para gerenciar o ticket" })
    .setTimestamp()
}

export function createTicketPanelEmbed(guild) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setTitle("🎫 Central de Atendimento")
    .setDescription("Bem-vindo à central de atendimento!\nSelecione uma opção abaixo para abrir um ticket.")
    .addFields(
      { name: "🔧 Suporte", value: "Precisa de ajuda técnica ou tem algum problema.", inline: true },
      { name: "❓ Dúvidas", value: "Tem dúvidas sobre o servidor ou vendas.", inline: true },
      { name: "🚨 Denúncia", value: "Quer reportar um usuário ou atividade suspeita.", inline: true },
      { name: "📢 Anunciar Conta", value: "Quer vender sua conta Minecraft.", inline: true },
    )
    .setFooter({ text: "Selecione o tipo correto · Não abra tickets duplicados" })
    .setTimestamp()

  if (guild?.iconURL()) embed.setThumbnail(guild.iconURL({ extension: "webp", forceStatic: false, size: 256 }))
  return embed
}

// ─────────────────────────────────────────────
// ANÚNCIO EMBEDS
// ─────────────────────────────────────────────

export function createAnnouncementReviewEmbed(data, user) {
  const skin = getSkinUrls(data.uuid ?? data.nick)
  return new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle("📋 Novo Anúncio para Revisão")
    .setDescription(`**Vendedor:** ${user.username} (${user.id})\n**Nick:** ${data.nick}\n**Valor:** R$ ${formatValor(data.valor)}`)
    .setThumbnail(skin.avatar)
    .addFields(
      { name: "Bans", value: data.bans || "Não informado", inline: false },
      { name: "Capas", value: data.capas || "Nenhuma", inline: true },
      { name: "VIPs", value: data.vips || "Nenhum", inline: true },
      { name: "Tags", value: data.tags || "Nenhuma", inline: true },
      { name: "Medalhas", value: data.medalhas || "Nenhuma", inline: true },
      { name: "Wins/Level", value: data.winsLevel ?? data.wins_level ?? "N/A", inline: true },
      { name: "Cosméticos", value: data.cosmeticos || "Nenhum", inline: true },
    )
    .setFooter({ text: "Revise com atenção antes de aprovar" })
    .setTimestamp()
}

export function createPublicAnnouncementEmbed(announcement, user, sellerRating) {
  const namemc = `https://namemc.com/profile/${announcement.uuid}`
  const skin = getSkinUrls(announcement.uuid)

  let ratingText = "Sem avaliações"
  if (sellerRating?.count > 0) {
    const stars = "★".repeat(Math.round(sellerRating.average)) + "☆".repeat(5 - Math.round(sellerRating.average))
    ratingText = `${stars} (${sellerRating.average}/5 — ${sellerRating.count} aval.)`
  }

  const embed = new EmbedBuilder()
    .setColor(COLORS.PRIMARY)
    .setThumbnail(skin.body)
    .setDescription(
      `**Nick:** ${announcement.nick}\n` +
      `**NameMC:** [Ver perfil](${namemc})\n\n` +
      `**Bans:** ${announcement.bans || "Nenhum"}\n` +
      `**VIPs:** ${announcement.vips || "Nenhum"}\n` +
      `**Tags:** ${announcement.tags || "Nenhuma"}\n` +
      `**Medalhas:** ${announcement.medalhas || "Nenhuma"}\n` +
      `**Wins:** ${announcement.wins_level || "N/A"}\n` +
      `**Cosméticos:** ${announcement.cosmeticos || "Nenhum"}\n\n` +
      `**Valor:** R$ ${formatValor(announcement.valor)}\n` +
      `**Reputação do Vendedor:** ${ratingText}`
    )
    .setFooter({ text: `Vendedor: ${user.username} | ID: ${announcement.id}` })
    .setTimestamp()
  if (announcement.photo_url) embed.setImage(announcement.photo_url)
  return embed
}

// ─────────────────────────────────────────────
// NEGOCIAÇÃO EMBED
// ─────────────────────────────────────────────

export function createNegotiationEmbed(announcement, buyer, seller) {
  const namemc = `https://namemc.com/profile/${announcement.uuid}`
  const skin = getSkinUrls(announcement.uuid)

  return new EmbedBuilder()
    .setColor(COLORS.ESCROW)
    .setTitle("🤝 Negociação Iniciada")
    .setThumbnail(skin.body)
    .addFields(
      { name: "Comprador", value: `${buyer}`, inline: true },
      { name: "Vendedor", value: `${seller}`, inline: true },
      { name: "\u200B", value: "\u200B", inline: true },
      {
        name: "Conta",
        value: `**Nick:** ${announcement.nick}\n**NameMC:** [Ver perfil](${namemc})\n**Valor:** R$ ${formatValor(announcement.valor)}`,
        inline: false,
      },
      {
        name: "📋 Regras",
        value:
          "1. Não compartilhe informações pessoais\n" +
          "2. Use **\"Chamar Staff\"** se precisar de intermediário\n" +
          "3. Não faça pagamentos fora do servidor\n" +
          "4. Ao finalizar, clique **\"Venda Concluída\"**\n" +
          "5. Anexe comprovante de pagamento antes de confirmar",
        inline: false,
      },
    )
    .setFooter({ text: "Proteja-se contra scams — use o sistema de escrow" })
    .setTimestamp()
}

// ─────────────────────────────────────────────
// VENDA CONCLUÍDA
// ─────────────────────────────────────────────

export function createSaleCompletedEmbed(announcement, buyer, seller) {
  return new EmbedBuilder()
    .setColor(COLORS.SOLD)
    .setTitle("🎉 Venda Concluída!")
    .setDescription("A negociação foi finalizada com sucesso.")
    .addFields(
      { name: "Conta", value: announcement.nick, inline: true },
      { name: "Valor", value: `R$ ${formatValor(announcement.valor)}`, inline: true },
      { name: "Comprador", value: `<@${buyer}>`, inline: true },
      { name: "Vendedor", value: `<@${seller}>`, inline: true },
    )
    .setFooter({ text: "Obrigado! Avalie a transação abaixo." })
    .setTimestamp()
}

// ─────────────────────────────────────────────
// DMs MELHORADAS (fix #10) — com link e CTA
// ─────────────────────────────────────────────

export function buildApprovalDmEmbed(announcement, guild) {
  const namemc = `https://namemc.com/profile/${announcement.uuid}`
  const skin = getSkinUrls(announcement.uuid)
  return new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle("✅ Anúncio Aprovado!")
    .setDescription(`Seu anúncio da conta **${announcement.nick}** foi aprovado e publicado!`)
    .setThumbnail(skin.avatar)
    .addFields(
      { name: "Conta", value: announcement.nick, inline: true },
      { name: "Valor", value: `R$ ${formatValor(announcement.valor)}`, inline: true },
      { name: "NameMC", value: `[Ver perfil](${namemc})`, inline: true },
      { name: "📌 Próximos passos", value: "• Acompanhe seu anúncio no servidor\n• Use `/meusanuncios` para gerenciar\n• Faça bump em 24h para manter no topo", inline: false },
    )
    .setFooter({ text: guild?.name ?? "Servidor" })
    .setTimestamp()
}

export function buildRejectionDmEmbed(announcement, reason, guild) {
  return new EmbedBuilder()
    .setColor(COLORS.DANGER)
    .setTitle("❌ Anúncio Recusado")
    .setDescription(`Seu anúncio da conta **${announcement.nick}** foi recusado pela staff.`)
    .addFields(
      { name: "Conta", value: announcement.nick, inline: true },
      { name: "Valor", value: `R$ ${formatValor(announcement.valor)}`, inline: true },
      { name: "Motivo", value: reason, inline: false },
      { name: "📌 O que fazer", value: "Corrija os problemas apontados e abra um novo ticket de anúncio no servidor.", inline: false },
    )
    .setFooter({ text: guild?.name ?? "Servidor" })
    .setTimestamp()
}

export function buildBlacklistDmEmbed(reason, guild) {
  return new EmbedBuilder()
    .setColor(COLORS.DANGER)
    .setTitle("⛔ Você foi adicionado à Blacklist")
    .setDescription("Você não poderá criar anúncios ou negociar neste servidor enquanto estiver na blacklist.")
    .addFields(
      { name: "Motivo", value: reason, inline: false },
      { name: "Contestar", value: "Se acredita que foi um engano, entre em contato com a staff no servidor.", inline: false },
    )
    .setFooter({ text: guild?.name ?? "Servidor" })
    .setTimestamp()
}

export function buildBlacklistRemovedDmEmbed(guild) {
  return new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle("✅ Você foi removido da Blacklist")
    .setDescription("Você pode usar os serviços do servidor normalmente agora.\nVolte ao servidor para criar anúncios e negociar.")
    .setFooter({ text: guild?.name ?? "Servidor" })
    .setTimestamp()
}

export function buildNegotiationInterestDmEmbed(buyer, announcement, channel) {
  const skin = getSkinUrls(announcement.uuid)
  return new EmbedBuilder()
    .setColor(COLORS.INFO)
    .setTitle("💬 Novo Interesse no seu Anúncio!")
    .setThumbnail(skin.avatar)
    .setDescription(`**${buyer.username}** demonstrou interesse na sua conta **${announcement.nick}**!`)
    .addFields(
      { name: "Conta", value: announcement.nick, inline: true },
      { name: "Valor", value: `R$ ${formatValor(announcement.valor)}`, inline: true },
      { name: "Canal", value: `${channel}`, inline: false },
      { name: "📌 Ação necessária", value: "Entre no canal de negociação para conversar com o comprador.", inline: false },
    )
    .setTimestamp()
}

export function buildTicketClaimedDmEmbed(staffUser, channel, guild) {
  return new EmbedBuilder()
    .setColor(COLORS.SUCCESS)
    .setTitle("✅ Seu Ticket Foi Assumido")
    .setDescription("Um membro da staff está pronto para atendê-lo!")
    .addFields(
      { name: "Staff Responsável", value: staffUser.username, inline: true },
      { name: "Canal", value: `${channel}`, inline: false },
      { name: "📌 Ação necessária", value: "Retorne ao canal do ticket para continuar o atendimento.", inline: false },
    )
    .setFooter({ text: guild?.name ?? "Servidor" })
    .setTimestamp()
}

export function buildTicketReminderDmEmbed(staffUser, channel, guild) {
  return new EmbedBuilder()
    .setColor(COLORS.WARNING)
    .setTitle("⏰ Lembrete de Ticket")
    .setDescription("A staff está aguardando você no seu ticket!")
    .addFields(
      { name: "Staff", value: staffUser.username, inline: true },
      { name: "Canal", value: `${channel}`, inline: false },
      { name: "📌 Ação necessária", value: "Responda o mais rápido possível para não ter o ticket fechado por inatividade.", inline: false },
    )
    .setFooter({ text: guild?.name ?? "Servidor" })
    .setTimestamp()
}

export function buildSaleCompletedDmEmbed(announcement, role, partnerTag, guild) {
  // role: "buyer" | "seller"
  const isBuyer = role === "buyer"
  return new EmbedBuilder()
    .setColor(COLORS.SOLD)
    .setTitle("🎉 Venda Concluída!")
    .setDescription(isBuyer
      ? `Você comprou a conta **${announcement.nick}** com sucesso!`
      : `Você vendeu a conta **${announcement.nick}** com sucesso!`
    )
    .addFields(
      { name: "Conta", value: announcement.nick, inline: true },
      { name: "Valor", value: `R$ ${formatValor(announcement.valor)}`, inline: true },
      { name: isBuyer ? "Vendedor" : "Comprador", value: partnerTag, inline: true },
      { name: "📌 Próximos passos", value: "Não se esqueça de **avaliar a transação** no canal de negociação!", inline: false },
    )
    .setFooter({ text: guild?.name ?? "Servidor" })
    .setTimestamp()
}
