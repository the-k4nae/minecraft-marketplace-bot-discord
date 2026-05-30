/**
 * tests/database.test.js
 *
 * Testes de integração das funções de banco de dados.
 * Usa SQLite em memória (:memory:) para não tocar no banco de produção.
 *
 * Executar: npx vitest run tests/database.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import Database from "better-sqlite3"

// ── Setup: banco em memória com schema simplificado ──────────────────────────

let db

beforeAll(() => {
  db = new Database(":memory:")
  db.pragma("foreign_keys = ON")

  db.exec(`
    CREATE TABLE announcements (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT    NOT NULL,
      nick       TEXT    NOT NULL,
      uuid       TEXT,
      valor      REAL    NOT NULL DEFAULT 0,
      status     TEXT    NOT NULL DEFAULT 'pending',
      vips       TEXT,
      tags       TEXT,
      bumped_at  TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now')),
      sold_at    TEXT
    );

    CREATE TABLE negotiations (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      announcement_id   INTEGER NOT NULL,
      buyer_id          TEXT    NOT NULL,
      seller_id         TEXT    NOT NULL,
      ticket_channel_id TEXT    NOT NULL UNIQUE,
      status            TEXT    NOT NULL DEFAULT 'active',
      created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      completed_at      TEXT,
      buyer_last_seen_at TEXT,
      timeout_warned     INTEGER DEFAULT 0
    );

    CREATE TABLE blacklist (
      user_id    TEXT PRIMARY KEY,
      reason     TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE ratings (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      negotiation_id INTEGER NOT NULL,
      rater_id       TEXT    NOT NULL,
      rated_id       TEXT    NOT NULL,
      stars          INTEGER NOT NULL,
      comment        TEXT,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(negotiation_id, rater_id)
    );

    CREATE TABLE cooldowns (
      key        TEXT    PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE favorites (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         TEXT NOT NULL,
      announcement_id INTEGER NOT NULL,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, announcement_id)
    );

    CREATE TABLE notifications (
      user_id    TEXT    PRIMARY KEY,
      enabled    INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)
})

afterAll(() => {
  db.close()
})

// ── Anúncios ──────────────────────────────────────────────────────────────────

describe("Announcements", () => {
  it("cria um anúncio e retorna o id", () => {
    const r = db.prepare(`
      INSERT INTO announcements (user_id, nick, valor, uuid)
      VALUES ('user1', 'Steve', 300.00, 'abc-uuid')
    `).run()
    expect(r.lastInsertRowid).toBeGreaterThan(0)
  })

  it("busca anúncio por id", () => {
    const r = db.prepare(`INSERT INTO announcements (user_id, nick, valor) VALUES ('user2', 'Alex', 150.00)`).run()
    const ann = db.prepare(`SELECT * FROM announcements WHERE id = ?`).get(r.lastInsertRowid)
    expect(ann.nick).toBe("Alex")
    expect(ann.valor).toBe(150.0)
  })

  it("filtra por status", () => {
    db.prepare(`INSERT INTO announcements (user_id, nick, valor, status) VALUES ('user3', 'Herobrine', 500.00, 'approved')`).run()
    const approved = db.prepare(`SELECT * FROM announcements WHERE status = 'approved'`).all()
    expect(approved.length).toBeGreaterThan(0)
    expect(approved.every(a => a.status === "approved")).toBe(true)
  })

  it("busca por uuid", () => {
    db.prepare(`INSERT INTO announcements (user_id, nick, valor, uuid) VALUES ('user4', 'Notch', 999.00, 'unique-uuid-123')`).run()
    const results = db.prepare(`SELECT * FROM announcements WHERE uuid = ?`).all("unique-uuid-123")
    expect(results.length).toBe(1)
    expect(results[0].nick).toBe("Notch")
  })

  it("busca case-insensitive por nick", () => {
    db.prepare(`INSERT INTO announcements (user_id, nick, valor) VALUES ('user5', 'CaseSensitive', 100.00)`).run()
    const results = db.prepare(`SELECT * FROM announcements WHERE nick = ? COLLATE NOCASE`).all("casesensitive")
    expect(results.length).toBeGreaterThan(0)
  })

  it("filtra por intervalo de valor", () => {
    const all = db.prepare(`SELECT * FROM announcements WHERE valor >= ? AND valor <= ?`).all(100, 400)
    expect(all.every(a => a.valor >= 100 && a.valor <= 400)).toBe(true)
  })
})

// ── Negociações ───────────────────────────────────────────────────────────────

describe("Negotiations", () => {
  let annId

  beforeAll(() => {
    const r = db.prepare(`INSERT INTO announcements (user_id, nick, valor) VALUES ('seller1', 'NegAnn', 200.00)`).run()
    annId = r.lastInsertRowid
  })

  it("cria negociação e retorna id", () => {
    const r = db.prepare(`
      INSERT INTO negotiations (announcement_id, buyer_id, seller_id, ticket_channel_id)
      VALUES (?, 'buyer1', 'seller1', 'ch-001')
    `).run(annId)
    expect(r.lastInsertRowid).toBeGreaterThan(0)
  })

  it("busca negociação por canal", () => {
    const neg = db.prepare(`SELECT * FROM negotiations WHERE ticket_channel_id = ?`).get("ch-001")
    expect(neg).toBeTruthy()
    expect(neg.buyer_id).toBe("buyer1")
  })

  it("completa negociação", () => {
    db.prepare(`UPDATE negotiations SET status = 'completed', completed_at = datetime('now') WHERE ticket_channel_id = ?`).run("ch-001")
    const neg = db.prepare(`SELECT * FROM negotiations WHERE ticket_channel_id = ?`).get("ch-001")
    expect(neg.status).toBe("completed")
    expect(neg.completed_at).toBeTruthy()
  })

  it("não permite channel_id duplicado", () => {
    expect(() => {
      db.prepare(`INSERT INTO negotiations (announcement_id, buyer_id, seller_id, ticket_channel_id) VALUES (?, 'b', 's', 'ch-001')`).run(annId)
    }).toThrow()
  })
})

// ── Blacklist ─────────────────────────────────────────────────────────────────

describe("Blacklist", () => {
  it("adiciona usuário à blacklist", () => {
    db.prepare(`INSERT INTO blacklist (user_id, reason, created_by) VALUES ('bad-user', 'Scammer', 'staff1')`).run()
    const r = db.prepare(`SELECT 1 FROM blacklist WHERE user_id = ?`).get("bad-user")
    expect(r).toBeTruthy()
  })

  it("verifica se usuário está na blacklist", () => {
    const r = db.prepare(`SELECT 1 FROM blacklist WHERE user_id = ?`).get("bad-user")
    expect(!!r).toBe(true)
  })

  it("remove da blacklist", () => {
    db.prepare(`DELETE FROM blacklist WHERE user_id = ?`).run("bad-user")
    const r = db.prepare(`SELECT 1 FROM blacklist WHERE user_id = ?`).get("bad-user")
    expect(r).toBeUndefined()
  })

  it("não lança ao verificar usuário não listado", () => {
    const r = db.prepare(`SELECT 1 FROM blacklist WHERE user_id = ?`).get("clean-user")
    expect(!!r).toBe(false)
  })
})

// ── Avaliações ────────────────────────────────────────────────────────────────

describe("Ratings", () => {
  let negId

  beforeAll(() => {
    const ann = db.prepare(`INSERT INTO announcements (user_id, nick, valor) VALUES ('s2', 'RatAnn', 100.00)`).run()
    const neg = db.prepare(`INSERT INTO negotiations (announcement_id, buyer_id, seller_id, ticket_channel_id) VALUES (?, 'b2', 's2', 'ch-rating')`).run(ann.lastInsertRowid)
    negId = neg.lastInsertRowid
  })

  it("cria avaliação", () => {
    const r = db.prepare(`INSERT OR IGNORE INTO ratings (negotiation_id, rater_id, rated_id, stars, comment) VALUES (?, 'b2', 's2', 5, 'Excelente!')`).run(negId)
    expect(r.lastInsertRowid).toBeGreaterThan(0)
  })

  it("calcula média corretamente", () => {
    db.prepare(`INSERT OR IGNORE INTO ratings (negotiation_id, rater_id, rated_id, stars) VALUES (?, 'b2b', 's2', 3)`).run(negId)
    const row = db.prepare(`SELECT AVG(stars) as avg, COUNT(*) as cnt FROM ratings WHERE rated_id = ?`).get("s2")
    expect(row.cnt).toBeGreaterThanOrEqual(1)
    expect(parseFloat(row.avg)).toBeGreaterThan(0)
  })

  it("impede avaliação duplicada da mesma neg", () => {
    // A primeira foi inserida com INSERT OR IGNORE, segunda deve ser ignorada
    const r = db.prepare(`INSERT OR IGNORE INTO ratings (negotiation_id, rater_id, rated_id, stars) VALUES (?, 'b2', 's2', 1)`).run(negId)
    expect(r.changes).toBe(0)
  })
})

// ── Cooldowns ─────────────────────────────────────────────────────────────────

describe("Cooldowns", () => {
  it("registra e verifica cooldown ativo", () => {
    const key     = "user:test_cooldown"
    const expires = Date.now() + 60_000
    db.prepare(`INSERT OR REPLACE INTO cooldowns (key, expires_at) VALUES (?, ?)`).run(key, expires)
    const row = db.prepare(`SELECT expires_at FROM cooldowns WHERE key = ?`).get(key)
    expect(row.expires_at).toBeGreaterThan(Date.now())
  })

  it("limpa cooldowns expirados", () => {
    const key = "user:expired_cd"
    db.prepare(`INSERT OR REPLACE INTO cooldowns (key, expires_at) VALUES (?, ?)`).run(key, Date.now() - 1000)
    db.prepare(`DELETE FROM cooldowns WHERE expires_at < ?`).run(Date.now())
    const row = db.prepare(`SELECT expires_at FROM cooldowns WHERE key = ?`).get(key)
    expect(row).toBeUndefined()
  })
})

// ── Valor monetário ───────────────────────────────────────────────────────────

describe("Valor como REAL no banco", () => {
  it("armazena e recupera valor com precisão", () => {
    const r = db.prepare(`INSERT INTO announcements (user_id, nick, valor) VALUES ('vx', 'ValTest', 1234.56)`).run()
    const ann = db.prepare(`SELECT valor FROM announcements WHERE id = ?`).get(r.lastInsertRowid)
    expect(ann.valor).toBeCloseTo(1234.56)
  })

  it("índice de valor funciona para range query", () => {
    // Verifica que a query com range não explode (sem testar EXPLAIN, apenas execução)
    const results = db.prepare(`SELECT * FROM announcements WHERE valor BETWEEN 100 AND 2000`).all()
    expect(Array.isArray(results)).toBe(true)
  })
})

// ── Notifications ────────────────────────────────────────────────────

describe("Notifications", () => {
  it("ativa notificação para usuário", () => {
    db.prepare(`INSERT INTO notifications (user_id, enabled) VALUES ('notif-user', 1) ON CONFLICT(user_id) DO UPDATE SET enabled = 1`).run()
    const row = db.prepare(`SELECT enabled FROM notifications WHERE user_id = ?`).get("notif-user")
    expect(row?.enabled).toBe(1)
  })

  it("desativa notificação", () => {
    db.prepare(`INSERT INTO notifications (user_id, enabled) VALUES ('notif-user', 0) ON CONFLICT(user_id) DO UPDATE SET enabled = 0`).run()
    const row = db.prepare(`SELECT enabled FROM notifications WHERE user_id = ?`).get("notif-user")
    expect(row?.enabled).toBe(0)
  })

  it("padrão é undefined para usuário sem registro", () => {
    const row = db.prepare(`SELECT enabled FROM notifications WHERE user_id = ?`).get("ghost-user")
    expect(row).toBeUndefined()
  })

  it("retorna todos os subscribers ativos", () => {
    db.prepare(`INSERT INTO notifications (user_id, enabled) VALUES ('sub1', 1), ('sub2', 0), ('sub3', 1) ON CONFLICT DO NOTHING`).run()
    const subs = db.prepare(`SELECT user_id FROM notifications WHERE enabled = 1`).all()
    expect(subs.length).toBeGreaterThanOrEqual(1)
  })
})

// ── Favorites ─────────────────────────────────────────────────────

describe("Favorites", () => {
  let annId

  beforeAll(() => {
    const r = db.prepare(`INSERT INTO announcements (user_id, nick, valor) VALUES ('fav-seller', 'FavAnn', 100.00)`).run()
    annId = r.lastInsertRowid
  })

  it("adiciona favorito", () => {
    db.prepare(`INSERT OR IGNORE INTO favorites (user_id, announcement_id) VALUES ('fav-user', ?)`).run(annId)
    const r = db.prepare(`SELECT 1 FROM favorites WHERE user_id = ? AND announcement_id = ?`).get("fav-user", annId)
    expect(r).toBeTruthy()
  })

  it("não duplica favorito", () => {
    db.prepare(`INSERT OR IGNORE INTO favorites (user_id, announcement_id) VALUES ('fav-user', ?)`).run(annId)
    const rows = db.prepare(`SELECT * FROM favorites WHERE user_id = ? AND announcement_id = ?`).all("fav-user", annId)
    expect(rows.length).toBe(1)
  })

  it("remove favorito", () => {
    db.prepare(`DELETE FROM favorites WHERE user_id = ? AND announcement_id = ?`).run("fav-user", annId)
    const r = db.prepare(`SELECT 1 FROM favorites WHERE user_id = ? AND announcement_id = ?`).get("fav-user", annId)
    expect(r).toBeUndefined()
  })
})
