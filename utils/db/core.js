/**
 * utils/db/core.js
 *
 * Núcleo do banco de dados:
 *  - Instância SQLite e acesso via getDb()
 *  - Migrations com controle de versão
 *  - Todos os prepared statements no objeto S (compartilhado com sub-módulos)
 *  - Helpers de serialização (rowToAnnouncement, etc.)
 *
 * Melhoria: Migration v6 — índices compostos para buscas frequentes.
 */

import Database from "better-sqlite3"
import { mkdirSync, copyFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { fileLog } from "../fileLogger.js"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH   = join(__dirname, "..", "..", "bot-data.sqlite")

const SCHEMA_VERSION = 10

// ─── Instância singleton ────────────────────────────────────────────────────
let _db = null

/** Retorna a instância do banco (lança se initDatabase() não foi chamado). */
export function getDb() {
  if (!_db) throw new Error("[DB] Banco não inicializado — chame initDatabase() primeiro.")
  return _db
}

/** Compatibilidade retroativa com código legado. */
export function getDatabase() { return getDb() }

export function saveDatabase()     { /* no-op: SQLite WAL escreve automaticamente */ }
export function saveDatabaseSync() {
  try { getDb().pragma("wal_checkpoint(FULL)") }
  catch (err) { fileLog.error({ err: err.message }, "[DB] Erro no checkpoint") }
}

// ─── Namespace de prepared statements (populado em prepareStatements()) ─────
// Importado pelos sub-módulos como `import { S } from './core.js'`
export const S = {}

// ─── Init ───────────────────────────────────────────────────────────────────

export function initDatabase() {
  mkdirSync(dirname(DB_PATH), { recursive: true })
  _db = new Database(DB_PATH)

  _db.pragma("journal_mode = WAL")
  _db.pragma("synchronous = NORMAL")
  _db.pragma("foreign_keys = ON")
  _db.pragma("cache_size = -8000") // 8 MB

  runMigrations()
  prepareStatements()
  fileLog.info({ path: DB_PATH }, "[DB] SQLite inicializado")
}

// ─── Migrations ─────────────────────────────────────────────────────────────

// ─── Reparo de FKs corrompidas ──────────────────────────────────────────────
// Chamado incondicionalmente ao iniciar. Corrige tabelas cujas FOREIGN KEYs
// foram corrompidas por tentativas anteriores de migration que usaram
// ALTER TABLE ... RENAME TO em tabelas pai (o SQLite propaga o rename para
// todas as FKs filhas automaticamente).
//
// Regra invariável: usar CREATE _new → INSERT → DROP original → RENAME _new.
// Nunca renomear a tabela sendo reparada (criaria o mesmo problema em cascata).
function repairForeignKeys() {
  _db.pragma("foreign_keys = OFF")
  try {
    // Tabelas temporárias que podem ter ficado de execuções anteriores
    for (const t of ["negotiations_fk_fix", "negotiations_new",
                     "favorites_fk_fix",    "favorites_new",
                     "offers_new", "payment_proofs_new", "ratings_new"]) {
      if (_db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='${t}'`).get()) {
        _db.exec(`DROP TABLE "${t}"`)
        fileLog.warn({ table: t }, "[DB] Reparo FK: removida tabela temporária órfã")
      }
    }

    function fkTarget(table) {
      return _db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(r => r.table)
    }

    // ── negotiations: deve apontar para announcements ─────────────────────
    const negTargets = fkTarget("negotiations")
    if (negTargets.length > 0 && negTargets.some(t => t !== "announcements")) {
      fileLog.warn("[DB] Reparo FK: reconstruindo negotiations")
      _db.exec(`
        CREATE TABLE negotiations_new (
          id                         INTEGER PRIMARY KEY AUTOINCREMENT,
          announcement_id            INTEGER NOT NULL,
          buyer_id                   TEXT NOT NULL,
          seller_id                  TEXT NOT NULL,
          ticket_channel_id          TEXT NOT NULL UNIQUE,
          status                     TEXT NOT NULL DEFAULT 'active',
          escrow_seller_confirmed    INTEGER DEFAULT 0,
          escrow_buyer_confirmed     INTEGER DEFAULT 0,
          escrow_seller_confirmed_at TEXT,
          escrow_buyer_confirmed_at  TEXT,
          escrow_intermediary        TEXT,
          escrow_intermediary_at     TEXT,
          created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
          completed_at               TEXT,
          last_activity_at           TEXT,
          buyer_last_seen_at         TEXT,
          timeout_warned             INTEGER DEFAULT 0,
          middleman_id               TEXT,
          middleman_status           TEXT,
          middleman_requested_by     TEXT,
          middleman_requested_at     TEXT,
          middleman_accepted_at      TEXT,
          middleman_resolved_at      TEXT,
          middleman_resolution       TEXT,
          FOREIGN KEY (announcement_id) REFERENCES announcements(id)
        )
      `)
      _db.prepare(`INSERT INTO negotiations_new SELECT
        id, announcement_id, buyer_id, seller_id, ticket_channel_id, status,
        escrow_seller_confirmed, escrow_buyer_confirmed,
        escrow_seller_confirmed_at, escrow_buyer_confirmed_at,
        escrow_intermediary, escrow_intermediary_at,
        created_at, completed_at, last_activity_at, buyer_last_seen_at, timeout_warned,
        middleman_id, middleman_status, middleman_requested_by, middleman_requested_at,
        middleman_accepted_at, middleman_resolved_at, middleman_resolution
        FROM negotiations`).run()
      _db.exec(`DROP TABLE negotiations`)
      _db.exec(`ALTER TABLE negotiations_new RENAME TO negotiations`)
      _db.exec(`
        CREATE INDEX IF NOT EXISTS idx_neg_channel       ON negotiations(ticket_channel_id);
        CREATE INDEX IF NOT EXISTS idx_neg_buyer         ON negotiations(buyer_id);
        CREATE INDEX IF NOT EXISTS idx_neg_seller        ON negotiations(seller_id);
        CREATE INDEX IF NOT EXISTS idx_neg_ann           ON negotiations(announcement_id);
        CREATE INDEX IF NOT EXISTS idx_neg_ann_status    ON negotiations(announcement_id, status);
        CREATE INDEX IF NOT EXISTS idx_neg_buyer_status  ON negotiations(buyer_id, status);
        CREATE INDEX IF NOT EXISTS idx_neg_seller_status ON negotiations(seller_id, status);
      `)
      fileLog.info("[DB] Reparo FK: negotiations OK")
    }

    // ── offers: deve apontar para negotiations ────────────────────────────
    const offTargets = fkTarget("offers")
    if (offTargets.length > 0 && offTargets.some(t => t !== "negotiations")) {
      fileLog.warn("[DB] Reparo FK: reconstruindo offers")
      _db.exec(`
        CREATE TABLE offers_new (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          negotiation_id INTEGER NOT NULL,
          from_user_id   TEXT NOT NULL,
          to_user_id     TEXT NOT NULL,
          value          TEXT NOT NULL,
          message        TEXT,
          status         TEXT NOT NULL DEFAULT 'pending',
          created_at     TEXT NOT NULL DEFAULT (datetime('now')),
          responded_at   TEXT,
          FOREIGN KEY (negotiation_id) REFERENCES negotiations(id)
        )
      `)
      _db.prepare(`INSERT INTO offers_new SELECT
        id, negotiation_id, from_user_id, to_user_id, value, message,
        status, created_at, responded_at FROM offers`).run()
      _db.exec(`DROP TABLE offers`)
      _db.exec(`ALTER TABLE offers_new RENAME TO offers`)
      _db.exec(`CREATE INDEX IF NOT EXISTS idx_offers_neg ON offers(negotiation_id)`)
      fileLog.info("[DB] Reparo FK: offers OK")
    }

    // ── payment_proofs: deve apontar para negotiations ────────────────────
    const prTargets = fkTarget("payment_proofs")
    if (prTargets.length > 0 && prTargets.some(t => t !== "negotiations")) {
      fileLog.warn("[DB] Reparo FK: reconstruindo payment_proofs")
      _db.exec(`
        CREATE TABLE payment_proofs_new (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          negotiation_id INTEGER NOT NULL,
          user_id        TEXT NOT NULL,
          url            TEXT NOT NULL,
          filename       TEXT,
          created_at     TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY (negotiation_id) REFERENCES negotiations(id)
        )
      `)
      _db.prepare(`INSERT INTO payment_proofs_new SELECT
        id, negotiation_id, user_id, url, filename, created_at FROM payment_proofs`).run()
      _db.exec(`DROP TABLE payment_proofs`)
      _db.exec(`ALTER TABLE payment_proofs_new RENAME TO payment_proofs`)
      _db.exec(`CREATE INDEX IF NOT EXISTS idx_proofs_neg ON payment_proofs(negotiation_id)`)
      fileLog.info("[DB] Reparo FK: payment_proofs OK")
    }

    // ── ratings: deve apontar para negotiations ────────────────────────────
    const ratTargets = fkTarget("ratings")
    if (ratTargets.length > 0 && ratTargets.some(t => t !== "negotiations")) {
      fileLog.warn("[DB] Reparo FK: reconstruindo ratings")
      _db.exec(`
        CREATE TABLE ratings_new (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          negotiation_id INTEGER NOT NULL,
          rater_id       TEXT NOT NULL,
          rated_id       TEXT NOT NULL,
          stars          INTEGER NOT NULL,
          comment        TEXT,
          created_at     TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(negotiation_id, rater_id),
          FOREIGN KEY (negotiation_id) REFERENCES negotiations(id)
        )
      `)
      _db.prepare(`INSERT INTO ratings_new SELECT
        id, negotiation_id, rater_id, rated_id, stars, comment, created_at FROM ratings`).run()
      _db.exec(`DROP TABLE ratings`)
      _db.exec(`ALTER TABLE ratings_new RENAME TO ratings`)
      _db.exec(`CREATE INDEX IF NOT EXISTS idx_ratings_rated ON ratings(rated_id)`)
      fileLog.info("[DB] Reparo FK: ratings OK")
    }

    // ── favorites: deve apontar para announcements ────────────────────────
    const favTargets = fkTarget("favorites")
    if (favTargets.length > 0 && favTargets.some(t => t !== "announcements")) {
      fileLog.warn("[DB] Reparo FK: reconstruindo favorites")
      _db.exec(`
        CREATE TABLE favorites_new (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id         TEXT NOT NULL,
          announcement_id INTEGER NOT NULL,
          created_at      TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, announcement_id),
          FOREIGN KEY (announcement_id) REFERENCES announcements(id)
        )
      `)
      _db.prepare(`INSERT INTO favorites_new SELECT
        id, user_id, announcement_id, created_at FROM favorites`).run()
      _db.exec(`DROP TABLE favorites`)
      _db.exec(`ALTER TABLE favorites_new RENAME TO favorites`)
      _db.exec(`
        CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id);
        CREATE INDEX IF NOT EXISTS idx_fav_ann  ON favorites(announcement_id);
      `)
      fileLog.info("[DB] Reparo FK: favorites OK")
    }

  } catch (err) {
    fileLog.error({ err: err.message }, "[DB] Erro no reparo de FK — verifique o banco")
  } finally {
    _db.pragma("foreign_keys = ON")
  }
}


function runMigrations() {
  _db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER NOT NULL,
      applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const row = _db.prepare("SELECT MAX(version) as v FROM schema_version").get()
  const currentVersion = row?.v ?? 0

  // Reparo incondicional de FKs corrompidas por tentativas anteriores de migration
  repairForeignKeys()

  // Backup automático antes de aplicar migrations pendentes
  if (currentVersion > 0 && currentVersion < SCHEMA_VERSION) {
    try {
      const backupDir = join(__dirname, "..", "..", "backups")
      mkdirSync(backupDir, { recursive: true })
      const ts   = new Date().toISOString().replace(/[:.]/g, "-")
      const dest = join(backupDir, `pre-migration-v${currentVersion + 1}-${ts}.sqlite`)
      copyFileSync(DB_PATH, dest)
      fileLog.info({ dest }, "[DB] Backup pré-migration criado")
    } catch (e) {
      fileLog.warn({ err: e.message }, "[DB] Backup pré-migration falhou")
    }
  }

  // Migration 1: Schema base
  if (currentVersion < 1) {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id      TEXT NOT NULL UNIQUE,
        user_id         TEXT NOT NULL,
        type            TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'open',
        claimed_by      TEXT,
        claimed_at      TEXT,
        voice_channel_id TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at       TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets(channel_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_user    ON tickets(user_id);
      CREATE INDEX IF NOT EXISTS idx_tickets_status  ON tickets(status);

      CREATE TABLE IF NOT EXISTS announcements (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_id            INTEGER,
        user_id              TEXT NOT NULL,
        nick                 TEXT NOT NULL,
        uuid                 TEXT,
        bans                 TEXT,
        capas                TEXT,
        vips                 TEXT,
        tags                 TEXT,
        medalhas             TEXT,
        wins_level           TEXT,
        cosmeticos           TEXT,
        valor                REAL NOT NULL DEFAULT 0,
        status               TEXT NOT NULL DEFAULT 'pending',
        message_id           TEXT,
        approved_at          TEXT,
        approved_by          TEXT,
        rejected_by          TEXT,
        rejected_reason      TEXT,
        rejected_at          TEXT,
        sold_at              TEXT,
        expired_at           TEXT,
        bumped_at            TEXT,
        expiration_notified  INTEGER DEFAULT 0,
        created_at           TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ann_user   ON announcements(user_id);
      CREATE INDEX IF NOT EXISTS idx_ann_status ON announcements(status);
      CREATE INDEX IF NOT EXISTS idx_ann_uuid   ON announcements(uuid);
      CREATE INDEX IF NOT EXISTS idx_ann_nick   ON announcements(nick COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_ann_valor  ON announcements(valor);

      CREATE TABLE IF NOT EXISTS negotiations (
        id                        INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id           INTEGER NOT NULL,
        buyer_id                  TEXT NOT NULL,
        seller_id                 TEXT NOT NULL,
        ticket_channel_id         TEXT NOT NULL UNIQUE,
        status                    TEXT NOT NULL DEFAULT 'active',
        escrow_seller_confirmed   INTEGER DEFAULT 0,
        escrow_buyer_confirmed    INTEGER DEFAULT 0,
        escrow_seller_confirmed_at TEXT,
        escrow_buyer_confirmed_at  TEXT,
        escrow_intermediary        TEXT,
        escrow_intermediary_at     TEXT,
        created_at                 TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at               TEXT,
        FOREIGN KEY (announcement_id) REFERENCES announcements(id)
      );
      CREATE INDEX IF NOT EXISTS idx_neg_channel ON negotiations(ticket_channel_id);
      CREATE INDEX IF NOT EXISTS idx_neg_buyer   ON negotiations(buyer_id);
      CREATE INDEX IF NOT EXISTS idx_neg_seller  ON negotiations(seller_id);
      CREATE INDEX IF NOT EXISTS idx_neg_ann     ON negotiations(announcement_id);

      CREATE TABLE IF NOT EXISTS offers (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        negotiation_id INTEGER NOT NULL,
        from_user_id   TEXT NOT NULL,
        to_user_id     TEXT NOT NULL,
        value          TEXT NOT NULL,
        message        TEXT,
        status         TEXT NOT NULL DEFAULT 'pending',
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        responded_at   TEXT,
        FOREIGN KEY (negotiation_id) REFERENCES negotiations(id)
      );
      CREATE INDEX IF NOT EXISTS idx_offers_neg ON offers(negotiation_id);

      CREATE TABLE IF NOT EXISTS blacklist (
        user_id    TEXT PRIMARY KEY,
        reason     TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS ratings (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        negotiation_id INTEGER NOT NULL,
        rater_id       TEXT NOT NULL,
        rated_id       TEXT NOT NULL,
        stars          INTEGER NOT NULL,
        comment        TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(negotiation_id, rater_id)
      );
      CREATE INDEX IF NOT EXISTS idx_ratings_rated ON ratings(rated_id);

      CREATE TABLE IF NOT EXISTS reservations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id INTEGER NOT NULL,
        seller_id       TEXT NOT NULL,
        buyer_id        TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'active',
        expires_at      TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        cancelled_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_res_ann    ON reservations(announcement_id);
      CREATE INDEX IF NOT EXISTS idx_res_status ON reservations(status);

      CREATE TABLE IF NOT EXISTS alerts (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          TEXT NOT NULL,
        nick_filter      TEXT,
        min_price        REAL,
        max_price        REAL,
        vip_filter       TEXT,
        active           INTEGER DEFAULT 1,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        last_triggered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_user   ON alerts(user_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(active);

      CREATE TABLE IF NOT EXISTS auto_bumps (
        announcement_id INTEGER PRIMARY KEY,
        user_id         TEXT NOT NULL,
        active          INTEGER DEFAULT 1,
        last_bumped_at  TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS temp_modal_data (
        id         TEXT PRIMARY KEY,
        data       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS edit_logs (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id INTEGER NOT NULL,
        user_id         TEXT NOT NULL,
        campo           TEXT NOT NULL,
        old_value       TEXT,
        new_value       TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_editlogs_ann ON edit_logs(announcement_id);

      CREATE TABLE IF NOT EXISTS logs (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        action     TEXT NOT NULL,
        user_id    TEXT,
        target_id  TEXT,
        details    TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_logs_action  ON logs(action);
      CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);

      CREATE TABLE IF NOT EXISTS payment_proofs (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        negotiation_id INTEGER NOT NULL,
        user_id        TEXT NOT NULL,
        url            TEXT NOT NULL,
        filename       TEXT,
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (negotiation_id) REFERENCES negotiations(id)
      );
      CREATE INDEX IF NOT EXISTS idx_proofs_neg ON payment_proofs(negotiation_id);

      CREATE TABLE IF NOT EXISTS config_store (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS inactivity_warnings (
        channel_id      TEXT PRIMARY KEY,
        warned_at       TEXT NOT NULL,
        last_message_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cooldowns (
        key        TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cooldowns_expires ON cooldowns(expires_at);
    `)
    _db.prepare("INSERT INTO schema_version (version) VALUES (1)").run()
    fileLog.info("[DB] Migration v1 aplicada (schema base)")
  }

  // Migration 2: valor TEXT → REAL
  if (currentVersion < 2) {
    try {
      const info = _db.pragma("table_info(announcements)")
      const valorCol = info.find(c => c.name === "valor")
      if (valorCol && valorCol.type.toUpperCase() === "TEXT") {
        _db.exec(`
          BEGIN;
          ALTER TABLE announcements RENAME TO announcements_old;
          CREATE TABLE announcements (
            id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER,
            user_id TEXT NOT NULL, nick TEXT NOT NULL, uuid TEXT,
            bans TEXT, capas TEXT, vips TEXT, tags TEXT, medalhas TEXT,
            wins_level TEXT, cosmeticos TEXT, valor REAL NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending', message_id TEXT,
            approved_at TEXT, approved_by TEXT, rejected_by TEXT,
            rejected_reason TEXT, rejected_at TEXT, sold_at TEXT,
            expired_at TEXT, bumped_at TEXT, expiration_notified INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
          INSERT INTO announcements SELECT
            id, ticket_id, user_id, nick, uuid, bans, capas, vips, tags, medalhas,
            wins_level, cosmeticos,
            CAST(REPLACE(REPLACE(valor, '.', ''), ',', '.') AS REAL),
            status, message_id, approved_at, approved_by, rejected_by,
            rejected_reason, rejected_at, sold_at, expired_at, bumped_at,
            expiration_notified, created_at
          FROM announcements_old;
          DROP TABLE announcements_old;
          CREATE INDEX IF NOT EXISTS idx_ann_user   ON announcements(user_id);
          CREATE INDEX IF NOT EXISTS idx_ann_status ON announcements(status);
          CREATE INDEX IF NOT EXISTS idx_ann_uuid   ON announcements(uuid);
          CREATE INDEX IF NOT EXISTS idx_ann_nick   ON announcements(nick COLLATE NOCASE);
          CREATE INDEX IF NOT EXISTS idx_ann_valor  ON announcements(valor);
          COMMIT;
        `)
      }
    } catch (err) { fileLog.error({ err: err.message }, "[DB] Erro na migration v2") }
    _db.prepare("INSERT INTO schema_version (version) VALUES (2)").run()
    fileLog.info("[DB] Migration v2 aplicada (valor TEXT → REAL)")
  }

  // Migration 3: tabela de favoritos
  if (currentVersion < 3) {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS favorites (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id         TEXT NOT NULL,
        announcement_id INTEGER NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(user_id, announcement_id),
        FOREIGN KEY (announcement_id) REFERENCES announcements(id)
      );
      CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id);
      CREATE INDEX IF NOT EXISTS idx_fav_ann  ON favorites(announcement_id);
    `)
    _db.prepare("INSERT INTO schema_version (version) VALUES (3)").run()
    fileLog.info("[DB] Migration v3 aplicada (tabela favorites)")
  }

  // Migration 4: photo_url + last_activity_at em negociações
  if (currentVersion < 4) {
    try { _db.exec(`ALTER TABLE announcements ADD COLUMN photo_url TEXT`) }         catch (e) { if (!e.message.includes("duplicate column")) throw e }
    try { _db.exec(`ALTER TABLE negotiations ADD COLUMN last_activity_at TEXT`) }   catch (e) { if (!e.message.includes("duplicate column")) throw e }
    _db.prepare("INSERT INTO schema_version (version) VALUES (4)").run()
    fileLog.info("[DB] Migration v4 aplicada (photo_url, last_activity_at)")
  }

  // Migration 5: sistema de middleman
  if (currentVersion < 5) {
    const cols = [
      "middleman_id TEXT", "middleman_status TEXT", "middleman_requested_by TEXT",
      "middleman_requested_at TEXT", "middleman_accepted_at TEXT",
      "middleman_resolved_at TEXT", "middleman_resolution TEXT",
    ]
    for (const col of cols) {
      try { _db.exec(`ALTER TABLE negotiations ADD COLUMN ${col}`) }
      catch (e) { if (!e.message.includes("duplicate column")) throw e }
    }
    _db.prepare("INSERT INTO schema_version (version) VALUES (5)").run()
    fileLog.info("[DB] Migration v5 aplicada (sistema de middleman)")
  }

  // Migration 6: índices compostos para queries frequentes
  // Resolve o bottleneck de busca announcement_id + status e user + status
  if (currentVersion < 6) {
    _db.exec(`
      CREATE INDEX IF NOT EXISTS idx_neg_ann_status
        ON negotiations(announcement_id, status);
      CREATE INDEX IF NOT EXISTS idx_neg_buyer_status
        ON negotiations(buyer_id, status);
      CREATE INDEX IF NOT EXISTS idx_neg_seller_status
        ON negotiations(seller_id, status);
      CREATE INDEX IF NOT EXISTS idx_ann_user_status
        ON announcements(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_ann_status_bumped
        ON announcements(status, bumped_at);
      CREATE INDEX IF NOT EXISTS idx_ann_status_created
        ON announcements(status, created_at DESC);
    `)
    _db.prepare("INSERT INTO schema_version (version) VALUES (6)").run()
    fileLog.info("[DB] Migration v6 aplicada (índices compostos)")
  }

  // Migration 7: timeout de inatividade do comprador em negociações
  if (currentVersion < 7) {
    try { _db.exec(`ALTER TABLE negotiations ADD COLUMN buyer_last_seen_at TEXT`) }
    catch (e) { if (!e.message.includes("duplicate column")) throw e }
    try { _db.exec(`ALTER TABLE negotiations ADD COLUMN timeout_warned INTEGER DEFAULT 0`) }
    catch (e) { if (!e.message.includes("duplicate column")) throw e }
    _db.exec(`UPDATE negotiations SET buyer_last_seen_at = created_at WHERE buyer_last_seen_at IS NULL`)
    _db.prepare("INSERT INTO schema_version (version) VALUES (7)").run()
    fileLog.info("[DB] Migration v7 aplicada (buyer_last_seen_at, timeout_warned)")
  }

  // Migration 8: tabela de notificações de anúncios
  if (currentVersion < 8) {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        user_id    TEXT    PRIMARY KEY,
        enabled    INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
      )
    `)
    _db.prepare("INSERT INTO schema_version (version) VALUES (8)").run()
    fileLog.info("[DB] Migration v8 aplicada (tabela notifications)")
  }

  // Migration 9: templates de anúncio
  if (currentVersion < 9) {
    _db.exec(`
      CREATE TABLE IF NOT EXISTS announcement_templates (
        user_id     TEXT PRIMARY KEY,
        nick        TEXT,
        bans        TEXT,
        capas       TEXT,
        vips        TEXT,
        tags        TEXT,
        medalhas    TEXT,
        wins_level  TEXT,
        cosmeticos  TEXT,
        valor       REAL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    _db.prepare("INSERT INTO schema_version (version) VALUES (9)").run()
    fileLog.info("[DB] Migration v9 aplicada (announcement_templates)")
  }

  // Migration 10: CHECK CONSTRAINT em announcements.status
  //
  // ESTRATÉGIA SEGURA: CREATE announcements_new → DROP announcements → RENAME.
  // Jamais renomear announcements diretamente, pois o SQLite propaga o novo
  // nome para as FKs de negotiations e favorites, corrompendo-as.
  // Rodar migration v10 se versão < 10, OU se já está em v10 mas o CHECK
  // ainda não existe (migration foi marcada como feita mas falhou parcialmente)
  const annDdlCheck = _db.prepare("SELECT sql FROM sqlite_master WHERE name='announcements'").get()?.sql ?? ""
  if (currentVersion < 10 || (currentVersion >= 10 && !annDdlCheck.includes("CHECK"))) {
    _db.pragma("foreign_keys = OFF")
    try {
      // Limpar resíduos de tentativas anteriores sem corromper FKs
      const stale = ["announcements_v9", "announcements_new", "announcements_new2"]
      for (const t of stale) {
        if (_db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='${t}'`).get()) {
          _db.exec(`DROP TABLE "${t}"`)
          fileLog.warn({ table: t }, "[DB] Migration v10: removida tabela residual")
        }
      }

      const annDdlInner = _db.prepare("SELECT sql FROM sqlite_master WHERE name='announcements'").get()?.sql ?? ""
      if (!annDdlInner.includes("CHECK")) {
        _db.transaction(() => {
          _db.exec(`
            CREATE TABLE announcements_new (
              id                   INTEGER PRIMARY KEY AUTOINCREMENT,
              ticket_id            INTEGER,
              user_id              TEXT NOT NULL,
              nick                 TEXT NOT NULL,
              uuid                 TEXT,
              bans                 TEXT,
              capas                TEXT,
              vips                 TEXT,
              tags                 TEXT,
              medalhas             TEXT,
              wins_level           TEXT,
              cosmeticos           TEXT,
              valor                REAL NOT NULL DEFAULT 0,
              status               TEXT NOT NULL DEFAULT 'pending'
                                     CHECK(status IN ('pending','approved','rejected','sold','expired')),
              message_id           TEXT,
              approved_at          TEXT,
              approved_by          TEXT,
              rejected_by          TEXT,
              rejected_reason      TEXT,
              rejected_at          TEXT,
              sold_at              TEXT,
              expired_at           TEXT,
              bumped_at            TEXT,
              expiration_notified  INTEGER DEFAULT 0,
              created_at           TEXT NOT NULL DEFAULT (datetime('now')),
              photo_url            TEXT
            )
          `)
          _db.prepare(`
            INSERT INTO announcements_new SELECT
              id, ticket_id, user_id, nick, uuid, bans, capas, vips, tags, medalhas,
              wins_level, cosmeticos, valor, status, message_id, approved_at, approved_by,
              rejected_by, rejected_reason, rejected_at, sold_at, expired_at, bumped_at,
              expiration_notified, created_at, photo_url
            FROM announcements
          `).run()
          _db.exec(`DROP TABLE announcements`)
          _db.exec(`ALTER TABLE announcements_new RENAME TO announcements`)
          _db.exec(`
            CREATE INDEX IF NOT EXISTS idx_ann_user           ON announcements(user_id);
            CREATE INDEX IF NOT EXISTS idx_ann_status         ON announcements(status);
            CREATE INDEX IF NOT EXISTS idx_ann_uuid           ON announcements(uuid);
            CREATE INDEX IF NOT EXISTS idx_ann_nick           ON announcements(nick COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_ann_valor          ON announcements(valor);
            CREATE INDEX IF NOT EXISTS idx_ann_user_status    ON announcements(user_id, status);
            CREATE INDEX IF NOT EXISTS idx_ann_status_bumped  ON announcements(status, bumped_at);
            CREATE INDEX IF NOT EXISTS idx_ann_status_created ON announcements(status, created_at DESC);
          `)
        })()
      }
    } catch (err) {
      fileLog.error({ err: err.message }, "[DB] Erro na migration v10")
    } finally {
      _db.pragma("foreign_keys = ON")
    }
    if (currentVersion < 10) {
      _db.prepare("INSERT INTO schema_version (version) VALUES (10)").run()
    }
    fileLog.info("[DB] Migration v10 aplicada (CHECK CONSTRAINT em announcements.status)")
  }
}


// ─── Helpers de serialização ────────────────────────────────────────────────

export function rowToAnnouncement(row) {
  if (!row) return null
  return { ...row, expiration_notified: row.expiration_notified === 1 }
}

export function rowToNegotiation(row) {
  if (!row) return null
  return {
    ...row,
    escrow: {
      seller_confirmed:    row.escrow_seller_confirmed === 1,
      buyer_confirmed:     row.escrow_buyer_confirmed  === 1,
      seller_confirmed_at: row.escrow_seller_confirmed_at,
      buyer_confirmed_at:  row.escrow_buyer_confirmed_at,
      intermediary:        row.escrow_intermediary,
      intermediary_at:     row.escrow_intermediary_at,
    },
  }
}

export function alertRowToObj(row) {
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

export function parseValor(v) {
  if (typeof v === "number") return v
  const s = String(v).trim()
  if (s.includes(",")) return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0
  return parseFloat(s) || 0
}

// ─── Prepared statements ────────────────────────────────────────────────────

function prepareStatements() {
  const db = _db

  // ── Tickets ──
  S.createTicket          = db.prepare(`INSERT INTO tickets (channel_id, user_id, type) VALUES (?, ?, ?)`)
  S.getTicket             = db.prepare(`SELECT * FROM tickets WHERE channel_id = ?`)
  S.getTicketById         = db.prepare(`SELECT * FROM tickets WHERE id = ?`)
  S.getUserOpenTickets    = db.prepare(`SELECT * FROM tickets WHERE user_id = ? AND type = ? AND status = 'open'`)
  S.getAllUserOpenTickets  = db.prepare(`SELECT * FROM tickets WHERE user_id = ? AND status = 'open'`)
  S.closeTicket           = db.prepare(`UPDATE tickets SET status = 'closed', closed_at = datetime('now') WHERE channel_id = ?`)
  S.updateTicketClaimed   = db.prepare(`UPDATE tickets SET claimed_by = ?, claimed_at = datetime('now') WHERE channel_id = ?`)
  S.saveTicketVoice       = db.prepare(`UPDATE tickets SET voice_channel_id = ? WHERE channel_id = ?`)

  // ── Inatividade ──
  S.updateChannelActivity = db.prepare(`
    INSERT INTO inactivity_warnings (channel_id, warned_at, last_message_at)
    VALUES (?, '', datetime('now'))
    ON CONFLICT(channel_id) DO UPDATE SET last_message_at = datetime('now'), warned_at = ''
  `)
  S.getInactiveChannels   = db.prepare(`
    SELECT iw.channel_id, iw.last_message_at, iw.warned_at, t.user_id, t.type
    FROM inactivity_warnings iw
    JOIN tickets t ON t.channel_id = iw.channel_id
    WHERE t.status = 'open'
      AND iw.warned_at = ''
      AND (julianday('now') - julianday(iw.last_message_at)) * 24 >= ?
  `)
  S.markInactivityWarned  = db.prepare(`UPDATE inactivity_warnings SET warned_at = datetime('now') WHERE channel_id = ?`)
  S.getChannelsToAutoClose = db.prepare(`
    SELECT iw.channel_id, iw.warned_at, t.user_id
    FROM inactivity_warnings iw
    JOIN tickets t ON t.channel_id = iw.channel_id
    WHERE t.status = 'open'
      AND iw.warned_at != ''
      AND (julianday('now') - julianday(iw.warned_at)) * 24 >= ?
  `)

  // ── Anúncios ──
  S.createAnnouncement    = db.prepare(`
    INSERT INTO announcements
      (ticket_id, user_id, nick, uuid, bans, capas, vips, tags, medalhas, wins_level, cosmeticos, valor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  S.getAnnouncement       = db.prepare(`SELECT * FROM announcements WHERE id = ?`)
  S.getPendingAnns        = db.prepare(`SELECT * FROM announcements WHERE status = 'pending' ORDER BY created_at DESC`)
  S.getUserActiveAnns     = db.prepare(`SELECT * FROM announcements WHERE user_id = ? AND status IN ('pending','approved') ORDER BY created_at DESC`)
  S.getUserAllAnns        = db.prepare(`SELECT * FROM announcements WHERE user_id = ? AND NOT (status IN ('rejected','expired') AND created_at < datetime('now','-30 days')) ORDER BY created_at DESC`)
  S.getAllAnns            = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC`)
  S.getAnnsPaged          = db.prepare(`SELECT * FROM announcements ORDER BY created_at DESC LIMIT ? OFFSET ?`)
  S.countAnns             = db.prepare(`SELECT COUNT(*) as c FROM announcements`)
  S.getAnnsByStatus       = db.prepare(`SELECT * FROM announcements WHERE status = ? ORDER BY created_at DESC`)
  S.approveAnn            = db.prepare(`UPDATE announcements SET status = 'approved', message_id = ?, approved_at = datetime('now'), approved_by = ? WHERE id = ? AND status = 'pending'`)
  S.rejectAnn             = db.prepare(`UPDATE announcements SET status = 'rejected', rejected_by = ?, rejected_reason = ?, rejected_at = datetime('now') WHERE id = ? AND status = 'pending'`)
  S.markSold              = db.prepare(`UPDATE announcements SET status = 'sold', sold_at = datetime('now') WHERE id = ?`)
  S.markExpired           = db.prepare(`UPDATE announcements SET status = 'expired', expired_at = datetime('now') WHERE id = ?`)
  S.deleteAnn             = db.prepare(`DELETE FROM announcements WHERE id = ? AND status != 'sold'`)
  S.bumpAnn               = db.prepare(`UPDATE announcements SET bumped_at = datetime('now') WHERE id = ?`)
  S.getExpiredAnns        = db.prepare(`
    SELECT * FROM announcements
    WHERE status = 'approved'
      AND (julianday('now') - julianday(COALESCE(bumped_at, created_at))) >= ?
  `)
  S.getSoonExpiringAnns   = db.prepare(`
    SELECT * FROM announcements
    WHERE status = 'approved'
      AND expiration_notified = 0
      AND (julianday('now') - julianday(COALESCE(bumped_at, created_at))) >= ?
      AND (julianday('now') - julianday(COALESCE(bumped_at, created_at))) < ?
  `)
  S.markExpirationNotified = db.prepare(`UPDATE announcements SET expiration_notified = 1 WHERE id = ?`)
  S.getNickPriceHistory   = db.prepare(`SELECT valor, status, created_at FROM announcements WHERE nick = ? COLLATE NOCASE ORDER BY created_at ASC`)
  S.getAnnsByUUID         = db.prepare(`SELECT * FROM announcements WHERE uuid = ? AND status IN ('approved','pending')`)
  S.getAnnsByUUIDRecent   = db.prepare(`SELECT * FROM announcements WHERE uuid = ? AND created_at > datetime('now','-90 days') ORDER BY created_at DESC`)
  S.getAnnsByNick         = db.prepare(`SELECT * FROM announcements WHERE nick = ? COLLATE NOCASE`)
  S.getDupeSellers        = db.prepare(`SELECT DISTINCT user_id FROM announcements WHERE uuid = ?`)
  S.annStats              = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN status = 'pending'  THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'sold'     THEN 1 ELSE 0 END) as sold,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN status = 'expired'  THEN 1 ELSE 0 END) as expired
    FROM announcements
  `)
  S.updateAnnPhoto        = db.prepare(`UPDATE announcements SET photo_url = ? WHERE id = ?`)

  // ── Templates de anúncio ──
  S.saveTemplate          = db.prepare(`INSERT OR REPLACE INTO announcement_templates (user_id, nick, bans, capas, vips, tags, medalhas, wins_level, cosmeticos, valor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
  S.getTemplate           = db.prepare(`SELECT * FROM announcement_templates WHERE user_id = ?`)
  S.deleteTemplate        = db.prepare(`DELETE FROM announcement_templates WHERE user_id = ?`)

  // ── Perfil ──
  S.getUserAnnStats   = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as active,
      SUM(CASE WHEN status = 'sold'     THEN 1 ELSE 0 END) as sold,
      SUM(CASE WHEN status = 'sold'     THEN CAST(valor AS REAL) ELSE 0 END) as totalValue
    FROM announcements WHERE user_id = ?
  `)
  S.getLatestUserAnn  = db.prepare(`SELECT * FROM announcements WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`)

  // ── Ranking ──
  S.rankingBySales    = db.prepare(`
    SELECT a.user_id,
      SUM(CASE WHEN a.status = 'sold' THEN 1 ELSE 0 END) as sales,
      COUNT(*) as total,
      SUM(CASE WHEN a.status = 'sold' THEN CAST(a.valor AS REAL) ELSE 0 END) as totalValue,
      COALESCE(r.average, 0) as rating, COALESCE(r.cnt, 0) as ratingCount
    FROM announcements a
    LEFT JOIN (SELECT rated_id, ROUND(AVG(stars),1) as average, COUNT(*) as cnt FROM ratings GROUP BY rated_id) r
      ON r.rated_id = a.user_id
    GROUP BY a.user_id ORDER BY sales DESC, totalValue DESC LIMIT 15
  `)
  S.rankingByRating   = db.prepare(`
    SELECT r.rated_id as user_id, ROUND(AVG(r.stars),1) as rating, COUNT(*) as ratingCount,
      COALESCE(s.sales,0) as sales, COALESCE(s.totalValue,0) as totalValue, COALESCE(s.total,0) as total
    FROM ratings r
    LEFT JOIN (
      SELECT user_id,
        SUM(CASE WHEN status='sold' THEN 1 ELSE 0 END) as sales,
        SUM(CASE WHEN status='sold' THEN CAST(valor AS REAL) ELSE 0 END) as totalValue,
        COUNT(*) as total
      FROM announcements GROUP BY user_id
    ) s ON s.user_id = r.rated_id
    GROUP BY r.rated_id HAVING ratingCount >= 1
    ORDER BY rating DESC, ratingCount DESC LIMIT 15
  `)
  S.rankingByAnns     = db.prepare(`
    SELECT a.user_id, COUNT(*) as total,
      SUM(CASE WHEN a.status='sold' THEN 1 ELSE 0 END) as sales,
      SUM(CASE WHEN a.status='sold' THEN CAST(a.valor AS REAL) ELSE 0 END) as totalValue,
      COALESCE(r.average,0) as rating, COALESCE(r.cnt,0) as ratingCount
    FROM announcements a
    LEFT JOIN (SELECT rated_id, ROUND(AVG(stars),1) as average, COUNT(*) as cnt FROM ratings GROUP BY rated_id) r
      ON r.rated_id = a.user_id
    GROUP BY a.user_id ORDER BY total DESC, sales DESC LIMIT 15
  `)

  // ── Negociações ──
  S.createNeg             = db.prepare(`INSERT INTO negotiations (announcement_id, buyer_id, seller_id, ticket_channel_id) VALUES (?, ?, ?, ?)`)
  S.updateNegActivity     = db.prepare(`UPDATE negotiations SET last_activity_at = datetime('now') WHERE ticket_channel_id = ?`)
  S.getStuckNegs          = db.prepare(`SELECT * FROM negotiations WHERE status NOT IN ('completed','cancelled') AND created_at < datetime('now','-48 hours')`)
  S.getNegByChannel       = db.prepare(`SELECT * FROM negotiations WHERE ticket_channel_id = ?`)
  S.getNegById            = db.prepare(`SELECT * FROM negotiations WHERE id = ?`)
  S.completeNeg           = db.prepare(`UPDATE negotiations SET status = 'completed', completed_at = datetime('now') WHERE ticket_channel_id = ?`)
  S.cancelNeg             = db.prepare(`UPDATE negotiations SET status = 'cancelled', completed_at = datetime('now') WHERE ticket_channel_id = ?`)
  S.getUserActiveNegs     = db.prepare(`SELECT * FROM negotiations WHERE (buyer_id = ? OR seller_id = ?) AND status = 'active'`)
  S.getPurchaseHistory    = db.prepare(`SELECT * FROM negotiations WHERE buyer_id = ? AND status = 'completed' ORDER BY completed_at DESC`)
  S.negStatsBuyer         = db.prepare(`SELECT status, COUNT(*) as cnt FROM negotiations WHERE buyer_id = ? GROUP BY status`)
  S.negStatsSeller        = db.prepare(`SELECT status, COUNT(*) as cnt FROM negotiations WHERE seller_id = ? GROUP BY status`)

  S.updateBuyerActivity        = db.prepare(`UPDATE negotiations SET buyer_last_seen_at = datetime('now') WHERE id = ?`)
  S.getInactiveNegsForTimeout  = db.prepare(`
    SELECT * FROM negotiations
    WHERE status = 'active'
      AND buyer_last_seen_at IS NOT NULL
      AND (julianday('now') - julianday(buyer_last_seen_at)) * 24 >= ?
  `)
  S.getNegsNearTimeout         = db.prepare(`
    SELECT * FROM negotiations
    WHERE status = 'active'
      AND buyer_last_seen_at IS NOT NULL
      AND timeout_warned = 0
      AND (julianday('now') - julianday(buyer_last_seen_at)) * 24 >= ?
      AND (julianday('now') - julianday(buyer_last_seen_at)) * 24 < ?
  `)
  S.markNegTimeoutWarned       = db.prepare(`UPDATE negotiations SET timeout_warned = 1 WHERE id = ?`)

  // ── Escrow ──
  S.getEscrow             = db.prepare(`SELECT * FROM negotiations WHERE ticket_channel_id = ?`)
  S.setEscrowIntermediary = db.prepare(`UPDATE negotiations SET escrow_intermediary = ?, escrow_intermediary_at = datetime('now') WHERE ticket_channel_id = ?`)

  // ── Middleman ──
  S.getMiddlemanStatus    = db.prepare(`SELECT middleman_id, middleman_status, middleman_requested_by, middleman_requested_at, middleman_accepted_at, middleman_resolved_at, middleman_resolution FROM negotiations WHERE ticket_channel_id = ?`)
  S.setMiddlemanRequested = db.prepare(`UPDATE negotiations SET middleman_status = 'pending', middleman_requested_by = ?, middleman_requested_at = datetime('now') WHERE ticket_channel_id = ?`)
  S.setMiddlemanActive    = db.prepare(`UPDATE negotiations SET middleman_status = 'active', middleman_id = ?, middleman_accepted_at = datetime('now') WHERE ticket_channel_id = ?`)
  S.setMiddlemanResolution = db.prepare(`UPDATE negotiations SET middleman_status = ?, middleman_resolution = ?, middleman_resolved_at = datetime('now') WHERE ticket_channel_id = ?`)
  S.getExpiredMmRequests  = db.prepare(`SELECT id, ticket_channel_id, buyer_id, seller_id FROM negotiations WHERE middleman_status = 'pending' AND middleman_requested_at < datetime('now', '-' || ? || ' minutes')`)

  // ── Comprovantes ──
  S.addProof              = db.prepare(`INSERT INTO payment_proofs (negotiation_id, user_id, url, filename) VALUES (?, ?, ?, ?)`)
  S.getProofs             = db.prepare(`SELECT * FROM payment_proofs WHERE negotiation_id = ? ORDER BY created_at DESC`)

  // ── Ofertas ──
  S.createOffer           = db.prepare(`INSERT INTO offers (negotiation_id, from_user_id, to_user_id, value, message) VALUES (?, ?, ?, ?, ?)`)
  S.getOffersByNeg        = db.prepare(`SELECT * FROM offers WHERE negotiation_id = ? ORDER BY created_at DESC`)
  S.getLastPendingOffer   = db.prepare(`SELECT * FROM offers WHERE negotiation_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1`)
  S.respondOffer          = db.prepare(`UPDATE offers SET status = ?, responded_at = datetime('now') WHERE id = ?`)
  S.getOfferById          = db.prepare(`SELECT * FROM offers WHERE id = ?`)

  // ── Reservas ──
  S.createReservation     = db.prepare(`INSERT INTO reservations (announcement_id, seller_id, buyer_id, expires_at) VALUES (?, ?, ?, ?)`)
  S.getActiveReservation  = db.prepare(`SELECT * FROM reservations WHERE announcement_id = ? AND status = 'active' AND expires_at > datetime('now')`)
  S.cancelResByAnn        = db.prepare(`UPDATE reservations SET status = 'cancelled', cancelled_at = datetime('now') WHERE announcement_id = ? AND status = 'active'`)
  S.cancelResById         = db.prepare(`UPDATE reservations SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?`)
  S.getExpiredRes         = db.prepare(`SELECT * FROM reservations WHERE status = 'active' AND expires_at <= datetime('now')`)

  // ── Alertas ──
  S.createAlert           = db.prepare(`INSERT INTO alerts (user_id, nick_filter, min_price, max_price, vip_filter) VALUES (?, ?, ?, ?, ?)`)
  S.getUserAlerts         = db.prepare(`SELECT * FROM alerts WHERE user_id = ? AND active = 1 ORDER BY created_at DESC`)
  S.deleteAlert           = db.prepare(`UPDATE alerts SET active = 0 WHERE id = ? AND user_id = ?`)
  S.getAllActiveAlerts     = db.prepare(`SELECT * FROM alerts WHERE active = 1`)
  S.markAlertTriggered    = db.prepare(`UPDATE alerts SET last_triggered_at = datetime('now') WHERE id = ?`)
  S.matchAlerts           = db.prepare(`
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

  // ── Auto bump ──
  S.enableAutoBump        = db.prepare(`
    INSERT INTO auto_bumps (announcement_id, user_id, active, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(announcement_id) DO UPDATE SET active = 1, updated_at = datetime('now')
  `)
  S.disableAutoBump       = db.prepare(`UPDATE auto_bumps SET active = 0, updated_at = datetime('now') WHERE announcement_id = ?`)
  S.getAutoBumpStatus     = db.prepare(`SELECT * FROM auto_bumps WHERE announcement_id = ?`)
  S.getAutoBumpsDue       = db.prepare(`
    SELECT ab.*, a.user_id as ann_user_id FROM auto_bumps ab
    JOIN announcements a ON a.id = ab.announcement_id
    WHERE ab.active = 1
      AND a.status = 'approved'
      AND (ab.last_bumped_at IS NULL OR (julianday('now') - julianday(ab.last_bumped_at)) * 24 >= 24)
  `)
  S.recordAutoBump        = db.prepare(`UPDATE auto_bumps SET last_bumped_at = datetime('now') WHERE announcement_id = ?`)
  S.autoBumpAnn           = db.prepare(`UPDATE announcements SET bumped_at = datetime('now') WHERE id = ?`)

  // ── Blacklist ──
  S.addBlacklist          = db.prepare(`INSERT INTO blacklist (user_id, reason, created_by) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET reason = ?, created_by = ?, created_at = datetime('now')`)
  S.removeBlacklist       = db.prepare(`DELETE FROM blacklist WHERE user_id = ?`)
  S.getBlacklist          = db.prepare(`SELECT * FROM blacklist ORDER BY created_at DESC`)
  S.isBlacklisted         = db.prepare(`SELECT 1 FROM blacklist WHERE user_id = ?`)
  S.getBlacklistEntry     = db.prepare(`SELECT * FROM blacklist WHERE user_id = ?`)

  // ── Avaliações ──
  S.createRating          = db.prepare(`INSERT OR IGNORE INTO ratings (negotiation_id, rater_id, rated_id, stars, comment) VALUES (?, ?, ?, ?, ?)`)
  S.getUserRatings        = db.prepare(`SELECT * FROM ratings WHERE rated_id = ? ORDER BY created_at DESC`)
  S.getUserAvgRating      = db.prepare(`SELECT AVG(stars) as average, COUNT(*) as count FROM ratings WHERE rated_id = ?`)
  S.hasRated              = db.prepare(`SELECT 1 FROM ratings WHERE negotiation_id = ? AND rater_id = ?`)

  // ── Logs ──
  S.addLog                = db.prepare(`INSERT INTO logs (action, user_id, target_id, details) VALUES (?, ?, ?, ?)`)
  S.getLogsByAction       = db.prepare(`SELECT * FROM logs WHERE action = ? ORDER BY created_at DESC`)
  S.purgeOldLogs          = db.prepare(`DELETE FROM logs WHERE created_at < datetime('now', '-' || ? || ' days')`)

  // ── Edit logs ──
  S.addEditLog            = db.prepare(`INSERT INTO edit_logs (announcement_id, user_id, campo, old_value, new_value) VALUES (?, ?, ?, ?, ?)`)
  S.getEditLogs           = db.prepare(`SELECT * FROM edit_logs WHERE announcement_id = ? ORDER BY created_at DESC`)

  // ── Temp modal data ──
  S.cleanTempModal        = db.prepare(`DELETE FROM temp_modal_data WHERE created_at < ?`)
  S.insertTempModal       = db.prepare(`INSERT INTO temp_modal_data (id, data, created_at) VALUES (?, ?, ?)`)
  S.updateTempModal       = db.prepare(`UPDATE temp_modal_data SET data = ?, created_at = ? WHERE id = ?`)
  S.getTempModal          = db.prepare(`SELECT data FROM temp_modal_data WHERE id = ?`)
  S.deleteTempModal       = db.prepare(`DELETE FROM temp_modal_data WHERE id = ?`)

  // ── Notifications ──
  S.getNotification    = db.prepare(`SELECT enabled FROM notifications WHERE user_id = ?`)
  S.upsertNotification = db.prepare(`INSERT INTO notifications (user_id, enabled, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET enabled = ?, updated_at = datetime('now')`)
  S.getAllNotifSubscribers = db.prepare(`SELECT user_id FROM notifications WHERE enabled = 1`)

  // ── Config ──
  S.updateConfig          = db.prepare(`INSERT INTO config_store (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?`)
  S.getConfigAll          = db.prepare(`SELECT key, value FROM config_store`)

  // ── Favoritos ──
  S.addFavorite           = db.prepare(`INSERT OR IGNORE INTO favorites (user_id, announcement_id) VALUES (?, ?)`)
  S.removeFavorite        = db.prepare(`DELETE FROM favorites WHERE user_id = ? AND announcement_id = ?`)
  S.isFavorited           = db.prepare(`SELECT 1 FROM favorites WHERE user_id = ? AND announcement_id = ?`)
  S.getUserFavorites      = db.prepare(`
    SELECT f.*, a.nick, a.valor, a.status, a.user_id as seller_id, a.uuid, a.message_id, a.bumped_at
    FROM favorites f
    JOIN announcements a ON a.id = f.announcement_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `)
  S.getFavoriters         = db.prepare(`SELECT user_id FROM favorites WHERE announcement_id = ?`)
  S.countFavoriters       = db.prepare(`SELECT COUNT(*) as c FROM favorites WHERE announcement_id = ?`)
  S.deleteFavsByAnn       = db.prepare(`DELETE FROM favorites WHERE announcement_id = ?`)

  // ── Cooldowns ──
  S.getCooldown           = db.prepare(`SELECT expires_at FROM cooldowns WHERE key = ?`)
  S.setCooldown           = db.prepare(`INSERT OR REPLACE INTO cooldowns (key, expires_at) VALUES (?, ?)`)
  S.deleteCooldown        = db.prepare(`DELETE FROM cooldowns WHERE key = ?`)
  S.purgeExpiredCooldowns = db.prepare(`DELETE FROM cooldowns WHERE expires_at < ?`)

  // ── Stats ──
  S.ticketStats           = db.prepare(`SELECT status, COUNT(*) as cnt FROM tickets GROUP BY status`)
  S.annGroupStats         = db.prepare(`SELECT status, COUNT(*) as cnt FROM announcements GROUP BY status`)
  S.negGroupStats         = db.prepare(`SELECT status, COUNT(*) as cnt FROM negotiations GROUP BY status`)
  S.countBlacklist        = db.prepare(`SELECT COUNT(*) as c FROM blacklist`)
  S.countActiveAlerts     = db.prepare(`SELECT COUNT(*) as c FROM alerts WHERE active = 1`)
  S.countActiveRes        = db.prepare(`SELECT COUNT(*) as c FROM reservations WHERE status = 'active' AND expires_at > datetime('now')`)
  S.countActiveBumps      = db.prepare(`SELECT COUNT(*) as c FROM auto_bumps WHERE active = 1`)

  // ── Suspeitos ──
  S.rejectedSuspicious    = db.prepare(`SELECT user_id, COUNT(*) as c FROM announcements WHERE status = 'rejected' GROUP BY user_id HAVING c >= 3`)
  S.sharedUUIDs           = db.prepare(`SELECT uuid, GROUP_CONCAT(DISTINCT user_id) as sellers, COUNT(DISTINCT user_id) as cnt FROM announcements WHERE uuid IS NOT NULL GROUP BY uuid HAVING cnt > 1`)
  S.cancelledNegsSuspicious = db.prepare(`
    SELECT user_id, COUNT(*) as c FROM (
      SELECT seller_id as user_id FROM negotiations WHERE status = 'cancelled'
      UNION ALL
      SELECT buyer_id  as user_id FROM negotiations WHERE status = 'cancelled'
    ) GROUP BY user_id HAVING c >= 3
  `)
  S.userRejections        = db.prepare(`SELECT COUNT(*) as c FROM announcements WHERE user_id = ? AND status = 'rejected'`)
  S.userUUIDs             = db.prepare(`SELECT DISTINCT uuid FROM announcements WHERE user_id = ? AND uuid IS NOT NULL`)
  S.userCancelled         = db.prepare(`SELECT COUNT(*) as c FROM negotiations WHERE (seller_id = ? OR buyer_id = ?) AND status = 'cancelled'`)
}
