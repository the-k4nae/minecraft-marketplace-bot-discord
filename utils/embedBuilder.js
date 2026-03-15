/**
 * embedBuilder.js — v4
 *
 * Fixes:
 *  - getSkinUrls agora é export (fix #2)
 *  - DMs com call-to-action e link de volta ao servidor (fix #10)
 */

import { EmbedBuilder } from "discord.js"
import { getSkinUrls } from "./minecraftAPI.js"
import {
  build, text, sep, section, thumb, box,
  C2_FLAG, C2_EPHEMERAL,
} from "./cv2.js"

export const COLORS = {
  PRIMARY: "#5865F2",
  SUCCESS: "#00D166",
  DANGER: "#FF4444",
  WARNING: "#FFA500",
  INFO: "#7289DA",
  GOLD: "#FFD700",
  DARK: "#2C2F33",
  SOLD: "#9B59B6",
  EXPIRED: "#95A5A6",
  ESCROW: "#3498DB",
}

/** Formata número para moeda BRL, ex: 200 → "200,00", 1500.5 → "1.500,50" */
export function formatValor(v) {
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

  if (guild?.iconURL()) embed.setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
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
    .setDescription(`**Vendedor:** ${user.tag} (${user.id})\n**Nick:** ${data.nick}\n**Valor:** R$ ${formatValor(data.valor)}`)
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

  return new EmbedBuilder()
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
    .setDescription(`**${buyer.tag}** demonstrou interesse na sua conta **${announcement.nick}**!`)
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
      { name: "Staff Responsável", value: staffUser.tag, inline: true },
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
      { name: "Staff", value: staffUser.tag, inline: true },
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


// ─────────────────────────────────────────────
// COMPONENTS v2 — BUILDERS (retornam ContainerBuilder)
// ─────────────────────────────────────────────

/** Ticket panel em C2 */
export function buildTicketPanelC2(guild) {
  const iconUrl = guild?.iconURL({ dynamic: true, size: 256 })
  const descText =
    "## 🎫 Central de Atendimento\n\n" +
    "Bem-vindo à central de atendimento!\n" +
    "Selecione uma opção abaixo para abrir um ticket.\n\n" +
    "🔧 **Suporte** — Ajuda técnica ou problema\n" +
    "❓ **Dúvidas** — Perguntas sobre o servidor ou vendas\n" +
    "🚨 **Denúncia** — Reportar usuário ou atividade suspeita\n" +
    "📢 **Anunciar Conta** — Vender sua conta Minecraft\n\n" +
    "-# Selecione o tipo correto · Não abra tickets duplicados"

  const children = []
  if (iconUrl) {
    children.push(section(descText, thumb(iconUrl)))
  } else {
    children.push(text(descText))
  }
  return build(children, 0x5865F2)
}

/** Ticket embed em C2 */
export function buildTicketC2(type, user, botUser = null) {
  const typeConfig = {
    suporte:  { color: 0x5865F2,  label: "🔧 Ticket de Suporte",  desc: "Nossa equipe está pronta para ajudá-lo." },
    duvidas:  { color: 0x7289DA,  label: "❓ Ticket de Dúvidas",  desc: "Tire suas dúvidas com nossa equipe." },
    denuncia: { color: 0xFF4444,  label: "🚨 Ticket de Denúncia", desc: "Relate um problema ou denúncia." },
    anunciar: { color: 0x00D166,  label: "📢 Anunciar Conta",     desc: "Preencha os dados para anunciar sua conta Minecraft." },
  }
  const cfg = typeConfig[type] ?? { color: 0x5865F2, label: type, desc: "Ticket criado." }
  const ts = Math.floor(Date.now() / 1000)
  const content =
    `## ${cfg.label}\n\n` +
    `Olá <@${user.id}>, bem-vindo ao seu ticket!\n${cfg.desc}\n\n` +
    `👤 **Usuário:** <@${user.id}> (${user.id})\n` +
    `🏷️ **Tipo:** ${cfg.label}\n` +
    `📅 **Criado em:** <t:${ts}:F>\n` +
    `🛠️ **Staff:** Aguardando\n\n` +
    `-# Use o menu abaixo para gerenciar o ticket`
  return build([text(content)], cfg.color)
}

/** Anúncio revisão em C2 (para staff) */
export function buildAnnouncementReviewC2(data, user) {
  const skin = getSkinUrls(data.uuid ?? data.nick)
  const content =
    `## 📋 Novo Anúncio para Revisão\n\n` +
    `**Vendedor:** ${user.tag} (${user.id})  **Nick:** ${data.nick}  **Valor:** R$ ${formatValor(data.valor)}\n\n` +
    `**Bans:** ${data.bans || "Não informado"}\n` +
    `**Capas:** ${data.capas || "Nenhuma"}   **VIPs:** ${data.vips || "Nenhum"}   **Tags:** ${data.tags || "Nenhuma"}\n` +
    `**Medalhas:** ${data.medalhas || "Nenhuma"}   **Wins/Level:** ${data.winsLevel ?? data.wins_level ?? "N/A"}   **Cosméticos:** ${data.cosmeticos || "Nenhum"}\n\n` +
    `-# Revise com atenção antes de aprovar`
  return build([section(content, thumb(skin.avatar))], 0xFFA500)
}

/** Anúncio público em C2 */
export function buildPublicAnnouncementC2(announcement, user, sellerRating) {
  const namemc = `https://namemc.com/profile/${announcement.uuid}`
  const skin = getSkinUrls(announcement.uuid)
  let ratingText = "Sem avaliações"
  if (sellerRating?.count > 0) {
    const stars = "★".repeat(Math.round(sellerRating.average)) + "☆".repeat(5 - Math.round(sellerRating.average))
    ratingText = `${stars} (${sellerRating.average}/5 — ${sellerRating.count} aval.)`
  }
  const content =
    `**Nick:** ${announcement.nick}   **NameMC:** [Ver perfil](${namemc})\n\n` +
    `**Bans:** ${announcement.bans || "Nenhum"}   **VIPs:** ${announcement.vips || "Nenhum"}   **Tags:** ${announcement.tags || "Nenhuma"}\n` +
    `**Medalhas:** ${announcement.medalhas || "Nenhuma"}   **Wins:** ${announcement.wins_level || "N/A"}   **Cosméticos:** ${announcement.cosmeticos || "Nenhum"}\n\n` +
    `💰 **Valor:** R$ ${formatValor(announcement.valor)}\n` +
    `⭐ **Reputação do Vendedor:** ${ratingText}\n\n` +
    `-# Vendedor: ${user.username} | ID: ${announcement.id}`
  return build([section(content, thumb(skin.body))], 0x5865F2)
}

/** Negociação em C2 */
export function buildNegotiationC2(announcement, buyer, seller) {
  const namemc = `https://namemc.com/profile/${announcement.uuid}`
  const skin = getSkinUrls(announcement.uuid)
  const content =
    `## 🤝 Negociação Iniciada\n\n` +
    `👤 **Comprador:** <@${buyer.id}>   💼 **Vendedor:** <@${seller.id}>\n\n` +
    `**Conta:** ${announcement.nick}   **NameMC:** [Ver perfil](${namemc})   **Valor:** R$ ${formatValor(announcement.valor)}\n\n` +
    `**📋 Regras**\n` +
    `> 1. Não compartilhe informações pessoais\n` +
    `> 2. Use **"Chamar Staff"** se precisar de intermediário\n` +
    `> 3. Não faça pagamentos fora do servidor\n` +
    `> 4. Ao finalizar, use **"Venda Concluída"**\n` +
    `> 5. Anexe comprovante de pagamento antes de confirmar\n\n` +
    `-# Proteja-se contra scams — use o sistema de escrow`
  return build([section(content, thumb(skin.body))], 0x3498DB)
}

/** Venda concluída em C2 */
export function buildSaleCompletedC2(announcement, buyer, seller) {
  const content =
    `## 🎉 Venda Concluída!\n\n` +
    `A negociação foi finalizada com sucesso.\n\n` +
    `**Conta:** ${announcement.nick}   **Valor:** R$ ${formatValor(announcement.valor)}\n` +
    `**Comprador:** <@${buyer}>   **Vendedor:** <@${seller}>\n\n` +
    `-# Obrigado! Avalie a transação abaixo.`
  return build([text(content)], 0x9B59B6)
}

/** Staff main panel em C2 */
export function buildStaffPanelC2(guild, stats, pendingCount, suspiciousCount) {
  const iconUrl = guild?.iconURL({ dynamic: true })
  const content =
    `## ⚙️ Painel de Gerenciamento — Staff\n\n` +
    `Selecione uma seção abaixo para gerenciar o servidor.\n\n` +
    `**🎫 Tickets**\n` +
    `> Abertos: **${stats.openTickets}** · Fechados: **${stats.closedTickets}** · Total: **${stats.totalTickets}**\n\n` +
    `**📢 Anúncios**\n` +
    `> Pendentes: **${stats.pendingAnnouncements}** ${stats.pendingAnnouncements > 0 ? "⚠️" : "✅"}  Ativos: **${stats.activeAnnouncements}**  Vendidos: **${stats.soldAnnouncements}**\n\n` +
    `**🤝 Negociações**\n` +
    `> Ativas: **${stats.totalNegotiations - stats.completedNegotiations}**  Concluídas: **${stats.completedNegotiations}**\n\n` +
    `**🚨 Atenção**\n` +
    `> Blacklist: **${stats.blacklistedUsers}** usuários  Suspeitos: **${suspiciousCount}** ${suspiciousCount > 0 ? "⚠️" : "✅"}  Reservas ativas: **${stats.activeReservations ?? 0}**`
  const children = iconUrl ? [section(content, thumb(iconUrl))] : [text(content)]
  return build(children, 0x5865F2)
}

/** Blacklist panel em C2 */
export function buildBlacklistPanelC2(blacklist) {
  let content = `## 🚫 Gerenciamento de Blacklist\n\n`
  if (blacklist.length === 0) {
    content += "A blacklist está vazia."
  } else {
    content += `**${blacklist.length}** usuário(s) bloqueados atualmente.\n\n`
    for (const entry of blacklist.slice(0, 10)) {
      const date = new Date(entry.created_at).toLocaleDateString("pt-BR")
      content += `**<@${entry.user_id}>**\nMotivo: ${entry.reason}  Por: <@${entry.created_by}>  Data: ${date}\n\n`
    }
    if (blacklist.length > 10) content += `-# Mostrando 10 de ${blacklist.length} usuários`
  }
  return build([text(content)], 0xFF4444)
}

/** Painel de anúncios do usuário em C2 */
export function buildMeusAnunciosC2(user, all) {
  const STATUS_LABEL = { pending: "⏳ Pendente", approved: "✅ Ativo", rejected: "❌ Recusado", sold: "💸 Vendido", expired: "⌛ Expirado" }
  const active = all.filter(a => a.status === "approved")
  const pending = all.filter(a => a.status === "pending")
  const sold = all.filter(a => a.status === "sold")
  const totalValue = sold.reduce((s, a) => s + parseFloat(a.valor || 0), 0)

  let content =
    `## 📋 Meus Anúncios\n\n` +
    `Total: **${all.length}**  ·  Ativos: **${active.length}**  ·  Pendentes: **${pending.length}**  ·  Vendidos: **${sold.length}**\n` +
    `💰 Valor total vendido: **R$ ${formatValor(totalValue)}**\n\n`

  for (const a of all.slice(0, 10)) {
    const status = STATUS_LABEL[a.status] || a.status
    const date = new Date(a.created_at).toLocaleDateString("pt-BR")
    const bump = a.bumped_at ? `  Bump: <t:${Math.floor(new Date(a.bumped_at).getTime() / 1000)}:R>` : ""
    content += `**#${a.id} — ${a.nick}** ${status}  R$ ${formatValor(a.valor)}  ${date}${bump}\n`
  }
  if (all.length > 10) content += `\n-# Mostrando 10 de ${all.length}`
  return build([section(content, thumb(user.displayAvatarURL({ dynamic: true })))], 0x5865F2)
}

/** Detalhe de anúncio em C2 */
export function buildAnuncioDetailC2(a, reservation, autoBump) {
  const STATUS_LABEL = { pending: "⏳ Pendente", approved: "✅ Ativo", rejected: "❌ Recusado", sold: "💸 Vendido", expired: "⌛ Expirado" }
  const skin = getSkinUrls(a.uuid)
  const status = STATUS_LABEL[a.status] || a.status
  const bumped = a.bumped_at ? `<t:${Math.floor(new Date(a.bumped_at).getTime() / 1000)}:R>` : "Nunca"
  const reservaStr = reservation
    ? `Reservado para <@${reservation.buyer_id}> até <t:${Math.floor(new Date(reservation.expires_at).getTime() / 1000)}:R>`
    : "Sem reserva"

  const content =
    `## 📢 Anúncio #${a.id} — ${a.nick}\n\n` +
    `**Status:** ${status}   **Valor:** R$ ${formatValor(a.valor)}   **Nick:** ${a.nick}\n` +
    `**VIPs:** ${a.vips || "Nenhum"}   **Capas:** ${a.capas || "Nenhuma"}   **Tags:** ${a.tags || "Nenhuma"}\n` +
    `**Último Bump:** ${bumped}   **Auto-Bump:** ${autoBump?.active ? "✅ Ativo" : "❌ Inativo"}\n` +
    `**Reserva:** ${reservaStr}`
  return build([section(content, thumb(skin.avatar))], 0x5865F2)
}

/** Alertas do usuário em C2 */
export function buildAlertasPanelC2(user, alerts) {
  const avatarUrl = user.displayAvatarURL({ dynamic: true })
  let content = `## 🔔 Meus Alertas de Interesse\n\n`
  if (alerts.length === 0) {
    content += "Você não tem alertas ativos.\n\nCrie um alerta para ser notificado por DM quando um anúncio corresponder aos seus filtros."
  } else {
    content += `Você tem **${alerts.length}/10** alertas ativos.\nVocê será notificado por DM quando um novo anúncio corresponder.\n\n`
    for (const a of alerts.slice(0, 10)) {
      const f = a.filters
      const parts = [
        f.nick ? `Nick contém: \`${f.nick}\`` : null,
        f.minPrice ? `Mín: R$ ${f.minPrice}` : null,
        f.maxPrice ? `Máx: R$ ${f.maxPrice}` : null,
        f.vip ? `VIP/Tag: \`${f.vip}\`` : null,
      ].filter(Boolean).join("  ·  ")
      const last = a.last_triggered_at
        ? `<t:${Math.floor(new Date(a.last_triggered_at).getTime() / 1000)}:R>`
        : "Nunca disparado"
      content += `**Alerta #${a.id}** — ${parts || "Qualquer anúncio"}  |  Último disparo: ${last}\n`
    }
  }
  return build([section(content, thumb(avatarUrl))], 0x7289DA)
}

/** Favoritos em C2 */
export function buildFavoritosPanelC2(user, favorites) {
  const avatarUrl = user.displayAvatarURL({ dynamic: true })
  let content = `## ❤️ Meus Favoritos\n\n`
  if (favorites.length === 0) {
    content += "Você não tem anúncios favoritos.\n\nClique em ❤️ em qualquer anúncio para favoritar."
  } else {
    content += `Você tem **${favorites.length}** anúncio(s) favoritado(s).\n\n`
    for (const f of favorites.slice(0, 15)) {
      const STATUS_ICON = { approved: "✅", pending: "⏳", sold: "💸", rejected: "❌", expired: "⌛" }
      const icon = STATUS_ICON[f.status] || "❓"
      content += `${icon} **${f.nick}** — R$ ${formatValor(f.valor)} | ID #${f.id}\n`
    }
    if (favorites.length > 15) content += `\n-# Mostrando 15 de ${favorites.length}`
  }
  return build([section(content, thumb(avatarUrl))], 0xE74C3C)
}

// Re-exports for convenient import
export { build, text, sep, section, thumb, box, C2_FLAG, C2_EPHEMERAL }
