/**
 * database.js — v5
 *
 * Melhorias v5:
 *  - Schema migrations via tabela schema_version (evita perda de dados em ALTER TABLE)
 *  - Prepared statements cacheados no nível de módulo (O(1) lookup, sem recriar objetos)
 *  - saveDatabaseSync usa WAL_CHECKPOINT(FULL) para garantir escrita antes de exit
 *  - Campo `valor` normalizado para REAL no banco (índice funciona, sem CAST em query)
 *  - Limpeza de cooldowns expirados removida do checkAndSetCooldown (agora via scheduler)
 */

import Database from "better-sqlite3"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH = join(__dirname, "..", "bot-data.sqlite")

// Versão atual do schema — incrementar a cada migration
const SCHEMA_VERSION = 3

let db

// ─────────────────────────────────────────────
// INIT & MIGRATIONS
// ─────────────────────────────────────────────

export function initDatabase() {
  db = new Database(DB_PATH)

  // Performance pragmas
  db.pragma("journal_mode = WAL")
  db.pragma("synchronous = NORMAL")
  db.pragma("foreign_keys = ON")
  db.pragma("cache_size = -8000") // 8MB cache

  runMigrations()
  prepareStatements()
  console.log("[DB] SQLite inicializado:", DB_PATH)
}

function runMigrations() {
  // Tabela de controle de versão
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get()
  const currentVersion = row?.v ?? 0

  // Migration 1: Schema base
  if (currentVersion < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        claimed_by TEXT,
        claimed_at TEXT,
        voice_channel_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(channel_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets(user_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

      CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id INTEGER,
        user_id TEXT NOT NULL,
        nick TEXT NOT NULL,
        uuid TEXT,
        bans TEXT,
        capas TEXT,
        vips TEXT,
        tags TEXT,
        medalhas TEXT,
        wins_level TEXT,
        cosmeticos TEXT,
        valor REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        message_id TEXT,
        approved_at TEXT,
        approved_by TEXT,
        rejected_by TEXT,
        rejected_reason TEXT,
        rejected_at TEXT,
        sold_at TEXT,
        expired_at TEXT,
        bumped_at TEXT,
        expiration_notified INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ann_user ON announcements(user_id);
      CREATE INDEX IF NOT EXISTS idx_ann_status ON announcements(status);
      CREATE INDEX IF NOT EXISTS idx_ann_uuid ON announcements(uuid);
      CREATE INDEX IF NOT EXISTS idx_ann_nick ON announcements(nick COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_ann_valor ON announcements(valor);

      CREATE TABLE IF NOT EXISTS negotiations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id INTEGER NOT NULL,
        buyer_id TEXT NOT NULL,
        seller_id TEXT NOT NULL,
        ticket_channel_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'active',
        escrow_seller_confirmed INTEGER DEFAULT 0,
        escrow_buyer_confirmed INTEGER DEFAULT 0,
        escrow_seller_confirmed_at TEXT,
        escrow_buyer_confirmed_at TEXT,
        escrow_intermediary TEXT,
        escrow_intermediary_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (announcement_id) REFERENCES announcements(id)
      );
      CREATE INDEX IF NOT EXISTS idx_neg_channel ON negotiations(ticket_channel_id);
      CREATE INDEX IF NOT EXISTS idx_neg_buyer ON negotiations(buyer_id);
      CREATE INDEX IF NOT EXISTS idx_neg_seller ON negotiations(seller_id);
      CREATE INDEX IF NOT EXISTS idx_neg_ann ON negotiations(announcement_id);

      CREATE TABLE IF NOT EXISTS offers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        negotiation_id INTEGER NOT NULL,
        from_user_id TEXT NOT NULL,
        to_user_id TEXT NOT NULL,
        value TEXT NOT NULL,
        message TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        responded_at TEXT,
        FOREIGN KEY (negotiation_id) REFERENCES negotiations(id)
      );
      CREATE INDEX IF NOT EXISTS idx_offers_neg ON offers(negotiation_id);

      CREATE TABLE IF NOT EXISTS blacklist (
        user_id TEXT PRIMARY KEY,
        reason TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ratings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        negotiation_id INTEGER NOT NULL,
        rater_id TEXT NOT NULL,
        rated_id TEXT NOT NULL,
        stars INTEGER NOT NULL,
        comment TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(negotiation_id, rater_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ratings_rated ON ratings(rated_id);

      CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id INTEGER NOT NULL,
        seller_id TEXT NOT NULL,
        buyer_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        cancelled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_res_ann ON reservations(announcement_id);
      CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status);

      CREATE TABLE IF NOT EXISTS alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        nick_filter TEXT,
        min_price REAL,
        max_price REAL,
        vip_filter TEXT,
        active INTEGER DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_triggered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(active);

      CREATE TABLE IF NOT EXISTS auto_bumps (
        announcement_id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL,
        active INTEGER DEFAULT 1,
        last_bumped_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS temp_modal_data (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        campo TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_editlogs_ann ON edit_logs(announcement_id);

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        user_id TEXT,
        target_id TEXT,
        details TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action);
      CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);

      CREATE TABLE IF NOT EXISTS payment_proofs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        negotiation_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        url TEXT NOT NULL,
        filename TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (negotiation_id) REFERENCES negotiations(id)
      );
      CREATE INDEX IF NOT EXISTS idx_proofs_neg ON payment_proofs(negotiation_id);

      CREATE TABLE IF NOT EXISTS config_store (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inactivity_warnings (
        channel_id TEXT PRIMARY KEY,
        warned_at TEXT NOT NULL,
        last_message_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cooldowns (
        key TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cooldowns_expires ON cooldowns(expires_at);
    `)
    db.prepare("INSERT INTO schema_version (version) VALUES (1)").run()
    console.log("[DB] Migration v1 aplicada (schema base)")
  }

  // Migration 2: converter valor TEXT → REAL para bancos existentes
  if (currentVersion < 2) {
    try {
      // Verifica se a coluna já é REAL (bancos novos criados pela migration 1)
      const info = db.pragma("table_info(announcements)")
      const valorCol = info.find(c => c.name === "valor")
      if (valorCol && valorCol.type.toUpperCase() === "TEXT") {
        db.exec(`
          BEGIN;
          ALTER TABLE announcements RENAME TO announcements_old;
          CREATE TABLE announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id INTEGER,
            user_id TEXT NOT NULL,
            nick TEXT NOT NULL,
            uuid TEXT,
            bans TEXT,
            capas TEXT,
            vips TEXT,
            tags TEXT,
            medalhas TEXT,
            wins_level TEXT,
            cosmeticos TEXT,
            valor REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            message_id TEXT,
            approved_at TEXT,
            approved_by TEXT,
            rejected_by TEXT,
            rejected_reason TEXT,
            rejected_at TEXT,
            sold_at TEXT,
            expired_at TEXT,
            bumped_at TEXT,
            expiration_notified INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO announcements SELECT
            id, ticket_id, user_id, nick, uuid, bans, capas, vips, tags,
            medalhas, wins_level, cosmeticos,
            CAST(REPLACE(REPLACE(valor, '.', ''), ',', '.') AS REAL),
            status, message_id, approved_at, approved_by, rejected_by,
            rejected_reason, rejected_at, sold_at, expired_at, bumped_at,
            expiration_notified, created_at
          FROM announcements_old;
          DROP TABLE announcements_old;
          CREATE INDEX IF NOT EXISTS idx_ann_user    ON announcements(user_id);
          CREATE INDEX IF NOT EXISTS idx_ann_status  ON announcements(status);
          CREATE INDEX IF NOT EXISTS idx_ann_uuid    ON announcements(uuid);
          CREATE INDEX IF NOT EXISTS idx_ann_nick    ON announcements(nick COLLATE NOCASE);
          CREATE INDEX IF NOT EXISTS idx_ann_valor   ON announcements(valor);
          COMMIT;
        `)
        console.log("[DB] Migration v2 aplicada (valor TEXT → REAL)")
      }
    } catch (err) {
      console.error("[DB] Erro na migration v2:", err.message)
    }
    db.prepare("INSERT INTO schema_version (version) VALUES (2)").run()
  }

  // Migration 3: tabela de favoritos
  if (currentVersion < 3) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS favorites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        announcement_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, announcement_id),
        FOREIGN KEY (announcement_id) REFERENCES announcements(id)
      );
      CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id);
      CREATE INDEX IF NOT EXISTS idx_fav_ann  ON favorites(announcement_id);
    `)
    db.prepare("INSERT INTO schema_version (version) VALUES (3)").run()
    console.log("[DB] Migration v3 aplicada (tabela favorites)")
  }
}

// ─────────────────────────────────────────────
// PREPARED STATEMENTS CACHEADOS
// Declarados após initDatabase() via prepareStatements()
// ─────────────────────────────────────────────

let S = {}  // namespace de statements preparados

function prepareStatements() {
  // Tickets
  S.createTicket         = db.prepare(`INSERT INTO tickets (channel_id, user_id, type) VALUES (?, ?, ?)`)
  S.getTicket            = db.prepare(`SELECT * FROM tickets WHERE channel_id = ?`)
  S.getTicketById        = db.prepare(`SELECT * FROM tickets WHERE id = ?`)
  S.getUserOpenTickets   = db.prepare(`SELECT * FROM tickets WHERE user_id = ? AND type = ? AND status = 'open'`)
  S.closeTicket          = db.prepare(`UPDATE tickets SET status = 'closed', closed_at = datetime('now') WHERE channel_id = ?`)
  S.updateTicketClaimed  = db.prepare(`UPDATE tickets SET claimed_by = ?, claimed_at = datetime('now') WHERE channel_id = ?`)
  S.saveTicketVoice      = db.prepare(`UPDATE tickets SET voice_channel_id = ? WHERE channel_id = ?`)

  // Inatividade
  S.updateChannelActivity = db.prepare(`
    INSERT INTO inactivity_warnings (channel_id, warned_at, last_message_at)
    VALUES (?, '', datetime('now'))
    ON CONFLICT(channel_id) DO UPDATE SET last_message_at = datetime('now'), warned_at = ''
  `)
  S.getInactiveChannels  = db.prepare(`
    SELECT iw.channel_id, iw.last_message_at, iw.warned_at, t.user_id, t.type
    FROM inactivity_warnings iw
    JOIN tickets t ON t.channel_id = iw.channel_id
    WHERE t.status = 'open'
      AND iw.warned_at = ''
      AND (julianday('now') - julianday(iw.last_message_at)) * 24 >= ?
  `)
  S.markInactivityWarned = db.prepare(`UPDATE inactivity_warnings SET warned_at = datetime('now') WHERE channel_id = ?`)
  S.getChannelsToAutoClose = db.prepare(`
    SELECT iw.channel_id, iw.warned_at, t.user_id
    FROM inactivity_warnings iw
    JOIN tickets t ON t.channel_id = iw.channel_id
    WHERE t.status = 'open'
      AND iw.warned_at != ''
      AND (julianday('now') - julianday(iw.warned_at)) * 24 >= ?
  `)

  // Anúncios
  S.createAnnouncement   = db.prepare(`
    INSERT INTO announcements
      (ticket_id, user_id, nick, uuid, bans, capas, vips, tags, medalhas, wins_level, cosmeticos, valor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  S.getAnnouncement      = db.prepare(`SELECT * FROM announcements WHERE id = ?`)
  S.getPendingAnns       = db.prepare(`SELECT * FROM announcements WHERE status = 'pending' ORDER BY created_at DESC`)
  S.getUserActiveAnns    = db.prepare(`SELECT * FROM announcements WHERE user_id = ? AND status IN ('pending','approved') ORDER BY created_at DESC`)
  S.getUserAllAnns       = db.prepare(`SELECT * FROM announcements WHERE user_id = ? ORDER BY created_at DESC`)
  S.getAllAnns           = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC`)
  S.getAnnsPaged         = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC LIMIT ? OFFSET ?`)
  S.countAnns            = db.prepare(`SELECT COUNT(*) as c FROM announcements`)
  S.getAnnsByStatus      = db.prepare(`SELECT * FROM announcements WHERE status = ? ORDER BY created_at DESC`)
  S.approveAnn           = db.prepare(`UPDATE announcements SET status = 'approved', message_id = ?, approved_at = datetime('now'), approved_by = ? WHERE id = ?`)
  S.rejectAnn            = db.prepare(`UPDATE announcements SET status = 'rejected', rejected_by = ?, rejected_reason = ?, rejected_at = datetime('now') WHERE id = ?`)
  S.markSold             = db.prepare(`UPDATE announcements SET status = 'sold', sold_at = datetime('now') WHERE id = ?`)
  S.markExpired          = db.prepare(`UPDATE announcements SET status = 'expired', expired_at = datetime('now') WHERE id = ?`)
  S.deleteAnn            = db.prepare(`DELETE FROM announcements WHERE id = ? AND status != 'sold'`)
  S.bumpAnn              = db.prepare(`UPDATE announcements SET bumped_at = datetime('now') WHERE id = ?`)
  S.getExpiredAnns       = db.prepare(`
    SELECT * FROM announcements
    WHERE status = 'approved'
      AND (julianday('now') - julianday(COALESCE(bumped_at, created_at))) >= ?
  `)
  S.getSoonExpiringAnns  = db.prepare(`
    SELECT * FROM announcements
    WHERE status = 'approved'
      AND expiration_notified = 0
      AND (julianday('now') - julianday(COALESCE(bumped_at, created_at))) >= ?
      AND (julianday('now') - julianday(COALESCE(bumped_at, created_at))) < ?
  `)
  S.markExpirationNotified = db.prepare(`UPDATE announcements SET expiration_notified = 1 WHERE id = ?`)
  S.getNickPriceHistory  = db.prepare(`SELECT valor, status, created_at FROM announcements WHERE nick = ? COLLATE NOCASE ORDER BY created_at ASC`)
  S.getAnnsByUUID        = db.prepare(`SELECT * FROM announcements WHERE uuid = ? AND status IN ('approved','pending')`)
  S.getAnnsByNick        = db.prepare(`SELECT * FROM announcements WHERE nick = ? COLLATE NOCASE`)
  S.getDupeSellers       = db.prepare(`SELECT DISTINCT user_id FROM announcements WHERE uuid = ?`)
  S.annStats             = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'sold'     THEN 1 ELSE 0 END) as sold,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status = 'expired'  THEN 1 ELSE 0 END) as expired
    FROM announcements
  `)

  // Negociações
  S.createNeg            = db.prepare(`INSERT INTO negotiations (announcement_id, buyer_id, seller_id, ticket_channel_id) VALUES (?, ?, ?, ?)`)
  S.getNegByChannel      = db.prepare(`SELECT * FROM negotiations WHERE ticket_channel_id = ?`)
  S.getNegById           = db.prepare(`SELECT * FROM negotiations WHERE id = ?`)
  S.completeNeg          = db.prepare(`UPDATE negotiations SET status = 'completed', completed_at = datetime('now') WHERE ticket_channel_id = ?`)
  S.cancelNeg            = db.prepare(`UPDATE negotiations SET status = 'cancelled', completed_at = datetime('now') WHERE ticket_channel_id = ?`)
  S.getUserActiveNegs    = db.prepare(`SELECT * FROM negotiations WHERE (buyer_id = ? OR seller_id = ?) AND status = 'active'`)
  S.getPurchaseHistory   = db.prepare(`SELECT * FROM negotiations WHERE buyer_id = ? AND status = 'completed' ORDER BY completed_at DESC`)
  S.negStatsBuyer        = db.prepare(`SELECT status, COUNT(*) as cnt FROM negotiations WHERE buyer_id = ? GROUP BY status`)
  S.negStatsSeller       = db.prepare(`SELECT status, COUNT(*) as cnt FROM negotiations WHERE seller_id = ? GROUP BY status`)

  // Escrow
  S.getEscrow            = db.prepare(`SELECT * FROM negotiations WHERE ticket_channel_id = ?`)
  S.setEscrowIntermediary = db.prepare(`UPDATE negotiations SET escrow_intermediary = ?, escrow_intermediary_at = datetime('now') WHERE ticket_channel_id = ?`)

  // Comprovantes
  S.addProof             = db.prepare(`INSERT INTO payment_proofs (negotiation_id, user_id, url, filename) VALUES (?, ?, ?, ?)`)
  S.getProofs            = db.prepare(`SELECT * FROM payment_proofs WHERE negotiation_id = ? ORDER BY created_at DESC`)

  // Ofertas
  S.createOffer          = db.prepare(`INSERT INTO offers (negotiation_id, from_user_id, to_user_id, value, message) VALUES (?, ?, ?, ?, ?)`)
  S.getOffersByNeg       = db.prepare(`SELECT * FROM offers WHERE negotiation_id = ? ORDER BY created_at DESC`)
  S.getLastPendingOffer  = db.prepare(`SELECT * FROM offers WHERE negotiation_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`)
  S.respondOffer         = db.prepare(`UPDATE offers SET status = ?, responded_at = datetime('now') WHERE id = ?`)
  S.getOfferById         = db.prepare(`SELECT * FROM offers WHERE id = ?`)

  // Reservas
  S.createReservation    = db.prepare(`INSERT INTO reservations (announcement_id, seller_id, buyer_id, expires_at) VALUES (?, ?, ?, ?)`)
  S.getActiveReservation = db.prepare(`SELECT * FROM reservations WHERE announcement_id = ? AND status = 'active' AND expires_at > datetime('now')`)
  S.cancelResByAnn       = db.prepare(`UPDATE reservations SET status = 'cancelled', cancelled_at = datetime('now') WHERE announcement_id = ? AND status = 'active'`)
  S.cancelResById        = db.prepare(`UPDATE reservations SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?`)
  S.getExpiredRes        = db.prepare(`SELECT * FROM reservations WHERE status = 'active' AND expires_at <= datetime('now')`)

  // Alertas
  S.createAlert          = db.prepare(`INSERT INTO alerts (user_id, nick_filter, min_price, max_price, vip_filter) VALUES (?, ?, ?, ?, ?)`)
  S.getUserAlerts        = db.prepare(`SELECT * FROM alerts WHERE user_id = ? AND active = 1 ORDER BY created_at DESC`)
  S.deleteAlert          = db.prepare(`UPDATE alerts SET active = 0 WHERE id = ? AND user_id = ?`)
  S.getAllActiveAlerts    = db.prepare(`SELECT * FROM alerts WHERE active = 1`)
  S.markAlertTriggered   = db.prepare(`UPDATE alerts SET last_triggered_at = datetime('now') WHERE id = ?`)
  S.matchAlerts          = db.prepare(`
    SELECT * FROM alerts
    WHERE active = 1
      AND user_id != ?
      AND (nick_filter IS NULL OR ? LIKE '%' || nick_filter || '%')
      AND (min_price IS NULL OR ? >= min_price)
      AND (max_price IS NULL OR ? <= max_price)
      AND (vip_filter IS NULL
           OR LOWER(?) LIKE '%' || LOWER(vip_filter) || '%'
           OR LOWER(?) LIKE '%' || LOWER(vip_filter) || '%')
  `)

  // Auto bump
  S.enableAutoBump       = db.prepare(`
    INSERT INTO auto_bumps (announcement_id, user_id, active, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(announcement_id) DO UPDATE SET active = 1, updated_at = datetime('now')
  `)
  S.disableAutoBump      = db.prepare(`UPDATE auto_bumps SET active = 0, updated_at = datetime('now') WHERE announcement_id = ?`)
  S.getAutoBumpStatus    = db.prepare(`SELECT * FROM auto_bumps WHERE announcement_id = ?`)
  S.getAutoBumpsDue      = db.prepare(`
    SELECT ab.*, a.user_id as ann_user_id FROM auto_bumps ab
    JOIN announcements a ON a.id = ab.announcement_id
    WHERE ab.active = 1
      AND a.status = 'approved'
      AND (ab.last_bumped_at IS NULL OR (julianday('now') - julianday(ab.last_bumped_at)) * 24 >= 24)
  `)
  S.recordAutoBump       = db.prepare(`UPDATE auto_bumps SET last_bumped_at = datetime('now') WHERE announcement_id = ?`)
  S.autoBumpAnn          = db.prepare(`UPDATE announcements SET bumped_at = datetime('now') WHERE id = ?`)

  // Blacklist
  S.addBlacklist         = db.prepare(`INSERT INTO blacklist (user_id, reason, created_by) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET reason = ?, created_by = ?, created_at = datetime('now')`)
  S.removeBlacklist      = db.prepare(`DELETE FROM blacklist WHERE user_id = ?`)
  S.getBlacklist         = db.prepare(`SELECT * FROM blacklist ORDER BY created_at DESC`)
  S.isBlacklisted        = db.prepare(`SELECT 1 FROM blacklist WHERE user_id = ?`)
  S.getBlacklistEntry    = db.prepare(`SELECT * FROM blacklist WHERE user_id = ?`)

  // Avaliações
  S.createRating         = db.prepare(`INSERT OR IGNORE INTO ratings (negotiation_id, rater_id, rated_id, stars, comment) VALUES (?, ?, ?, ?, ?)`)
  S.getUserRatings       = db.prepare(`SELECT * FROM ratings WHERE rated_id = ? ORDER BY created_at DESC`)
  S.getUserAvgRating     = db.prepare(`SELECT AVG(stars) as average, COUNT(*) as count FROM ratings WHERE rated_id = ?`)
  S.hasRated             = db.prepare(`SELECT 1 FROM ratings WHERE negotiation_id = ? AND rater_id = ?`)

  // Logs
  S.addLog               = db.prepare(`INSERT INTO logs (action, user_id, target_id, details) VALUES (?, ?, ?, ?)`)
  S.getLogsByAction      = db.prepare(`SELECT * FROM logs WHERE action = ? ORDER BY created_at DESC`)
  S.purgeOldLogs         = db.prepare(`DELETE FROM logs WHERE created_at < datetime('now', '-' || ? || ' days')`)

  // Edit logs
  S.addEditLog           = db.prepare(`INSERT INTO edit_logs (announcement_id, user_id, campo, old_value, new_value) VALUES (?, ?, ?, ?, ?)`)
  S.getEditLogs          = db.prepare(`SELECT * FROM edit_logs WHERE announcement_id = ? ORDER BY created_at DESC`)

  // Temp modal data
  S.cleanTempModal       = db.prepare(`DELETE FROM temp_modal_data WHERE created_at < ?`)
  S.insertTempModal      = db.prepare(`INSERT INTO temp_modal_data (id, data, created_at) VALUES (?, ?, ?)`)
  S.updateTempModal      = db.prepare(`UPDATE temp_modal_data SET data = ?, created_at = ? WHERE id = ?`)
  S.getTempModal         = db.prepare(`SELECT data FROM temp_modal_data WHERE id = ?`)
  S.deleteTempModal      = db.prepare(`DELETE FROM temp_modal_data WHERE id = ?`)

  // Config dinâmica
  S.updateConfig         = db.prepare(`INSERT INTO config_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`)
  S.getConfigAll         = db.prepare(`SELECT key, value FROM config_store`)


  // Favoritos
  S.addFavorite      = db.prepare(`INSERT OR IGNORE INTO favorites (user_id, announcement_id) VALUES (?, ?)`)
  S.removeFavorite   = db.prepare(`DELETE FROM favorites WHERE user_id = ? AND announcement_id = ?`)
  S.isFavorited      = db.prepare(`SELECT 1 FROM favorites WHERE user_id = ? AND announcement_id = ?`)
  S.getUserFavorites = db.prepare(`
    SELECT f.*, a.nick, a.valor, a.status, a.user_id as seller_id, a.uuid, a.message_id, a.bumped_at
    FROM favorites f
    JOIN announcements a ON a.id = f.announcement_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `)
  S.getFavoriters    = db.prepare(`SELECT user_id FROM favorites WHERE announcement_id = ?`)
  S.countFavoriters  = db.prepare(`SELECT COUNT(*) as c FROM favorites WHERE announcement_id = ?`)
  S.deleteFavsByAnn  = db.prepare(`DELETE FROM favorites WHERE announcement_id = ?`)

  // Cooldowns persistentes
  S.getCooldown          = db.prepare(`SELECT expires_at FROM cooldowns WHERE key = ?`)
  S.setCooldown          = db.prepare(`INSERT OR REPLACE INTO cooldowns (key, expires_at) VALUES (?, ?)`)
  S.deleteCooldown       = db.prepare(`DELETE FROM cooldowns WHERE key = ?`)
  S.purgeExpiredCooldowns = db.prepare(`DELETE FROM cooldowns WHERE expires_at < ?`)

  // Stats
  S.ticketStats          = db.prepare(`SELECT status, COUNT(*) as cnt FROM tickets GROUP BY status`)
  S.annGroupStats        = db.prepare(`SELECT status, COUNT(*) as cnt FROM announcements GROUP BY status`)
  S.negGroupStats        = db.prepare(`SELECT status, COUNT(*) as cnt FROM negotiations GROUP BY status`)
  S.countBlacklist       = db.prepare(`SELECT COUNT(*) as c FROM blacklist`)
  S.countActiveAlerts    = db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE active = 1`)
  S.countActiveRes       = db.prepare(`SELECT COUNT(*) as c FROM reservations WHERE status = 'active' AND expires_at > datetime('now')`)
  S.countActiveBumps     = db.prepare(`SELECT COUNT(*) as c FROM auto_bumps WHERE active = 1`)

  // Suspicious users
  S.rejectedSuspicious   = db.prepare(`SELECT user_id, COUNT(*) as c FROM announcements WHERE status = 'rejected' GROUP BY user_id HAVING c >= 3`)
  S.sharedUUIDs          = db.prepare(`SELECT uuid, GROUP_CONCAT(DISTINCT user_id) as sellers, COUNT(DISTINCT user_id) as cnt FROM announcements WHERE uuid IS NOT NULL GROUP BY uuid HAVING cnt > 1`)
  S.cancelledNegsSuspicious = db.prepare(`
    SELECT user_id, COUNT(*) as c FROM (
      SELECT seller_id as user_id FROM negotiations WHERE status = 'cancelled'
      UNION ALL
      SELECT buyer_id  as user_id FROM negotiations WHERE status = 'cancelled'
    ) GROUP BY user_id HAVING c >= 3
  `)
  S.userRejections       = db.prepare(`SELECT COUNT(*) as c FROM announcements WHERE user_id = ? AND status = 'rejected'`)
  S.userUUIDs            = db.prepare(`SELECT DISTINCT uuid FROM announcements WHERE user_id = ? AND uuid IS NOT NULL`)
  S.userCancelled        = db.prepare(`SELECT COUNT(*) as c FROM negotiations WHERE (seller_id = ? OR buyer_id = ?) AND status = 'cancelled'`)
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function rowToAnnouncement(row) {
  if (!row) return null
  return { ...row, expiration_notified: row.expiration_notified === 1 }
}

function rowToNegotiation(row) {
  if (!row) return null
  return {
    ...row,
    escrow: {
      seller_confirmed:    row.escrow_seller_confirmed === 1,
      buyer_confirmed:     row.escrow_buyer_confirmed === 1,
      seller_confirmed_at: row.escrow_seller_confirmed_at,
      buyer_confirmed_at:  row.escrow_buyer_confirmed_at,
      intermediary:        row.escrow_intermediary,
      intermediary_at:     row.escrow_intermediary_at,
    },
  }
}

function alertRowToObj(row) {
  if (!row) return null
  return {
    ...row,
    active: row.active === 1,
    filters: {
      nick:     row.nick_filter,
      minPrice: row.min_price,
      maxPrice: row.max_price,
      vip:      row.vip_filter,
    },
  }
}

/** Normaliza string de valor monetário para número (ex: "1.500,00" → 1500.00) */
function parseValor(v) {
  if (typeof v === "number") return v
  const s = String(v).trim()
  // Se tem virgula, e formato brasileiro: 1.500,00 ou 200,00
  if (s.includes(",")) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0
  // Sem virgula, trata ponto como separador decimal: 200.00, 200, 1500.50
  return parseFloat(s) || 0
}

export function getDatabase() { return db }
export function saveDatabase() { /* no-op: SQLite escreve automaticamente */ }

/**
 * Garante que todos os dados do WAL sejam escritos no arquivo principal
 * antes de sair do processo. FULL (vs PASSIVE) aguarda readers liberarem.
 */
export function saveDatabaseSync() {
  try {
    db.pragma("wal_checkpoint(FULL)")
  } catch (err) {
    console.error("[DB] Erro no checkpoint:", err.message)
  }
}

// ─────────────────────────────────────────────
// TICKETS
// ─────────────────────────────────────────────

export function createTicket(channelId, userId, type) {
  const r = S.createTicket.run(channelId, userId, type)
  return { lastInsertRowid: r.lastInsertRowid }
}

export function getTicket(channelId) {
  return S.getTicket.get(channelId) ?? null
}

export function getTicketById(id) {
  return S.getTicketById.get(id) ?? null
}

export function getUserOpenTickets(userId, type) {
  return S.getUserOpenTickets.all(userId, type)
}

export function closeTicket(channelId) {
  S.closeTicket.run(channelId)
  return getTicket(channelId)
}

export function updateTicketClaimed(channelId, staffId) {
  S.updateTicketClaimed.run(staffId, channelId)
  return getTicket(channelId)
}

export function saveTicketVoiceChannel(channelId, voiceChannelId) {
  S.saveTicketVoice.run(voiceChannelId, channelId)
}

// ─────────────────────────────────────────────
// INATIVIDADE
// ─────────────────────────────────────────────

export function updateChannelActivity(channelId) {
  S.updateChannelActivity.run(channelId)
}

export function getInactiveTicketChannels(hoursThreshold = 48) {
  return S.getInactiveChannels.all(hoursThreshold)
}

export function markInactivityWarned(channelId) {
  S.markInactivityWarned.run(channelId)
}

export function getChannelsToAutoClose(hoursAfterWarning = 24) {
  return S.getChannelsToAutoClose.all(hoursAfterWarning)
}

// ─────────────────────────────────────────────
// ANÚNCIOS
// ─────────────────────────────────────────────

export function createAnnouncement(data) {
  const r = S.createAnnouncement.run(
    data.ticketId ?? null, data.userId, data.nick, data.uuid ?? null,
    data.bans ?? null, data.capas ?? null, data.vips ?? null,
    data.tags ?? null, data.medalhas ?? null, data.winsLevel ?? null,
    data.cosmeticos ?? null, parseValor(data.valor)
  )
  return { lastInsertRowid: r.lastInsertRowid }
}

export function getAnnouncement(id) {
  return rowToAnnouncement(S.getAnnouncement.get(id))
}

export function getPendingAnnouncements() {
  return S.getPendingAnns.all().map(rowToAnnouncement)
}

export function getUserActiveAnnouncements(userId) {
  return S.getUserActiveAnns.all(userId).map(rowToAnnouncement)
}

export function getUserAllAnnouncements(userId) {
  return S.getUserAllAnns.all(userId).map(rowToAnnouncement)
}

export function getAllAnnouncements() {
  return S.getAllAnns.all().map(rowToAnnouncement)
}

export function getAnnouncementsPaginated(page = 0, pageSize = 12) {
  const offset = page * pageSize
  const rows = S.getAnnsPaged.all(pageSize, offset).map(rowToAnnouncement)
  const total = S.countAnns.get().c
  return { rows, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export function getAnnouncementsByStatus(status) {
  return S.getAnnsByStatus.all(status).map(rowToAnnouncement)
}

export function approveAnnouncement(id, messageId, approvedBy) {
  S.approveAnn.run(messageId, approvedBy, id)
  return getAnnouncement(id)
}

export function rejectAnnouncement(id, rejectedBy, reason = null) {
  S.rejectAnn.run(rejectedBy, reason, id)
  return getAnnouncement(id)
}

export function markAnnouncementSold(id) {
  S.markSold.run(id)
  return getAnnouncement(id)
}

export function markAnnouncementExpired(id) {
  S.markExpired.run(id)
}

/** Deleta permanentemente um anúncio (apenas se não estiver vendido). Retorna true se deletou. */
export function deleteAnnouncement(id) {
  const result = S.deleteAnn.run(id)
  return result.changes > 0
}

export function bumpAnnouncement(id) {
  S.bumpAnn.run(id)
}

export function getExpiredAnnouncements(expirationDays) {
  return S.getExpiredAnns.all(expirationDays).map(rowToAnnouncement)
}

export function getSoonExpiringAnnouncements(expirationDays, warningDays = 3) {
  return S.getSoonExpiringAnns.all(expirationDays - warningDays, expirationDays).map(rowToAnnouncement)
}

export function markExpirationNotified(id) {
  S.markExpirationNotified.run(id)
}

export function getNickPriceHistory(nick) {
  return S.getNickPriceHistory.all(nick)
}

export function updateAnnouncement(id, fields) {
  const allowed = ["valor", "bans", "capas", "vips", "tags", "medalhas", "wins_level", "cosmeticos", "message_id", "status"]
  const entries = Object.entries(fields).filter(([k]) => allowed.includes(k))
  if (!entries.length) return getAnnouncement(id)
  // Normaliza valor se presente
  const normalized = entries.map(([k, v]) => [k, k === "valor" ? parseValor(v) : v])
  const set = normalized.map(([k]) => `${k} = ?`).join(", ")
  const vals = normalized.map(([, v]) => v)
  db.prepare(`UPDATE announcements SET ${set} WHERE id = ?`).run(...vals, id)
  return getAnnouncement(id)
}

export function getAnnouncementsByUUID(uuid) {
  return S.getAnnsByUUID.all(uuid).map(rowToAnnouncement)
}

export function getAnnouncementsByNick(nick) {
  return S.getAnnsByNick.all(nick).map(rowToAnnouncement)
}

export function getDuplicateAccountSellers(uuid) {
  return S.getDupeSellers.all(uuid).map(r => r.user_id)
}

export function searchAnnouncements({ nick, minPrice, maxPrice, tag, status = "approved" }) {
  let sql = `SELECT * FROM announcements WHERE status = ?`
  const params = [status]
  if (nick)              { sql += ` AND nick LIKE ? COLLATE NOCASE`; params.push(`%${nick}%`) }
  if (minPrice != null)  { sql += ` AND valor >= ?`; params.push(parseValor(minPrice)) }
  if (maxPrice != null)  { sql += ` AND valor <= ?`; params.push(parseValor(maxPrice)) }
  if (tag)               { sql += ` AND (tags LIKE ? COLLATE NOCASE OR vips LIKE ? COLLATE NOCASE)`; params.push(`%${tag}%`, `%${tag}%`) }
  sql += ` ORDER BY created_at DESC`
  return db.prepare(sql).all(...params).map(rowToAnnouncement)
}

// ─────────────────────────────────────────────
// NEGOCIAÇÕES
// ─────────────────────────────────────────────

export function createNegotiation(announcementId, buyerId, sellerId, ticketChannelId) {
  const r = S.createNeg.run(announcementId, buyerId, sellerId, ticketChannelId)
  return { lastInsertRowid: r.lastInsertRowid }
}

export function getNegotiationByChannel(channelId) {
  return rowToNegotiation(S.getNegByChannel.get(channelId))
}

export function getNegotiationById(id) {
  return rowToNegotiation(S.getNegById.get(id))
}

export function completeNegotiation(channelId) {
  S.completeNeg.run(channelId)
  return getNegotiationByChannel(channelId)
}

export function cancelNegotiation(channelId) {
  S.cancelNeg.run(channelId)
  return getNegotiationByChannel(channelId)
}

export function getUserActiveNegotiations(userId) {
  return S.getUserActiveNegs.all(userId, userId).map(rowToNegotiation)
}

export function getUserPurchaseHistory(userId) {
  const negs = S.getPurchaseHistory.all(userId).map(rowToNegotiation)
  return negs.map(n => ({ negotiation: n, announcement: getAnnouncement(n.announcement_id) }))
}

export function getUserNegotiationStats(userId) {
  const b = S.negStatsBuyer.all(userId)
  const s = S.negStatsSeller.all(userId)
  const toMap = rows => Object.fromEntries(rows.map(r => [r.status, r.cnt]))
  const bm = toMap(b); const sm = toMap(s)
  return {
    totalAsBuyer:      b.reduce((a, r) => a + r.cnt, 0),
    completedAsBuyer:  bm.completed ?? 0,
    cancelledAsBuyer:  bm.cancelled ?? 0,
    totalAsSeller:     s.reduce((a, r) => a + r.cnt, 0),
    completedAsSeller: sm.completed ?? 0,
    cancelledAsSeller: sm.cancelled ?? 0,
  }
}

// ─────────────────────────────────────────────
// ESCROW
// ─────────────────────────────────────────────

export function setEscrowStatus(channelId, party, confirmed) {
  const col   = party === "seller" ? "escrow_seller_confirmed"    : "escrow_buyer_confirmed"
  const atCol = party === "seller" ? "escrow_seller_confirmed_at" : "escrow_buyer_confirmed_at"
  db.prepare(`UPDATE negotiations SET ${col} = ?, ${atCol} = datetime('now') WHERE ticket_channel_id = ?`).run(confirmed ? 1 : 0, channelId)
  return getNegotiationByChannel(channelId)
}

export function getEscrowStatus(channelId) {
  const n = getNegotiationByChannel(channelId)
  return n ? n.escrow : null
}

export function setEscrowIntermediary(channelId, staffId) {
  S.setEscrowIntermediary.run(staffId, channelId)
  return getNegotiationByChannel(channelId)
}

// ─────────────────────────────────────────────
// COMPROVANTE DE PAGAMENTO
// ─────────────────────────────────────────────

export function addPaymentProof(negotiationId, userId, url, filename = null) {
  const r = S.addProof.run(negotiationId, userId, url, filename)
  return { id: r.lastInsertRowid, negotiation_id: negotiationId, user_id: userId, url, filename }
}

export function getPaymentProofs(negotiationId) {
  return S.getProofs.all(negotiationId)
}

// ─────────────────────────────────────────────
// OFERTAS
// ─────────────────────────────────────────────

export function createOffer(negotiationId, fromUserId, toUserId, value, message = null) {
  const r = S.createOffer.run(negotiationId, fromUserId, toUserId, value, message)
  return { id: r.lastInsertRowid, negotiation_id: negotiationId, from_user_id: fromUserId, to_user_id: toUserId, value, message, status: "pending" }
}

export function getOffersByNegotiation(negotiationId) {
  return S.getOffersByNeg.all(negotiationId)
}

export function getLastPendingOffer(negotiationId) {
  return S.getLastPendingOffer.get(negotiationId) ?? null
}

export function respondOffer(offerId, status) {
  S.respondOffer.run(status, offerId)
  return S.getOfferById.get(offerId)
}

export function getOfferById(offerId) {
  return S.getOfferById.get(offerId) ?? null
}

// ─────────────────────────────────────────────
// RESERVAS
// ─────────────────────────────────────────────

export function createReservation(announcementId, sellerId, buyerId, durationHours = 24) {
  cancelReservationByAnnouncement(announcementId)
  const expiresAt = new Date(Date.now() + durationHours * 3_600_000).toISOString()
  const r = S.createReservation.run(announcementId, sellerId, buyerId, expiresAt)
  return { id: r.lastInsertRowid, announcement_id: announcementId, seller_id: sellerId, buyer_id: buyerId, status: "active", expires_at: expiresAt }
}

export function getActiveReservation(announcementId) {
  return S.getActiveReservation.get(announcementId) ?? null
}

export function cancelReservationByAnnouncement(announcementId) {
  S.cancelResByAnn.run(announcementId)
}

export function cancelReservation(reservationId) {
  S.cancelResById.run(reservationId)
}

export function getExpiredReservations() {
  return S.getExpiredRes.all()
}

// ─────────────────────────────────────────────
// ALERTAS
// ─────────────────────────────────────────────

export function createAlert(userId, filters) {
  const r = S.createAlert.run(userId, filters.nick ?? null, filters.minPrice ?? null, filters.maxPrice ?? null, filters.vip ?? null)
  return { id: r.lastInsertRowid, user_id: userId, filters, active: true }
}

export function getUserAlerts(userId) {
  return S.getUserAlerts.all(userId).map(alertRowToObj)
}

export function deleteAlert(alertId, userId) {
  const r = S.deleteAlert.run(alertId, userId)
  return r.changes > 0
}

export function getAllActiveAlerts() {
  return S.getAllActiveAlerts.all().map(alertRowToObj)
}

export function markAlertTriggered(alertId) {
  S.markAlertTriggered.run(alertId)
}

export function matchAlerts(announcement) {
  return S.matchAlerts.all(
    announcement.user_id,
    announcement.nick,
    announcement.valor, announcement.valor,
    announcement.vips ?? "",
    announcement.tags ?? ""
  ).map(alertRowToObj)
}

// ─────────────────────────────────────────────
// AUTO BUMP
// ─────────────────────────────────────────────

export function enableAutoBump(announcementId, userId) {
  S.enableAutoBump.run(announcementId, userId)
  return getAutoBumpStatus(announcementId)
}

export function disableAutoBump(announcementId) {
  S.disableAutoBump.run(announcementId)
}

export function getAutoBumpStatus(announcementId) {
  const row = S.getAutoBumpStatus.get(announcementId)
  if (!row) return null
  return { ...row, active: row.active === 1 }
}

export function getAutoBumpsDue() {
  return S.getAutoBumpsDue.all().map(r => ({ ...r, active: r.active === 1 }))
}

export function recordAutoBump(announcementId) {
  S.recordAutoBump.run(announcementId)
  S.autoBumpAnn.run(announcementId)
}

// ─────────────────────────────────────────────
// BLACKLIST
// ─────────────────────────────────────────────

export function addToBlacklist(userId, reason, createdBy) {
  S.addBlacklist.run(userId, reason, createdBy, reason, createdBy)
  return getBlacklistEntry(userId)
}

export function removeFromBlacklist(userId) {
  const r = S.removeBlacklist.run(userId)
  return r.changes > 0
}

export function getBlacklist() {
  return S.getBlacklist.all()
}

export function isBlacklisted(userId) {
  return !!S.isBlacklisted.get(userId)
}

export function getBlacklistEntry(userId) {
  return S.getBlacklistEntry.get(userId) ?? null
}

// ─────────────────────────────────────────────
// AVALIAÇÕES
// ─────────────────────────────────────────────

export function createRating(data) {
  const r = S.createRating.run(data.negotiationId, data.raterId, data.ratedId, data.stars, data.comment ?? null)
  return { id: r.lastInsertRowid, ...data }
}

export function getUserRatings(userId) {
  return S.getUserRatings.all(userId)
}

export function getUserAverageRating(userId) {
  const row = S.getUserAvgRating.get(userId)
  return { average: row?.count > 0 ? parseFloat(row.average).toFixed(1) : 0, count: row?.count ?? 0 }
}

export function hasAlreadyRated(negotiationId, raterId) {
  return !!S.hasRated.get(negotiationId, raterId)
}

// ─────────────────────────────────────────────
// LOGS
// ─────────────────────────────────────────────

export function addLog(action, userId, targetId = null, details = null) {
  const r = S.addLog.run(action, userId, targetId, details)
  return { lastInsertRowid: r.lastInsertRowid }
}

export function getLogsByAction(action) {
  return S.getLogsByAction.all(action)
}

export function purgeOldLogs(daysToKeep = 90) {
  const r = S.purgeOldLogs.run(daysToKeep)
  if (r.changes > 0) console.log(`[DB] Purge: ${r.changes} logs removidos (>${daysToKeep} dias)`)
  return r.changes
}

// ─────────────────────────────────────────────
// EDIT LOGS
// ─────────────────────────────────────────────

export function addEditLog(announcementId, userId, changes) {
  const { campo, oldValue, newValue } = changes
  const r = S.addEditLog.run(announcementId, userId, campo, String(oldValue ?? ""), String(newValue ?? ""))
  return { id: r.lastInsertRowid }
}

export function getEditLogs(announcementId) {
  return S.getEditLogs.all(announcementId)
}

// ─────────────────────────────────────────────
// TEMP MODAL DATA
// ─────────────────────────────────────────────

export function saveTempModalData(data) {
  S.cleanTempModal.run(Date.now() - 3_600_000)
  const id = `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  S.insertTempModal.run(id, JSON.stringify(data), Date.now())
  return id
}

export function updateTempModalData(id, data) {
  S.updateTempModal.run(JSON.stringify(data), Date.now(), id)
}

export function getTempModalData(id) {
  const row = S.getTempModal.get(id)
  return row ? JSON.parse(row.data) : null
}

export function deleteTempModalData(id) {
  S.deleteTempModal.run(id)
}

// ─────────────────────────────────────────────
// CONFIG DINÂMICA
// ─────────────────────────────────────────────

export function updateConfig(key, value) {
  S.updateConfig.run(key, String(value), String(value))
}

export function getConfig() {
  const rows = S.getConfigAll.all()
  if (!rows.length) return null
  const result = {}
  for (const { key, value } of rows) {
    const keys = key.split(".")
    let obj = result
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {}
      obj = obj[keys[i]]
    }
    obj[keys[keys.length - 1]] = isNaN(value) ? value : Number(value)
  }
  return result
}

// ─────────────────────────────────────────────
// COOLDOWNS PERSISTENTES
// ─────────────────────────────────────────────

export function checkAndSetCooldown(userId, action, cooldownMs) {
  const key = `${userId}:${action}`
  const now = Date.now()

  const row = S.getCooldown.get(key)
  if (row && row.expires_at > now) {
    const remaining = Math.ceil((row.expires_at - now) / 1000)
    return { onCooldown: true, remaining }
  }

  S.setCooldown.run(key, now + cooldownMs)
  return { onCooldown: false, remaining: 0 }
}

export function clearCooldown(userId, action) {
  S.deleteCooldown.run(`${userId}:${action}`)
}

/**
 * Remove cooldowns expirados do banco.
 * Chamado pelo scheduler a cada hora — não mais inline no checkAndSetCooldown.
 */
export function purgeExpiredCooldowns() {
  const r = S.purgeExpiredCooldowns.run(Date.now())
  if (r.changes > 0) console.log(`[DB] Purge: ${r.changes} cooldown(s) expirado(s) removido(s)`)
  return r.changes
}

/** Remove registros de temp_modal_data com mais de 1 hora (TTL já expirado) */
export function purgeExpiredTempData() {
  const r = db.prepare("DELETE FROM temp_modal_data WHERE created_at < ?").run(Date.now() - 3_600_000)
  if (r.changes > 0) console.log(`[DB] Purge: ${r.changes} temp_modal(s) expirado(s) removido(s)`)
  return r.changes
}

// ─────────────────────────────────────────────
// ESTATÍSTICAS
// ─────────────────────────────────────────────

export function getStats() {
  const tickets = S.ticketStats.all()
  const anns    = S.annGroupStats.all()
  const negs    = S.negGroupStats.all()
  const tm  = rows => Object.fromEntries(rows.map(r => [r.status, r.cnt]))
  const tm2 = rows => rows.reduce((s, r) => s + r.cnt, 0)
  const t = tm(tickets); const a = tm(anns); const n = tm(negs)
  return {
    totalTickets:          tm2(tickets),
    openTickets:           t.open ?? 0,
    closedTickets:         t.closed ?? 0,
    totalAnnouncements:    tm2(anns),
    activeAnnouncements:   a.approved ?? 0,
    pendingAnnouncements:  a.pending ?? 0,
    soldAnnouncements:     a.sold ?? 0,
    totalNegotiations:     tm2(negs),
    completedNegotiations: n.completed ?? 0,
    blacklistedUsers:      S.countBlacklist.get().c,
    activeAlerts:          S.countActiveAlerts.get().c,
    activeReservations:    S.countActiveRes.get().c,
    autoBumpsActive:       S.countActiveBumps.get().c,
  }
}

export function getWeeklyStats() {
  const r = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM tickets WHERE created_at >= datetime('now','-7 days'))       as newTickets,
      (SELECT COUNT(*) FROM tickets WHERE closed_at >= datetime('now','-7 days'))         as closedTickets,
      (SELECT COUNT(*) FROM announcements WHERE created_at >= datetime('now','-7 days'))  as newAnnouncements,
      (SELECT COUNT(*) FROM announcements WHERE approved_at >= datetime('now','-7 days')) as approvedAds,
      (SELECT COUNT(*) FROM announcements WHERE sold_at >= datetime('now','-7 days'))     as soldCount,
      (SELECT IFNULL(SUM(valor),0) FROM announcements WHERE sold_at >= datetime('now','-7 days')) as totalRevenue,
      (SELECT COUNT(*) FROM negotiations WHERE created_at >= datetime('now','-7 days'))   as newNegotiations,
      (SELECT COUNT(*) FROM negotiations WHERE completed_at >= datetime('now','-7 days')) as completedNegs,
      (SELECT COUNT(*) FROM ratings WHERE created_at >= datetime('now','-7 days'))        as newRatings,
      (SELECT ROUND(AVG(stars),1) FROM ratings WHERE created_at >= datetime('now','-7 days')) as avgRating
  `).get()

  const topRow = db.prepare(`
    SELECT a.user_id, COUNT(*) as cnt
    FROM announcements a
    WHERE a.sold_at >= datetime('now','-7 days')
    GROUP BY a.user_id ORDER BY cnt DESC LIMIT 1
  `).get()

  return {
    ...r,
    totalRevenue: (r.totalRevenue ?? 0).toFixed(2),
    avgRating: r.avgRating ?? "N/A",
    topSeller: topRow ? [topRow.user_id, topRow.cnt] : null,
  }
}

export function getAnnouncementStats() {
  return S.annStats.get()
}

export function getAllSuspiciousUsers() {
  const suspicious = []
  const flagMap = new Map()
  const ensureUser = uid => { if (!flagMap.has(uid)) flagMap.set(uid, []); return flagMap.get(uid) }

  for (const r of S.rejectedSuspicious.all())
    ensureUser(r.user_id).push({ type: "many_rejections", count: r.c })

  for (const r of S.sharedUUIDs.all()) {
    const sellers = r.sellers.split(",")
    for (const uid of sellers)
      ensureUser(uid).push({ type: "shared_uuid", uuid: r.uuid, sellers })
  }

  for (const r of S.cancelledNegsSuspicious.all())
    ensureUser(r.user_id).push({ type: "many_cancelled_negotiations", count: r.c })

  for (const [uid, flags] of flagMap) suspicious.push({ uid, flags })
  return suspicious
}

export function getUserSuspiciousActivity(userId) {
  const flags = []
  const rejections = S.userRejections.get(userId).c
  if (rejections >= 3) flags.push({ type: "many_rejections", count: rejections })

  const uuids = S.userUUIDs.all(userId).map(r => r.uuid)
  for (const uuid of uuids) {
    const sellers = getDuplicateAccountSellers(uuid)
    if (sellers.length > 1) flags.push({ type: "shared_uuid", uuid, sellers })
  }

  const cancelled = S.userCancelled.get(userId, userId).c
  if (cancelled >= 3) flags.push({ type: "many_cancelled_negotiations", count: cancelled })
  return flags
}

export function saveWeeklyReport(stats) {
  addLog("weekly_report", "system", null, JSON.stringify(stats))
}

// ─────────────────────────────────────────────
// FAVORITOS
// ─────────────────────────────────────────────

export function addFavorite(userId, announcementId) {
  const r = S.addFavorite.run(userId, announcementId)
  return r.changes > 0
}

export function removeFavorite(userId, announcementId) {
  const r = S.removeFavorite.run(userId, announcementId)
  return r.changes > 0
}

export function isFavorited(userId, announcementId) {
  return !!S.isFavorited.get(userId, announcementId)
}

export function getUserFavorites(userId) {
  return S.getUserFavorites.all(userId)
}

/** Retorna IDs de todos os usuários que favoritaram um anúncio */
export function getFavoriters(announcementId) {
  return S.getFavoriters.all(announcementId).map(r => r.user_id)
}

export function countFavoriters(announcementId) {
  return S.countFavoriters.get(announcementId).c
}

/** Remove todos os favoritos de um anúncio (ex: quando expirar/for vendido) */
export function deleteFavoritesByAnnouncement(announcementId) {
  S.deleteFavsByAnn.run(announcementId)
}
