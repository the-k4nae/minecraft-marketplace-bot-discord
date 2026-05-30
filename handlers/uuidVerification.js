/**
 * FEATURE 5 — Verificação de UUID via API Mojang em tempo real na aprovação
 *
 * Problema: o UUID é validado na criação do anúncio, mas entre criação e aprovação
 * a conta pode ter sido deletada, migrada (UUID muda) ou transferida para outro nick.
 *
 * Solução: re-verificar via API Mojang no momento da aprovação pela staff.
 * Se o nick não bater com o UUID armazenado → bloquear aprovação com alerta.
 *
 * ── Como aplicar ──────────────────────────────────────────────────────────────
 * Substitua o início de approveAnnouncementAction() em handlers/anuncioHandler.js
 * pela versão com verificação abaixo.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js"
import { getPlayerUUID, getSkinUrls } from "../utils/minecraftAPI.js"

/**
 * Verifica se o nick do anúncio ainda bate com o UUID armazenado.
 * Retorna { ok, currentUuid, currentNick, warning }
 */
export async function verifyAnnouncementUUID(announcement) {
  // Sem UUID no anúncio → não é possível verificar
  if (!announcement.uuid) {
    return { ok: true, warning: "UUID não informado no anúncio — verificação pulada." }
  }

  const result = await getPlayerUUID(announcement.nick)

  // API Mojang com rate limit → não bloquear, apenas avisar
  if (result === "RATE_LIMITED") {
    return {
      ok: true,
      warning: "⚠️ API Mojang com rate limit — verificação de UUID não pôde ser concluída agora.",
    }
  }

  // Nick não existe mais na Mojang
  if (result === null) {
    return {
      ok: false,
      reason: "nick_not_found",
      message: `O nick **${announcement.nick}** não existe mais na API Mojang. A conta pode ter sido deletada ou o nick alterado.`,
    }
  }

  const currentUuid  = result.uuid.replace(/-/g, "")  // normalizar formato
  const storedUuid   = announcement.uuid.replace(/-/g, "")
  const currentNick  = result.name

  // UUID mudou — conta diferente
  if (currentUuid !== storedUuid) {
    return {
      ok: false,
      reason: "uuid_mismatch",
      currentUuid,
      currentNick,
      message:
        `O nick **${announcement.nick}** está associado a outro UUID agora.\n` +
        `**UUID armazenado:** \`${storedUuid}\`\n` +
        `**UUID atual:**      \`${currentUuid}\`\n` +
        `Possível fraude: conta trocou de dono ou o nick foi reutilizado.`,
    }
  }

  // Nick capitalização diferente (ex: "Steve" → "steve") — inofensivo mas vale registrar
  if (currentNick !== announcement.nick) {
    return {
      ok: true,
      warning: `Nick com capitalização diferente: anúncio usa "${announcement.nick}", Mojang retornou "${currentNick}".`,
      currentNick,
    }
  }

  return { ok: true, currentNick, currentUuid }
}

/**
 * Injetar no início de approveAnnouncementAction() em handlers/anuncioHandler.js:
 *
 * async function approveAnnouncementAction(interaction, announcementId, client) {
 *   await interaction.deferReply({ flags: MessageFlags.Ephemeral })
 *   const config = client.config
 *   const announcement = getAnnouncement(announcementId)
 *
 *   if (!announcement) return interaction.editReply({ content: "Anúncio não encontrado." })
 *   if (announcement.status !== "pending") return interaction.editReply({ content: "Este anúncio já foi processado." })
 *
 *   // ── INSERIR AQUI ──────────────────────────────────────────────────────
 *   const uuidCheck = await verifyAnnouncementUUID(announcement)
 *
 *   if (!uuidCheck.ok) {
 *     // Alertar staff e BLOQUEAR aprovação
 *     await sendAntiScamAlert(client, "duplicate_uuid", {
 *       userId: announcement.user_id,
 *       targetId: String(announcementId),
 *       details: uuidCheck.message,
 *       thumbnail: getSkinUrls(announcement.uuid).head,
 *     })
 *
 *     const embed = new EmbedBuilder()
 *       .setColor("#FF0000")
 *       .setTitle("🚨 Aprovação Bloqueada — UUID Inválido")
 *       .setDescription(uuidCheck.message)
 *       .addFields(
 *         { name: "Anúncio ID", value: String(announcementId), inline: true },
 *         { name: "Nick",       value: announcement.nick,       inline: true },
 *         { name: "Ação",       value: "Rejeite este anúncio. O vendedor deverá recriar com os dados corretos.", inline: false },
 *       )
 *       .setTimestamp()
 *
 *     return interaction.editReply({ embeds: [embed] })
 *   }
 *
 *   if (uuidCheck.warning) {
 *     // Apenas aviso — aprovação pode continuar
 *     await interaction.followUp({
 *       content: `⚠️ **Aviso:** ${uuidCheck.warning}`,
 *       flags: MessageFlags.Ephemeral,
 *     }).catch(() => {})
 *   }
 *   // ── FIM DA INSERÇÃO ───────────────────────────────────────────────────
 *
 *   // ... resto do código de aprovação original ...
 * }
 */

/**
 * Exemplo de embed que a staff vê quando o UUID não bate:
 *
 * ┌─────────────────────────────────────────────────────┐
 * │ 🚨 Aprovação Bloqueada — UUID Inválido              │
 * │                                                     │
 * │ O nick Steve está associado a outro UUID agora.     │
 * │ UUID armazenado: `abc123`                           │
 * │ UUID atual:      `xyz789`                           │
 * │ Possível fraude: conta trocou de dono ou nick foi   │
 * │ reutilizado.                                        │
 * │                                                     │
 * │ Anúncio ID  │  Nick   │  Ação                       │
 * │ 42          │  Steve  │  Rejeite este anúncio...    │
 * └─────────────────────────────────────────────────────┘
 */
