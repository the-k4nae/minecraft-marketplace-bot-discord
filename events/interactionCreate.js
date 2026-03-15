/**
 * interactionCreate.js — v4
 *
 * Router central de todas as interações Discord.
 * Todos os subcomandos foram substituídos por painéis interativos.
 *
 * Novos handlers roteados:
 *  - negotiationHandler (interest, escrow, callstaff, comprovante, venda concluída)
 *  - commandHandler (paginação persistente page_prev/next)
 */

// ─── Imports ──────────────────────────────────────────────────────────────
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
  handleNegotiationButton, handleRatingSubmit, handleNegActionsSelect,
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

import {
  handleMeusAnunciosCommand, handleMeusAnunciosSelect,
  handleMeusAnunciosBack, handleMeusAnunciosRefresh,
  handleManageAnuncioButton, handleEditSubmit,
  handleReserveSubmit, handleManActionsSelect,
} from "../handlers/meusAnunciosHandler.js"

import {
  handleStatsCommand, handleReputacaoCommand, handleBuscarCommand,
  handlePerfilCommand, handleRankingCommand, handleVerificarContaCommand,
  handlePaginationButton,
} from "../handlers/commandHandler.js"

import { handleMinhasComprasCommand } from "../handlers/salesHandler.js"
import {
  handleFavoriteButton, handleMeusFavoritosCommand,
  handleFavoritesPage, handleFavoritesRefresh, handleFavoriteDetail,
} from "../handlers/favoritosHandler.js"
import {
  handlePixStaffAction,
  handlePaymentProofSubmit as handlePixProofSubmit,
} from "../handlers/pixVerificationHandler.js"
import { updateChannelActivity } from "../utils/database.js"
import { logError } from "../utils/logger.js"

// ─── Main Handler ───────────────────────────────────────────────────────────

export default async function interactionCreate(interaction, client) {
  try {

    // FIX A-10: Ignorar interações fora de servidores (DMs) para evitar guild null
    if (!interaction.guild) {
      if (interaction.isRepliable()) {
        return interaction.reply({ content: "Este bot funciona apenas em servidores.", flags: MessageFlags.Ephemeral }).catch(() => {})
      }
      return
    }

    // ─── SLASH COMMANDS ────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      const cmd = interaction.commandName
      if (cmd === "ticket")         return await handleTicketCommand(interaction, client)
      if (cmd === "setuppainel")    return await handleSetupPainelCommand(interaction, client)
      if (cmd === "staff")          return await handleStaffCommand(interaction, client)
      if (cmd === "perfil")         return await handlePerfilCommand(interaction, client)
      if (cmd === "reputacao")      return await handleReputacaoCommand(interaction, client)
      if (cmd === "buscar")         return await handleBuscarCommand(interaction, client)
      if (cmd === "meusanuncios")   return await handleMeusAnunciosCommand(interaction, client)
      if (cmd === "ranking")        return await handleRankingCommand(interaction, client)
      if (cmd === "verificarconta") return await handleVerificarContaCommand(interaction, client)
      if (cmd === "minhascompras")  return await handleMinhasComprasCommand(interaction, client)
      if (cmd === "meufavoritos")   return await handleMeusFavoritosCommand(interaction, client)
      if (cmd === "alertas")        return await handleAlertasCommand(interaction, client)
      if (cmd === "stats")          return await handleStatsCommand(interaction, client)
      return
    }

    // ─── SELECT MENUS ──────────────────────────────────────────────────────
    if (interaction.isStringSelectMenu()) {
    // Meus anúncios — ações do anúncio
    if (interaction.customId.startsWith("man_actions_")) {
      const announcementId = parseInt(interaction.customId.split("_")[2])
      return await handleManActionsSelect(interaction, announcementId, client)
    }
    // Negociação — ações do select menu
    if (interaction.customId === "neg_actions") {
      return await handleNegActionsSelect(interaction, client)
    }
      const id = interaction.customId
      if (id === "ticket_actions")       return await handleTicketActions(interaction, client)
      if (id === "staff_panel_section")  return await handleStaffPanelSection(interaction, client)
      if (id === "meusanuncios_select")  return await handleMeusAnunciosSelect(interaction, client)
      return
    }

    // ─── BUTTONS ───────────────────────────────────────────────────────────
    if (interaction.isButton()) {
      const customId = interaction.customId

      // Registrar atividade do canal para anti-inatividade (fix #13)
      if (interaction.channelId) {
        updateChannelActivity(interaction.channelId)
      }

      const [action, ...params] = customId.split("_")

      // Paginação persistente (fix #11)
      if (action === "page") {
        const direction = params[0] // prev | next | info
        const stateId   = params.slice(1).join("_")
        if (direction === "prev" || direction === "next") {
          return await handlePaginationButton(interaction, direction, stateId)
        }
        return // page_info é disabled, não faz nada
      }

      // Ticket
      if (action === "ticket")                                return await handleTicketButton(interaction, params, client)
      if (action === "close" && params[0] === "ticket")       return await handleCloseTicketAction(interaction, client)

      // Confirm/cancel close
      if (action === "confirmclose") return await handleConfirmCloseTicket(interaction, client)
      if (action === "cancelclose")  return await handleCancelCloseTicket(interaction, client)

      // Negotiation — interesse no anúncio
      if (action === "interest")    return await handleNegotiationButton(interaction, "interest", params, client)

      // Negotiation — botões dentro do canal (neg_complete, neg_cancel, neg_callstaff, etc)
      if (action === "neg")         return await handleNegotiationButton(interaction, "neg", params, client)

      // Escrow
      if (action === "escrow")      return await handleNegotiationButton(interaction, "escrow", params, client)

      // Ratings
      if (action === "rate")        return await handleNegotiationButton(interaction, "rate", params, client)

      // Approve/reject anúncios (staff)
      if (action === "approve" || action === "reject") {
        return await handleAnnouncementButton(interaction, action, params, client)
      }

      // Announcement form buttons
      if (action === "announce")                              return await handleAnnouncementButton(interaction, action, params, client)
      if (action === "open" && params[0] === "modal2")        return await handleAnnouncementButton(interaction, action, params, client)

      // Staff panel
      if (action === "staff") {
        const sub = params[0]
        if (sub === "quick")  return await handleStaffQuickButton(interaction, params.slice(1).join("_"), client)
        if (sub === "bl")     return await handleBlacklistButton(interaction, params.slice(1).join("_"), client)
        if (sub === "ann")    return await handleAnnouncementsButton(interaction, params.slice(1).join("_"), client)
        if (sub === "stats")  return await handleStatsButton(interaction, params.slice(1).join("_"), client)
        if (sub === "config") return await handleConfigButton(interaction, params.slice(1).join("_"), client)
        // Suspicious panel pagination: staff_sus_next_N / staff_sus_prev_N / staff_sus_info
        if (sub === "sus")    return await handleStaffQuickButton(interaction, params.join("_"), client)
      }

      // Alertas
      if (action === "alertas")     return await handleAlertasButton(interaction, params.join("_"), client)

      // Meus anúncios
      if (action === "meusanuncios") {
        if (params[0] === "back")    return await handleMeusAnunciosBack(interaction, client)
        if (params[0] === "refresh") return await handleMeusAnunciosRefresh(interaction, client)
      }

      // Manage anúncio (man_edit_ID, man_bump_ID, etc.)
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

      // Verificação PIX — botões de staff
      if (action === "pix") {
        const sub = params[0] // "approve" | "flag"
        const proofId = parseInt(params[1])
        if (!isNaN(proofId)) return await handlePixStaffAction(interaction, sub, proofId, client)
        return
      }

      // Offers
      if (action === "offer") {
        const sub = params[0]
        if (sub === "make")    return await handleMakeOffer(interaction, client)
        if (sub === "accept" || sub === "reject") return await handleOfferResponse(interaction, sub, params[1], client)
        if (sub === "counter") return await handleOfferResponse(interaction, "counter", params[1], client)
      }

      return
    }

    // ─── MODALS ────────────────────────────────────────────────────────────
    if (interaction.isModalSubmit()) {
      const id = interaction.customId
      const [action, ...params] = id.split("_")

      // Announcement creation flow
      if (action === "announce" && params[0] === "submit") return await handleAnnouncementModal(interaction, params, client)
      if (action === "announce" && params[0] === "final")  return await handleAnnouncementFinalModal(interaction, params, client)
      if (action === "reject"   && params[0] === "reason") return await handleRejectReasonModal(interaction, params.slice(1), client)

      // Ratings
      if (action === "rating" && params[0] === "submit")   return await handleRatingSubmit(interaction, params.slice(1), client)

      // Payment proof — roteado para pixVerificationHandler (suporta verificação PIX)
      if (action === "neg" && params[0] === "proof" && params[1] === "submit") {
        return await handlePixProofSubmit(interaction, params.slice(2), client)
      }

      // Offers
      if (action === "offer" && params[0] === "submit")        return await handleOfferSubmit(interaction, params.slice(1), client)
      if (action === "offer" && params[0] === "countersubmit") return await handleCounterOfferSubmit(interaction, params.slice(1), client)

      // Staff modals
      if (id === "staff_bl_add_submit")    return await handleBlacklistAddSubmit(interaction, client)
      if (id === "staff_bl_remove_submit") return await handleBlacklistRemoveSubmit(interaction, client)
      if (id === "staff_bl_check_submit")  return await handleBlacklistCheckSubmit(interaction, client)
      if (id === "staff_config_submit")    return await handleConfigSubmit(interaction, client)

      // Alertas modals
      if (id === "alertas_criar_submit")   return await handleAlertasCriarSubmit(interaction, client)
      if (id === "alertas_deletar_submit") return await handleAlertasDeletarSubmit(interaction, client)

      // Meus anúncios modals
      if (action === "man" && params[0] === "edit"    && params[1] === "submit") return await handleEditSubmit(interaction, params.slice(2), client)
      if (action === "man" && params[0] === "reserve" && params[1] === "submit") return await handleReserveSubmit(interaction, params.slice(2), client)

      // Ticket - adicionar usuário via modal (FIX A-7)
      if (action === "adduser" && params[0] === "modal") return await handleAddUserModalSubmit(interaction, params.slice(1), client)

      return
    }

    // ─── MENSAGENS (rastrear atividade para anti-inatividade) ────────────
    if (interaction.isMessageComponent() && interaction.channelId) {
      updateChannelActivity(interaction.channelId)
    }

  } catch (error) {
    // FIX #14: contexto completo da interação no log de erro
    const ctx = [
      interaction.isChatInputCommand()  ? `/${interaction.commandName}` : null,
      interaction.isButton()            ? `btn:${interaction.customId}` : null,
      interaction.isStringSelectMenu()  ? `sel:${interaction.customId}` : null,
      interaction.isModalSubmit()       ? `modal:${interaction.customId}` : null,
      `user:${interaction.user?.id}`,
      interaction.guildId ? `guild:${interaction.guildId}` : null,
      interaction.channelId ? `ch:${interaction.channelId}` : null,
    ].filter(Boolean).join(" | ")

    console.error(`[INTERAÇÃO] Erro [${ctx}]:`, error)
    logError(client, ctx, error).catch(() => {})

    const msg = { content: "⚠️ Erro ao processar sua solicitação. Tente novamente.", flags: MessageFlags.Ephemeral }
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(msg)
      else await interaction.reply(msg)
    } catch { /* ignorar */ }
  }
}
