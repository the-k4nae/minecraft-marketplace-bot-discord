/**
 * events/interactionCreate.js — v5
 *
 * Melhoria v5: middleware centralizado de permissões.
 *
 * Antes: cada handler validava individualmente se o usuário era staff.
 *   Risco: handler novo esquecer a checagem → escalação de privilégio silenciosa.
 *
 * Agora: checkPermissions() executa ANTES do roteamento para ações sensíveis.
 *   Se falhar, rejeita antes de chegar no handler — impossível contornar.
 */

import { MessageFlags } from "discord.js"

// ─── Handlers ──────────────────────────────────────────────────────────────

import {
  handleSetupPainelCommand, handleTicketCommand,
  handleTicketButton, handleTicketActions, handleCloseTicketAction,
  handleConfirmCloseTicket, handleCancelCloseTicket, handleAddUserModalSubmit,
} from "../handlers/ticketHandler.js"

import {
  handleAnnouncementButton, handleAnnouncementModal,
  handleAnnouncementFinalModal, handleRejectReasonModal,
} from "../handlers/anuncioHandler.js"

import {
  handleNegotiationButton, handleRatingSubmit,
} from "../handlers/negotiationHandler.js"

import {
  handleMakeOffer, handleOfferSubmit,
  handleOfferResponse, handleCounterOfferSubmit,
} from "../handlers/salesHandler.js"

import {
  handleStaffCommand, handleStaffPanelSection, handleStaffQuickButton,
  handleBlacklistButton, handleBlacklistAddSubmit,
  handleBlacklistRemoveSubmit, handleBlacklistCheckSubmit,
  handleAnnouncementsButton, handleStatsButton,
  handleConfigButton, handleConfigSubmit,
} from "../handlers/staffHandler.js"

import {
  handleAlertasCommand, handleAlertasButton,
  handleAlertasCriarSubmit, handleAlertasDeletarSubmit,
} from "../handlers/alertasHandler.js"
import { handleRejectionTemplateSelect } from "../handlers/rejectionTemplates.js"

import {
  handleMeusAnunciosCommand, handleMeusAnunciosSelect,
  handleMeusAnunciosBack, handleMeusAnunciosRefresh,
  handleManageAnuncioButton, handleEditSubmit,
  handleReserveSubmit,
} from "../handlers/meusAnunciosHandler.js"

import {
  handleBuscarCommand, handlePaginationButton,
} from "../handlers/buscaHandler.js"
import { handlePerfilCommand, handleReputacaoCommand } from "../handlers/perfilHandler.js"
import { handleRankingCommand }  from "../handlers/rankingHandler.js"
import { handleStatsCommand }    from "../handlers/statsHandler.js"
import { handleVerificarContaCommand, handleAjudaCommand } from "../handlers/commandHandler.js"
import { execute as handleNotificarCommand } from "../commands/notificar.js"
import { execute as handleSetupAnuncioCommand } from "../commands/setupanuncio.js"

import { handleMinhasComprasCommand } from "../handlers/salesHandler.js"
import {
  handleFavoriteButton, handleMeusFavoritosCommand,
  handleFavoritesPage, handleFavoritesRefresh, handleFavoriteDetail,
} from "../handlers/favoritosHandler.js"
import {
  handlePixStaffAction,
  handlePaymentProofSubmit as handlePixProofSubmit,
} from "../handlers/pixVerificationHandler.js"
import {
  handleMiddlemanButton, handleMiddlemanNoteSubmit,
} from "../handlers/middlemanHandler.js"
import { updateChannelActivity } from "../utils/database.js"
import { logError } from "../utils/logger.js"
import { fileLogError } from "../utils/fileLogger.js"
import { handleAdminRestart, handleAdminIgnore } from "../utils/errorAlerter.js"
import { trackBuyerActivity } from "../utils/negotiationTimeout.js"

// ─── Middleware de Permissões ───────────────────────────────────────────────

/**
 * IDs de botões/comandos que exigem cargo de staff.
 * Qualquer ação que começa com um desses prefixos requer permissão.
 *
 * Por que prefixos e não IDs exatos?
 * O customId inclui parâmetros dinâmicos (ex: "approve_123").
 * Verificar o prefixo garante cobertura mesmo com novos IDs.
 */
const STAFF_BUTTON_PREFIXES = [
  "approve_", "reject_",        // aprovar/rejeitar anúncios
  "staff_",                     // painel de staff (qualquer ação)
  "pix_approve", "pix_flag",    // verificação de PIX
  "mm_accept", "mm_reject",     // aceitar/rejeitar middleman
  "mm_resolve",                  // resolver disputa
  "ann_editlog",                 // histórico de edições (staff)
]

// Select menus que exigem cargo de staff
const STAFF_SELECT_MENUS = [
  "reject_template_select",     // template de recusa de anúncio
]

const STAFF_MODAL_IDS = [
  "staff_bl_add_submit",
  "staff_bl_remove_submit",
  "staff_bl_check_submit",
  "staff_config_submit",
]

const STAFF_COMMANDS = [
  "setuppainel",
  "setupanuncio",
]

/**
 * Verifica se uma interação requer permissão de staff.
 * Retorna { required: false } se não requer, ou { required: true, passed: boolean } se requer.
 */
function checkPermissions(interaction, client) {
  const staffRoleId = client.config?.roles?.staff
  if (!staffRoleId) return { required: false }

  const isStaff = () => interaction.member?.roles?.cache?.has(staffRoleId) ?? false

  // Slash commands restritos
  if (interaction.isChatInputCommand() && STAFF_COMMANDS.includes(interaction.commandName)) {
    return { required: true, passed: isStaff() }
  }

  // Botões restritos
  if (interaction.isButton()) {
    const id = interaction.customId
    const needsStaff = STAFF_BUTTON_PREFIXES.some(prefix => id.startsWith(prefix))
    if (needsStaff) return { required: true, passed: isStaff() }
  }

  // Select menus restritos
  if (interaction.isStringSelectMenu()) {
    if (STAFF_SELECT_MENUS.includes(interaction.customId)) {
      return { required: true, passed: isStaff() }
    }
  }

  // Modals restritos
  if (interaction.isModalSubmit() && STAFF_MODAL_IDS.includes(interaction.customId)) {
    return { required: true, passed: isStaff() }
  }

  return { required: false }
}

// ─── Main Handler ───────────────────────────────────────────────────────────

export default async function interactionCreate(interaction, client) {
  try {

    // Ignorar interações fora de servidores (DMs)
    if (!interaction.guild) {
      if (interaction.isRepliable()) {
        return interaction.reply({ content: "Este bot funciona apenas em servidores.", flags: MessageFlags.Ephemeral }).catch(() => {})
      }
      return
    }

    // ─── Middleware de permissões ───────────────────────────────────────────
    const perm = checkPermissions(interaction, client)
    if (perm.required && !perm.passed) {
      const msg = { content: "❌ Você não tem permissão para executar esta ação.", flags: MessageFlags.Ephemeral }
      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) await interaction.followUp(msg).catch(() => {})
        else await interaction.reply(msg).catch(() => {})
      }
      return
    }

    // ─── SLASH COMMANDS ────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName
      if (cmd === "ticket")         return await handleTicketCommand(interaction, client)
      if (cmd === "setuppainel")    return await handleSetupPainelCommand(interaction, client)
      if (cmd === "staff")          return await handleStaffCommand(interaction, client)
      if (cmd === "alertas")        return await handleAlertasCommand(interaction, client)
      if (cmd === "meusanuncios")   return await handleMeusAnunciosCommand(interaction, client)
      if (cmd === "buscar")         return await handleBuscarCommand(interaction, client)
      if (cmd === "verificarconta") return await handleVerificarContaCommand(interaction, client)
      if (cmd === "perfil")         return await handlePerfilCommand(interaction, client)
      if (cmd === "reputacao")      return await handleReputacaoCommand(interaction, client)
      if (cmd === "ranking")        return await handleRankingCommand(interaction, client)
      if (cmd === "stats")          return await handleStatsCommand(interaction, client)
      if (cmd === "meusfavoritos")  return await handleMeusFavoritosCommand(interaction, client)
      if (cmd === "minhascompras")  return await handleMinhasComprasCommand(interaction, client)
      if (cmd === "ajuda")          return await handleAjudaCommand(interaction, client)
      if (cmd === "notificar")      return await handleNotificarCommand(interaction, client)
      if (cmd === "setupanuncio")   return await handleSetupAnuncioCommand(interaction, client)
      return
    }

    // ─── SELECT MENUS ──────────────────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
      const id = interaction.customId
      if (id === "ticket_actions")         return await handleTicketActions(interaction, client)
      if (id === "staff_panel_section")    return await handleStaffPanelSection(interaction, client)
      if (id === "meusanuncios_select")    return await handleMeusAnunciosSelect(interaction, client)
      if (id === "reject_template_select") return await handleRejectionTemplateSelect(interaction, client)
      return
    }

    // ─── BUTTONS ───────────────────────────────────────────────────────────
    if (interaction.isButton()) {
      const customId = interaction.customId

      // Registrar atividade do canal
      if (interaction.channelId) updateChannelActivity(interaction.channelId)

      // Rastrear atividade do comprador em negociações (para timeout automático)
      // Não aguarda: usa import() dinâmico internamente — bloquear aqui expiraria a interaction (10062)
      trackBuyerActivity(interaction).catch(() => {})

      // Botões de admin — erros críticos (errorAlerter)
      if (customId === "admin_restart_bot")  return await handleAdminRestart(interaction, client)
      if (customId === "admin_ignore_error") return await handleAdminIgnore(interaction)

      const [action, ...params] = customId.split("_")

      // Paginação
      if (action === "page") {
        const direction = params[0]
        const stateId   = params.slice(1).join("_")
        if (direction === "prev" || direction === "next") {
          return await handlePaginationButton(interaction, direction, stateId)
        }
        return
      }

      // Ticket
      if (action === "ticket")                            return await handleTicketButton(interaction, params, client)
      if (action === "close" && params[0] === "ticket")   return await handleCloseTicketAction(interaction, client)
      if (action === "confirmclose")                      return await handleConfirmCloseTicket(interaction, client)
      if (action === "cancelclose")                       return await handleCancelCloseTicket(interaction, client)

      // Negociação
      if (action === "interest") return await handleNegotiationButton(interaction, "interest", params, client)
      if (action === "neg")      return await handleNegotiationButton(interaction, "neg",      params, client)
      if (action === "escrow")   return await handleNegotiationButton(interaction, "escrow",   params, client)
      if (action === "rate")     return await handleNegotiationButton(interaction, "rate",     params, client)

      // Aprovar/rejeitar anúncios (staff — já verificado no middleware)
      if (action === "approve" || action === "reject") {
        return await handleAnnouncementButton(interaction, action, params, client)
      }

      // Histórico de edições de anúncio (staff — já verificado no middleware)
      if (action === "ann" && params[0] === "editlog") {
        return await handleAnnouncementButton(interaction, action, params, client)
      }

      // Botões de formulário de anúncio
      if (action === "announce") {
        // Preview confirm/cancel/addphoto
        if (params[0] === "confirm") {
          const { handleAnnouncementPreviewConfirm } = await import("../handlers/anuncioHandler.js")
          return await handleAnnouncementPreviewConfirm(interaction, params.slice(1).join("_"), client)
        }
        if (params[0] === "cancel") {
          const { handleAnnouncementPreviewCancel } = await import("../handlers/anuncioHandler.js")
          return await handleAnnouncementPreviewCancel(interaction, params.slice(1).join("_"))
        }
        if (params[0] === "addphoto") {
          const { handleAnnouncementAddPhoto } = await import("../handlers/anuncioHandler.js")
          return await handleAnnouncementAddPhoto(interaction, params.slice(1).join("_"))
        }
        return await handleAnnouncementButton(interaction, action, params, client)
      }
      if (action === "open" && params[0] === "modal2")      return await handleAnnouncementButton(interaction, action, params, client)

      // Staff panel (já verificado no middleware)
      if (action === "staff") {
        const sub = params[0]
        if (sub === "quick")  return await handleStaffQuickButton(interaction, params.slice(1).join("_"), client)
        if (sub === "bl")     return await handleBlacklistButton(interaction, params.slice(1).join("_"), client)
        if (sub === "ann")    return await handleAnnouncementsButton(interaction, params.slice(1).join("_"), client)
        if (sub === "stats")  return await handleStatsButton(interaction, params.slice(1).join("_"), client)
        if (sub === "config") return await handleConfigButton(interaction, params.slice(1).join("_"), client)
      }

      // Alertas
      if (action === "alertas") return await handleAlertasButton(interaction, params.join("_"), client)

      // Meus anúncios
      if (action === "meusanuncios") {
        if (params[0] === "back")    return await handleMeusAnunciosBack(interaction, client)
        if (params[0] === "refresh") return await handleMeusAnunciosRefresh(interaction, client)
      }

      // Gerenciar anúncio
      if (action === "man") {
        const manAction = params.slice(0, -1).join("_")
        const manId     = parseInt(params[params.length - 1])
        if (!isNaN(manId)) return await handleManageAnuncioButton(interaction, manAction, manId, client)
      }

      // Favoritos
      if (action === "fav") {
        const sub = params[0]
        if (sub === "toggle")  return await handleFavoriteButton(interaction, params.slice(1), client)
        if (sub === "page")    return await handleFavoritesPage(interaction, params.slice(1), client)
        if (sub === "refresh") return await handleFavoritesRefresh(interaction, client)
        if (sub === "detail")  return await handleFavoriteDetail(interaction, params.slice(1), client)
        return
      }

      // PIX (staff — já verificado no middleware)
      if (action === "pix") {
        const sub     = params[0]
        const proofId = parseInt(params[1])
        if (!isNaN(proofId)) return await handlePixStaffAction(interaction, sub, proofId, client)
        return
      }

      // Ofertas
      if (action === "offer") {
        const sub = params[0]
        if (sub === "make")                                return await handleMakeOffer(interaction, client)
        if (sub === "accept" || sub === "reject")          return await handleOfferResponse(interaction, sub, params[1], client)
        if (sub === "counter")                             return await handleOfferResponse(interaction, "counter", params[1], client)
      }

      // Middleman
      const MM_ACTIONS = ["mm_request", "mm_accept", "mm_reject", "mm_approve", "mm_dispute", "mm_resolve_buyer", "mm_resolve_seller", "mm_resolve_cancel", "mm_note"]
      if (MM_ACTIONS.includes(customId)) {
        return await handleMiddlemanButton(interaction, customId, client)
      }

      return
    }

    // ─── MODALS ────────────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      const id = interaction.customId
      const [action, ...params] = id.split("_")

      if (action === "announce" && params[0] === "submit") return await handleAnnouncementModal(interaction, params, client)
      if (action === "announce" && params[0] === "final")  return await handleAnnouncementFinalModal(interaction, params, client)
      if (action === "announce" && params[0] === "photo") {
        const { handleAnnouncementPhotoModalSubmit } = await import("../handlers/anuncioHandler.js")
        return await handleAnnouncementPhotoModalSubmit(interaction, params.slice(1).join("_"), client)
      }
      if (action === "reject"   && params[0] === "reason") return await handleRejectReasonModal(interaction, params.slice(1), client)
      if (action === "rating"   && params[0] === "submit") return await handleRatingSubmit(interaction, params.slice(1), client)

      if (action === "neg" && params[0] === "proof" && params[1] === "submit") {
        return await handlePixProofSubmit(interaction, params.slice(2), client)
      }

      if (action === "offer" && params[0] === "submit")        return await handleOfferSubmit(interaction, params.slice(1), client)
      if (action === "offer" && params[0] === "countersubmit") return await handleCounterOfferSubmit(interaction, params.slice(1), client)

      if (id === "mm_note_submit")             return await handleMiddlemanNoteSubmit(interaction, client)

      // Staff modals (já verificado no middleware)
      if (id === "staff_bl_add_submit")        return await handleBlacklistAddSubmit(interaction, client)
      if (id === "staff_bl_remove_submit")     return await handleBlacklistRemoveSubmit(interaction, client)
      if (id === "staff_bl_check_submit")      return await handleBlacklistCheckSubmit(interaction, client)
      if (id === "staff_config_submit")        return await handleConfigSubmit(interaction, client)

      if (id === "alertas_criar_submit")       return await handleAlertasCriarSubmit(interaction, client)
      if (id === "alertas_deletar_submit")     return await handleAlertasDeletarSubmit(interaction, client)

      if (action === "man" && params[0] === "edit"       && params[1] === "submit") return await handleEditSubmit(interaction, params.slice(2), client)
      if (action === "man" && params[0] === "editextras" && params[1] === "submit") return await handleEditSubmit(interaction, ["extras", ...params.slice(2)], client)
      if (action === "man" && params[0] === "reserve"    && params[1] === "submit") return await handleReserveSubmit(interaction, params.slice(2), client)

      if (action === "adduser"   && params[0] === "modal")  return await handleAddUserModalSubmit(interaction, params.slice(1), client)

      return
    }

    if (interaction.isMessageComponent() && interaction.channelId) {
      updateChannelActivity(interaction.channelId)
    }

  } catch (error) {
    const ctx = [
      interaction.isChatInputCommand()  ? `/${interaction.commandName}` : null,
      interaction.isButton()            ? `btn:${interaction.customId}` : null,
      interaction.isStringSelectMenu()  ? `sel:${interaction.customId}` : null,
      interaction.isModalSubmit()       ? `modal:${interaction.customId}` : null,
      `user:${interaction.user?.id}`,
      interaction.guildId   ? `guild:${interaction.guildId}` : null,
      interaction.channelId ? `ch:${interaction.channelId}`  : null,
    ].filter(Boolean).join(" | ")

    fileLogError(ctx, error)
    logError(client, ctx, error).catch(() => {})

    const msg = { content: "⚠️ Erro ao processar sua solicitação. Tente novamente.", flags: MessageFlags.Ephemeral }
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg)
      else await interaction.reply(msg)
    } catch { /* ignorar */ }
  }
}
