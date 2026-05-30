/**
 * transcript.js — v3
 *
 * Transcript em HTML com visual idêntico ao Discord:
 *  - Tema escuro, cores e fontes do Discord
 *  - Avatares dos usuários
 *  - Embeds renderizados com cor lateral, campos e thumbnail
 *  - Imagens e anexos inline
 *  - Badge BOT em mensagens de bot
 *  - Agrupamento de mensagens do mesmo autor (igual Discord)
 *  - Respostas (reply) renderizadas
 *  - Reactions
 *  - Timestamps em hover para mensagens agrupadas
 */

import { EmbedBuilder, AttachmentBuilder } from "discord.js"
import { fileLog } from "./fileLogger.js"

const MAX_MESSAGES = 2000

// ─────────────────────────────────────────────
// FETCH PAGINADO
// ─────────────────────────────────────────────

async function fetchAllMessages(channel, maxMessages = MAX_MESSAGES) {
  const allMessages = []
  let lastId = null
  while (allMessages.length < maxMessages) {
    const options = { limit: 100 }
    if (lastId) options.before = lastId
    const batch = await channel.messages.fetch(options)
    if (batch.size === 0) break
    allMessages.push(...batch.values())
    lastId = batch.last()?.id
    if (batch.size < 100) break
  }
  return allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp)
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function esc(str) {
  if (!str) return ""
  return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")
}

function md(text) {
  if (!text) return ""
  let t = esc(text)
  t = t.replace(/```[\w]*\n?([\s\S]+?)```/g,"<pre><code>$1</code></pre>")
  t = t.replace(/`([^`\n]+)`/g,"<code>$1</code>")
  t = t.replace(/\*\*\*(.+?)\*\*\*/g,"<strong><em>$1</em></strong>")
  t = t.replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>")
  t = t.replace(/\*(.+?)\*/g,"<em>$1</em>")
  t = t.replace(/__(.+?)__/g,"<u>$1</u>")
  t = t.replace(/_(.+?)_/g,"<em>$1</em>")
  t = t.replace(/~~(.+?)~~/g,"<s>$1</s>")
  t = t.replace(/^&gt; (.+)$/gm,"<div class=\"bq\">$1</div>")
  t = t.replace(/&lt;@!?(\d+)&gt;/g,"<span class=\"mention\">@usuário</span>")
  t = t.replace(/&lt;#(\d+)&gt;/g,"<span class=\"mention\">#canal</span>")
  t = t.replace(/&lt;@&amp;(\d+)&gt;/g,"<span class=\"mention\">@cargo</span>")
  t = t.replace(/(https?:\/\/[^\s<"]+)/g,'<a href="$1" target="_blank" rel="noopener">$1</a>')
  t = t.replace(/\n/g,"<br>")
  return t
}

function isImg(url) { return url && /\.(png|jpg|jpeg|gif|webp|svg)(\?.*)?$/i.test(url) }

function timeFull(ts) {
  return new Date(ts).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"})
}
function timeShort(ts) {
  return new Date(ts).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"})
}
function dateHeader(ts) {
  return new Date(ts).toLocaleDateString("pt-BR",{weekday:"long",day:"numeric",month:"long",year:"numeric"})
}

function avatarUrl(user) {
  if (!user) return "https://cdn.discordapp.com/embed/avatars/0.png"
  try { return user.displayAvatarURL({ extension:"png", size:64 }) } catch { return "https://cdn.discordapp.com/embed/avatars/0.png" }
}

function userColor(id) {
  const palette=["#5865F2","#57F287","#FEE75C","#EB459E","#ED4245","#3BA55C","#FAA61A","#9B59B6","#E67E22","#1ABC9C"]
  let h=0; for(const c of String(id)) h=(h*31+c.charCodeAt(0))>>>0
  return palette[h % palette.length]
}

// ─────────────────────────────────────────────
// RENDER EMBED
// ─────────────────────────────────────────────

function renderEmbed(embed) {
  const col = embed.color ? "#"+embed.color.toString(16).padStart(6,"0") : "#5865F2"
  let h = `<div class="embed" style="border-left-color:${col}">`

  if (embed.author) {
    h += `<div class="e-author">`
    if (embed.author.iconURL) h += `<img class="e-author-icon" src="${esc(embed.author.iconURL)}" alt="">`
    h += `<span>${esc(embed.author.name)}</span></div>`
  }

  const hasThumb = !!embed.thumbnail?.url
  if (hasThumb) h += `<div class="e-body">`

  if (embed.title) {
    h += embed.url
      ? `<div class="e-title"><a href="${esc(embed.url)}" target="_blank">${esc(embed.title)}</a></div>`
      : `<div class="e-title">${esc(embed.title)}</div>`
  }
  if (embed.description) h += `<div class="e-desc">${md(embed.description)}</div>`

  if (embed.fields?.length) {
    h += `<div class="e-fields">`
    for (const f of embed.fields) {
      h += `<div class="e-field${f.inline?" inline":""}">`
      h += `<div class="e-fname">${md(f.name)}</div>`
      h += `<div class="e-fval">${md(f.value)}</div>`
      h += `</div>`
    }
    h += `</div>`
  }

  if (hasThumb) {
    h += `</div>`
    h += `<img class="e-thumb" src="${esc(embed.thumbnail.url)}" alt="thumb" loading="lazy">`
  }

  if (embed.image?.url) h += `<div class="e-img-wrap"><img class="e-img" src="${esc(embed.image.url)}" alt="" loading="lazy"></div>`

  if (embed.footer) {
    h += `<div class="e-footer">`
    if (embed.footer.iconURL) h += `<img class="e-footer-icon" src="${esc(embed.footer.iconURL)}" alt="">`
    h += `<span>${esc(embed.footer.text)}</span>`
    if (embed.timestamp) h += ` <span class="e-sep">•</span> <span>${timeFull(embed.timestamp)}</span>`
    h += `</div>`
  }

  h += `</div>`
  return h
}

// ─────────────────────────────────────────────
// RENDER MESSAGE
// ─────────────────────────────────────────────

function renderMessage(msg, grouped, prevDate, curDate) {
  let h = ""
  if (prevDate !== curDate) {
    h += `<div class="date-sep"><hr><span>${curDate}</span><hr></div>`
  }

  const isBot = msg.author?.bot ?? false
  const uid = msg.author?.id ?? "0"
  const uname = msg.author?.username ?? "Desconhecido"
  const col = userColor(uid)
  const av = avatarUrl(msg.author)
  const tf = timeFull(msg.createdTimestamp)
  const ts = timeShort(msg.createdTimestamp)

  h += `<div class="msg${grouped?" grouped":""}">`

  if (grouped) {
    h += `<div class="ts-grouped" title="${tf}">${ts}</div>`
    h += `<div class="msg-body">`
  } else {
    h += `<img class="avatar" src="${esc(av)}" alt="${esc(uname)}" loading="lazy">`
    h += `<div class="msg-body">`
    h += `<div class="msg-header">`
    h += `<span class="author" style="color:${col}">${esc(uname)}</span>`
    if (isBot) h += `<span class="bot-tag">APP</span>`
    h += `<span class="msg-ts" title="${tf}">${tf}</span>`
    h += `</div>`
  }

  if (msg.reference?.messageId) {
    h += `<div class="reply"><span class="reply-arrow">↱</span> Respondendo a uma mensagem anterior</div>`
  }

  if (msg.content?.trim()) h += `<div class="msg-text">${md(msg.content)}</div>`

  for (const e of msg.embeds ?? []) h += renderEmbed(e)

  for (const [,att] of msg.attachments ?? new Map()) {
    if (isImg(att.url)) {
      h += `<div class="att-img-wrap"><img class="att-img" src="${esc(att.url)}" alt="${esc(att.name)}" loading="lazy"></div>`
    } else {
      const kb = att.size ? `(${(att.size/1024).toFixed(1)} KB)` : ""
      h += `<div class="att-file"><span>📎</span><a href="${esc(att.url)}" target="_blank">${esc(att.name)}</a> <span class="att-size">${kb}</span></div>`
    }
  }

  if (msg.reactions?.cache?.size > 0) {
    h += `<div class="reactions">`
    for (const [,r] of msg.reactions.cache) {
      const emoji = r.emoji.id
        ? `<img class="r-emoji" src="https://cdn.discordapp.com/emojis/${r.emoji.id}.png" alt="${esc(r.emoji.name)}">`
        : esc(r.emoji.name)
      h += `<div class="reaction">${emoji} <span>${r.count}</span></div>`
    }
    h += `</div>`
  }

  h += `</div></div>`
  return h
}

// ─────────────────────────────────────────────
// BUILD HTML
// ─────────────────────────────────────────────

function buildHtml(channelName, guildName, messages, closedBy) {
  const gen = new Date().toLocaleString("pt-BR")
  let body = ""
  let prevDate = null

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const prev = messages[i-1]
    const cur = dateHeader(msg.createdTimestamp)
    const sameAuthor = prev?.author?.id === msg.author?.id
    const withinTime = prev && (msg.createdTimestamp - prev.createdTimestamp) < 7*60*1000
    const noReply = !msg.reference?.messageId
    const grouped = sameAuthor && withinTime && noReply && cur === prevDate
    body += renderMessage(msg, grouped, prevDate, cur)
    prevDate = cur
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Transcript — #${esc(channelName)}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:#313338;color:#dcddde;font-family:"gg sans","Noto Sans",Whitney,"Helvetica Neue",Helvetica,Arial,sans-serif;font-size:16px;line-height:1.375}
a{color:#00aff4;text-decoration:none}a:hover{text-decoration:underline}
strong{font-weight:700}em{font-style:italic}u{text-decoration:underline}s{text-decoration:line-through}
code{font-family:Consolas,"Courier New",monospace;font-size:.875em;background:#1e1f22;padding:.2em .4em;border-radius:3px;color:#e3e5e8}
pre{background:#1e1f22;border:1px solid #1a1b1e;border-radius:4px;padding:.5em 1em;margin:4px 0;overflow-x:auto}
pre code{background:none;padding:0;font-size:.8125em}
.bq{border-left:4px solid #4e5058;padding-left:12px;margin:4px 0;color:#b5bac1}

/* Header */
.hdr{background:#1e1f22;border-bottom:1px solid #1a1b1e;padding:14px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:100}
.hdr-icon{font-size:22px;opacity:.8}
.hdr h1{font-size:.9375rem;font-weight:700;color:#f2f3f5}
.hdr-meta{font-size:.75rem;color:#949ba4;margin-top:2px}
.hdr-badge{margin-left:auto;background:#5865f2;color:#fff;font-size:.6875rem;font-weight:700;padding:3px 10px;border-radius:100px;letter-spacing:.04em}

/* Date separator */
.date-sep{display:flex;align-items:center;gap:8px;padding:16px 16px 4px;color:#949ba4;font-size:.75rem;font-weight:600}
.date-sep hr{flex:1;border:none;border-top:1px solid #3f4147}

/* Messages */
.msgs{padding:0 0 48px}
.msg{display:flex;gap:0;padding:2px 16px;position:relative;min-height:44px}
.msg:not(.grouped){margin-top:17px}
.msg:hover{background:rgba(4,4,5,.07)}
.avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;margin-right:16px;margin-top:2px;align-self:flex-start}
.msg.grouped .avatar{display:none}
.msg-body{flex:1;min-width:0;padding-left:56px}
.msg:not(.grouped) .msg-body{padding-left:0}
.msg-header{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.author{font-size:1rem;font-weight:500;cursor:pointer}
.author:hover{text-decoration:underline}
.bot-tag{background:#5865f2;color:#fff;font-size:.625rem;font-weight:700;padding:1px 5px;border-radius:3px;text-transform:uppercase;letter-spacing:.04em;vertical-align:middle}
.msg-ts{font-size:.75rem;color:#949ba4;font-weight:400}
.ts-grouped{position:absolute;left:16px;top:50%;transform:translateY(-50%);width:40px;font-size:.6875rem;color:#949ba4;text-align:right;opacity:0;transition:opacity .1s;user-select:none}
.msg.grouped:hover .ts-grouped{opacity:1}
.msg-text{color:#dcddde;font-size:1rem;word-break:break-word}
.reply{display:flex;align-items:center;gap:4px;font-size:.875rem;color:#949ba4;margin-bottom:4px}
.reply-arrow{color:#4e5058;font-size:1.1rem}
.mention{background:rgba(88,101,242,.3);color:#c9cdfb;padding:0 2px;border-radius:3px;font-weight:500}

/* Embeds */
.embed{margin-top:4px;max-width:520px;background:#2b2d31;border-left:4px solid #5865f2;border-radius:0 4px 4px 0;padding:12px 16px 16px 12px;position:relative;overflow:hidden}
.e-body{padding-right:88px}
.e-author{display:flex;align-items:center;gap:8px;font-size:.875rem;font-weight:600;margin-bottom:8px}
.e-author-icon{width:24px;height:24px;border-radius:50%;object-fit:cover}
.e-title{font-size:1rem;font-weight:700;color:#f2f3f5;margin-bottom:6px}
.e-title a{color:#00aff4}
.e-desc{font-size:.875rem;color:#dbdee1;line-height:1.4;margin-bottom:6px;white-space:pre-wrap;word-break:break-word}
.e-thumb{position:absolute;top:12px;right:16px;width:80px;height:80px;border-radius:4px;object-fit:cover}
.e-fields{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.e-field{flex:1 1 100%;min-width:0}
.e-field.inline{flex:1 1 calc(33% - 8px);min-width:90px}
.e-fname{font-size:.875rem;font-weight:700;color:#f2f3f5;margin-bottom:2px}
.e-fval{font-size:.875rem;color:#dbdee1;word-break:break-word}
.e-img-wrap{margin-top:10px}
.e-img{max-width:100%;max-height:300px;border-radius:4px;object-fit:contain;display:block}
.e-footer{display:flex;align-items:center;gap:6px;font-size:.75rem;color:#949ba4;margin-top:10px}
.e-footer-icon{width:16px;height:16px;border-radius:50%}
.e-sep{opacity:.6}

/* Attachments */
.att-img-wrap{margin-top:4px}
.att-img{max-width:min(500px,100%);max-height:300px;border-radius:4px;object-fit:contain;display:block}
.att-file{display:flex;align-items:center;gap:8px;background:#2b2d31;border:1px solid #1e1f22;border-radius:4px;padding:10px 12px;margin-top:4px;max-width:400px;font-size:.875rem}
.att-size{color:#949ba4;font-size:.75rem}

/* Reactions */
.reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.reaction{display:flex;align-items:center;gap:4px;background:rgba(88,101,242,.15);border:1px solid rgba(88,101,242,.3);border-radius:8px;padding:2px 8px;font-size:.875rem;color:#c9cdfb}
.r-emoji{width:18px;height:18px;object-fit:contain}

/* Footer */
.ftr{background:#1e1f22;border-top:1px solid #1a1b1e;padding:14px 20px;font-size:.75rem;color:#949ba4;text-align:center}

::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:#2b2d31}
::-webkit-scrollbar-thumb{background:#1a1b1e;border-radius:4px}
</style>
</head>
<body>
<header class="hdr">
  <div class="hdr-icon">#</div>
  <div>
    <h1>${esc(channelName)}</h1>
    <div class="hdr-meta">${esc(guildName)} &nbsp;·&nbsp; ${messages.length} mensagens &nbsp;·&nbsp; Fechado por ${esc(String(closedBy))} &nbsp;·&nbsp; ${gen}</div>
  </div>
  <div class="hdr-badge">TRANSCRIPT</div>
</header>
<main class="msgs">${body}</main>
<footer class="ftr">Transcript gerado automaticamente &nbsp;·&nbsp; ${esc(guildName)} &nbsp;·&nbsp; ${gen}</footer>
</body>
</html>`
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

export async function generateTranscript(channel) {
  try {
    const messages = await fetchAllMessages(channel)
    const guildName = channel.guild?.name ?? "Servidor"
    return buildHtml(channel.name, guildName, messages, "Sistema")
  } catch (err) {
    fileLog.error({ err: err.message }, "[TRANSCRIPT] Erro ao gerar transcript")
    return null
  }
}

export async function sendTranscriptToLogs(client, logsChannelId, transcript, channelName, closedBy) {
  try {
    const logsChannel = await client.channels.fetch(logsChannelId)
    if (!logsChannel) return

    const closedByStr = typeof closedBy === "object" ? (closedBy?.username ?? String(closedBy)) : String(closedBy)
    const msgCount = (transcript.match(/class="msg[" ]/g) ?? []).length

    const buf = Buffer.from(transcript, "utf-8")
    const file = new AttachmentBuilder(buf, {
      name: `transcript-${channelName}-${Date.now()}.html`,
      description: `Transcript do ticket #${channelName}`,
    })

    const embed = new EmbedBuilder()
      .setColor("#5865F2")
      .setTitle("📄 Ticket Fechado — Transcript")
      .setDescription(`O ticket **#${channelName}** foi fechado.`)
      .addFields(
        { name: "Canal",       value: `#${channelName}`,  inline: true },
        { name: "Fechado por", value: closedByStr,         inline: true },
        { name: "Mensagens",   value: String(msgCount),    inline: true },
      )
      .setFooter({ text: "Abra o arquivo .html no navegador para visualizar" })
      .setTimestamp()

    await logsChannel.send({ embeds: [embed], files: [file] })
  } catch (err) {
    fileLog.error({ err: err.message }, "[TRANSCRIPT] Erro ao enviar transcript")
  }
}
