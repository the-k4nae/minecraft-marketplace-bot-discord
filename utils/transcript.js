/**
 * transcript.js — v2
 *
 * FIX #5: Transcript paginado — busca TODAS as mensagens do canal,
 * não apenas as últimas 100.
 * O Discord.js aceita no máximo 100 por request, então pagina
 * usando o parâmetro `before` com o ID da última mensagem buscada.
 */

import { EmbedBuilder, AttachmentBuilder } from "discord.js"

const MAX_MESSAGES = 2000  // Limite razoável para evitar travamento em canais antigos

/**
 * Busca todas as mensagens de um canal com paginação.
 * @param {import("discord.js").TextChannel} channel
 * @param {number} maxMessages - Limite máximo de mensagens
 * @returns {Promise<import("discord.js").Message[]>}
 */
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

    if (batch.size < 100) break  // Última página
  }

  return allMessages.sort((a, b) => a.createdTimestamp - b.createdTimestamp)
}

/**
 * Gera transcript completo do canal.
 * @param {import("discord.js").TextChannel} channel
 * @returns {Promise<string|null>}
 */
export async function generateTranscript(channel) {
  try {
    const messages = await fetchAllMessages(channel)

    let transcript = `=== TRANSCRIPT DO TICKET: #${channel.name} ===\n`
    transcript += `Data: ${new Date().toLocaleString("pt-BR")}\n`
    transcript += `Total de mensagens: ${messages.length}\n`
    transcript += `${"=".repeat(60)}\n\n`

    for (const msg of messages) {
      const timestamp = new Date(msg.createdTimestamp).toLocaleString("pt-BR")
      const author = msg.author ? `${msg.author.tag} (${msg.author.id})` : "Desconhecido"
      let content = msg.content || ""

      if (msg.embeds.length > 0) {
        for (const embed of msg.embeds) {
          if (embed.title) content += `\n[Embed: ${embed.title}]`
          if (embed.description) content += `\n${embed.description.substring(0, 500)}`
          for (const field of embed.fields ?? []) {
            content += `\n  [${field.name}]: ${field.value}`
          }
        }
      }

      if (msg.attachments.size > 0) {
        for (const [, att] of msg.attachments) {
          content += `\n[Anexo: ${att.name} — ${att.url}]`
        }
      }

      if (msg.components.length > 0) {
        content += `\n[Mensagem com botões/componentes]`
      }

      if (content.trim()) {
        transcript += `[${timestamp}] ${author}:\n${content.trim()}\n\n`
      }
    }

    transcript += `${"=".repeat(60)}\n`
    transcript += `=== FIM DO TRANSCRIPT (${messages.length} mensagens) ===\n`

    return transcript
  } catch (error) {
    console.error("[TRANSCRIPT] Erro ao gerar transcript:", error.message)
    return null
  }
}

/**
 * Envia transcript para o canal de logs como arquivo .txt.
 */
export async function sendTranscriptToLogs(client, logsChannelId, transcript, channelName, closedBy) {
  try {
    const logsChannel = await client.channels.fetch(logsChannelId)
    if (!logsChannel) return

    const buffer = Buffer.from(transcript, "utf-8")
    const file = new AttachmentBuilder(buffer, {
      name: `transcript-${channelName}-${Date.now()}.txt`,
      description: `Transcript do ticket #${channelName}`,
    })

    const embed = new EmbedBuilder()
      .setColor("#FF6B6B")
      .setTitle("📄 Ticket Fechado — Transcript")
      .setDescription(`O ticket **#${channelName}** foi fechado por ${closedBy}.`)
      .addFields(
        { name: "Canal", value: `#${channelName}`, inline: true },
        { name: "Fechado por", value: closedBy, inline: true },
        { name: "Mensagens", value: `${transcript.split("\n[").length - 1} mensagens`, inline: true },
      )
      .setTimestamp()

    await logsChannel.send({ embeds: [embed], files: [file] })
  } catch (error) {
    console.error("[TRANSCRIPT] Erro ao enviar transcript:", error.message)
  }
}
