/**
 * FEATURE 2 — Edição de foto do anúncio
 *
 * Permite ao vendedor trocar a screenshot do anúncio sem recriá-lo.
 * Fluxo: /meusanuncios → selecionar anúncio → botão "📷 Trocar Foto"
 *        → instrução para enviar arquivo → bot captura o attachment → atualiza no canal
 *
 * ── Como aplicar ──────────────────────────────────────────────────────────────
 * 1. Cole handlePhotoEditButton e handlePhotoMessage neste arquivo em handlers/meusAnunciosHandler.js
 * 2. Em events/interactionCreate.js, adicione rota para "man_photo_ID":
 *      if (action === "man" && params[0] === "photo") {
 *        return handlePhotoEditButton(interaction, parseInt(params[1]), client)
 *      }
 * 3. Em index.js, adicione o listener de messageCreate para capturar o attachment:
 *      client.on("messageCreate", msg => handlePhotoMessage(msg, client))
 * 4. No buildManageAnuncioComponents() do meusAnunciosHandler, adicione o botão:
 *      new ButtonBuilder()
 *        .setCustomId(`man_photo_${announcementId}`)
 *        .setLabel("📷 Trocar Foto")
 *        .setStyle(ButtonStyle.Secondary)
 */

import {
  MessageFlags,
} from "discord.js"
import {
  getAnnouncement, updateAnnouncement, updateAnnouncementPhoto, addLog,
  getUserAverageRating,
} from "../utils/database.js"
import {
  CV2_EPHEMERAL, CV2, container, text, separator, section, thumbnail, mediaGallery,
  createRow, createButton, buildPublicAnnouncement, COLORS,
} from "../utils/components.js"
import { logAction } from "../utils/logger.js"
import { fileLog } from "../utils/fileLogger.js"

// Map<userId, { announcementId, channelId, expiresAt }>
const _pendingPhotoEdits = new Map()
const PHOTO_EDIT_TTL_MS = 5 * 60 * 1000  // 5 minutos para enviar

/**
 * Handler do botão "📷 Trocar Foto".
 * Coloca o usuário em modo de espera de foto no canal atual.
 */
export async function handlePhotoEditButton(interaction, announcementId, client) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral })

  const announcement = getAnnouncement(announcementId)
  if (!announcement) return interaction.editReply({ content: "❌ Anúncio não encontrado." })
  if (announcement.user_id !== interaction.user.id) return interaction.editReply({ content: "❌ Este anúncio não é seu." })
  if (!["approved", "pending"].includes(announcement.status)) {
    return interaction.editReply({ content: "❌ Só é possível trocar a foto de anúncios ativos ou pendentes." })
  }

  // Registrar sessão de espera
  _pendingPhotoEdits.set(interaction.user.id, {
    announcementId,
    channelId: interaction.channelId,
    expiresAt: Date.now() + PHOTO_EDIT_TTL_MS,
  })

  // Limpar expirado após TTL
  setTimeout(() => {
    const pending = _pendingPhotoEdits.get(interaction.user.id)
    if (pending?.announcementId === announcementId) {
      _pendingPhotoEdits.delete(interaction.user.id)
    }
  }, PHOTO_EDIT_TTL_MS)

  const c = container(COLORS.INFO)
    .addTextDisplayComponents(
      text(
        `## 📷 Envie a Nova Foto\n` +
        `Envie **uma imagem** neste canal nos próximos **5 minutos**.\n\n` +
        `**Requisitos:**\n` +
        `• Formato: PNG, JPG ou WebP\n` +
        `• Tamanho: até 8 MB\n` +
        `• Deve mostrar claramente a conta **${announcement.nick}**\n\n` +
        `_Envie qualquer outra mensagem para cancelar._`
      )
    )
  await interaction.editReply({ flags: CV2_EPHEMERAL, components: [c] })
}

/**
 * Listener de messageCreate para capturar o attachment.
 * Adicionar em index.js:
 *   client.on("messageCreate", msg => handlePhotoMessage(msg, client))
 */
export async function handlePhotoMessage(message, client) {
  if (message.author.bot) return

  const pending = _pendingPhotoEdits.get(message.author.id)
  if (!pending) return
  if (message.channelId !== pending.channelId) return

  // Sessão expirada
  if (Date.now() > pending.expiresAt) {
    _pendingPhotoEdits.delete(message.author.id)
    return
  }

  // Cancelamento explícito por texto sem imagem
  if (message.attachments.size === 0) {
    _pendingPhotoEdits.delete(message.author.id)
    await message.reply({ content: "❌ Edição de foto cancelada." })
    return
  }

  // Validar attachment
  const attachment = message.attachments.first()
  const validTypes = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"]

  if (!validTypes.includes(attachment.contentType)) {
    await message.reply({ content: "❌ Formato inválido. Envie uma imagem PNG, JPG, WebP ou GIF." })
    return
  }

  if (attachment.size > 8 * 1024 * 1024) {
    await message.reply({ content: "❌ Imagem muito grande. Máximo: 8 MB." })
    return
  }

  _pendingPhotoEdits.delete(message.author.id)

  const announcement = getAnnouncement(pending.announcementId)
  if (!announcement) {
    await message.reply({ content: "❌ Anúncio não encontrado." })
    return
  }

  // ── Arquivar foto no canal de mídia (igual ao fluxo de criação) ───────────
  let persistentPhotoUrl = attachment.url  // URL temporária como fallback

  try {
    const config = client.config
    if (config.channels?.mediaArchive) {
      const archiveCh = await client.channels.fetch(config.channels.mediaArchive).catch(() => null)
      if (archiveCh) {
        const archived = await archiveCh.send({
          content: `📷 Foto atualizada — anúncio #${announcement.id} (${announcement.nick}) por <@${message.author.id}>`,
          files: [{ attachment: attachment.url, name: attachment.name }],
        })
        persistentPhotoUrl = archived.attachments.first()?.url ?? attachment.url
      }
    }
  } catch (err) {
    fileLog.warn({ err: err.message }, "[PHOTO_EDIT] Falha ao arquivar foto")
  }

  // ── Salvar nova URL no banco ──────────────────────────────────────────────
  updateAnnouncementPhoto(announcement.id, persistentPhotoUrl)
  addLog("announcement_photo_updated", message.author.id, String(announcement.id),
    `Nova foto: ${persistentPhotoUrl}`)

  // ── Atualizar mensagem no canal de anúncios (se aprovado) ─────────────────
  if (announcement.status === "approved" && announcement.message_id) {
    try {
      const config = client.config
      const annCh = await client.channels.fetch(config.channels.anuncios).catch(() => null)
      if (annCh) {
        const annMsg = await annCh.messages.fetch(announcement.message_id).catch(() => null)
        if (annMsg) {
          // Re-buscar do banco com foto atualizada e reconstruir o container CV2
          const updated = getAnnouncement(announcement.id)
          const seller = await client.users.fetch(updated.user_id).catch(() => null)
          const rating = getUserAverageRating(updated.user_id)
          const rebuilt = buildPublicAnnouncement(updated, seller, rating)
          await annMsg.edit(rebuilt)
        }
      }
    } catch (err) {
      fileLog.warn({ err: err.message }, "[PHOTO_EDIT] Falha ao atualizar mensagem")
    }
  }

  await logAction(client, "announcement_edited", {
    userId: message.author.id,
    targetId: String(announcement.id),
    details: `**Nick:** ${announcement.nick}\n**Campo:** Foto\n**Ação:** Foto atualizada`,
  })

  const successC = container(COLORS.SUCCESS)
    .addTextDisplayComponents(text(`## ✅ Foto Atualizada!\nA foto do anúncio **${announcement.nick}** foi atualizada com sucesso.`))
    .addMediaGalleryComponents(mediaGallery(persistentPhotoUrl))
  await message.reply({ components: [successC] })
}

/**
 * Para adicionar o botão no painel de gerenciamento, inclua em buildManageAnuncioComponents():
 *
 *   // Dentro do ActionRowBuilder de ações principais:
 *   new ButtonBuilder()
 *     .setCustomId(`man_photo_${announcementId}`)
 *     .setLabel("📷 Trocar Foto")
 *     .setStyle(ButtonStyle.Secondary)
 */
