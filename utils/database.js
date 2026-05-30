/**
 * utils/database.js — v6
 *
 * Wrapper de retrocompatibilidade: re-exporta tudo dos sub-módulos.
 * Todo código existente que importa de "../utils/database.js" continua funcionando
 * sem alteração. A lógica real está dividida em utils/db/*.js por domínio.
 *
 * Estrutura:
 *   utils/db/core.js          — init, migrations, statements, helpers
 *   utils/db/tickets.js       — tickets e inatividade
 *   utils/db/announcements.js — anúncios
 *   utils/db/negotiations.js  — negociações, escrow, middleman, ofertas, reservas
 *   utils/db/users.js         — blacklist, avaliações, favoritos, alertas, cooldowns
 *   utils/db/system.js        — stats, config, logs, temp modal
 */

export {
  initDatabase,
  getDatabase,
  saveDatabase,
  saveDatabaseSync,
} from "./db/core.js"

export {
  createTicket,
  getTicket,
  getTicketById,
  getUserOpenTickets,
  getAllUserOpenTickets,
  closeTicket,
  updateTicketClaimed,
  saveTicketVoiceChannel,
  updateChannelActivity,
  getInactiveTicketChannels,
  markInactivityWarned,
  getChannelsToAutoClose,
} from "./db/tickets.js"

export {
  createAnnouncement,
  getAnnouncement,
  getPendingAnnouncements,
  getUserActiveAnnouncements,
  getUserAllAnnouncements,
  getAllAnnouncements,
  getAnnouncementsPaginated,
  getAnnouncementsByStatus,
  approveAnnouncement,
  rejectAnnouncement,
  markAnnouncementSold,
  markAnnouncementExpired,
  deleteAnnouncement,
  bumpAnnouncement,
  getExpiredAnnouncements,
  getSoonExpiringAnnouncements,
  markExpirationNotified,
  getNickPriceHistory,
  updateAnnouncement,
  updateAnnouncementPhoto,
  getAnnouncementsByUUID,
  getAnnouncementsByUUIDRecent,
  getAnnouncementsByNick,
  getDuplicateAccountSellers,
  searchAnnouncements,
  getAnnouncementStats,
  getUserAnnouncementStats,
  getLatestUserAnnouncement,
  getRankingBySales,
  getRankingByRating,
  getRankingByAnns,
  purgeOldAnnouncements,
} from "./db/announcements.js"

export {
  createNegotiation,
  getNegotiationByChannel,
  getNegotiationById,
  completeNegotiation,
  cancelNegotiation,
  getUserActiveNegotiations,
  getUserPurchaseHistory,
  getUserNegotiationStats,
  getStuckNegotiations,
  updateNegotiationActivity,
  updateBuyerActivity,
  getInactiveNegotiations,
  getNegotiationsNearTimeout,
  markNegotiationTimeoutWarned,
  setEscrowStatus,
  getEscrowStatus,
  setEscrowIntermediary,
  getMiddlemanStatus,
  setMiddlemanRequested,
  setMiddlemanActive,
  setMiddlemanResolution,
  getExpiredMiddlemanRequests,
  addPaymentProof,
  getPaymentProofs,
  createOffer,
  getOffersByNegotiation,
  getLastPendingOffer,
  respondOffer,
  getOfferById,
  createReservation,
  getActiveReservation,
  cancelReservationByAnnouncement,
  cancelReservation,
  getExpiredReservations,
} from "./db/negotiations.js"

export {
  addToBlacklist,
  removeFromBlacklist,
  getBlacklist,
  isBlacklisted,
  getBlacklistEntry,
  createRating,
  getUserRatings,
  getUserAverageRating,
  hasAlreadyRated,
  addFavorite,
  removeFavorite,
  isFavorited,
  getUserFavorites,
  getFavoriters,
  countFavoriters,
  deleteFavoritesByAnnouncement,
  createAlert,
  getUserAlerts,
  deleteAlert,
  getAllActiveAlerts,
  markAlertTriggered,
  matchAlerts,
  enableAutoBump,
  disableAutoBump,
  getAutoBumpStatus,
  getAutoBumpsDue,
  recordAutoBump,
  checkAndSetCooldown,
  clearCooldown,
  purgeExpiredCooldowns,
  getAllSuspiciousUsers,
  getUserSuspiciousActivity,
  saveAnnouncementTemplate,
  getAnnouncementTemplate,
  deleteAnnouncementTemplate,
} from "./db/users.js"

export {
  addLog,
  getLogsByAction,
  purgeOldLogs,
  addEditLog,
  getEditLogs,
  saveTempModalData,
  updateTempModalData,
  getTempModalData,
  deleteTempModalData,
  purgeExpiredTempData,
  updateConfig,
  getConfig,
  getStats,
  getWeeklyStats,
  saveWeeklyReport,
} from "./db/system.js"

export {
  isNotificationEnabled,
  setNotification,
  getAllNotificationSubscribers,
} from "./db/notifications.js"
