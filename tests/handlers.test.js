/**
 * tests/handlers.test.js
 *
 * Testes de lógica pura dos handlers (sem Discord.js, sem banco real).
 *
 * Áreas cobertas:
 *   1. parseMoney              — parsing de valores monetários (EN e BR)
 *   2. formatValor             — formatação de saída pt-BR
 *   3. validateMoney           — validação de entrada de usuário
 *   4. canEditAnnouncement     — regras de negócio de edição
 *   5. canDeleteAnnouncement   — regras de negócio de exclusão
 *   6. canBumpAnnouncement     — cooldown de bump (24h)
 *   7. sanitizeString          — limpeza de inputs
 *   8. Lógica de diff          — simulação do handleEditSubmit
 *   9. edit_logs schema        — tabela de histórico em memória
 *  10. CHECK CONSTRAINT        — status inválido é rejeitado pelo DB
 *
 * Executar: npx vitest run tests/handlers.test.js
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import Database from "better-sqlite3"
import { parseMoney, formatValor } from "../utils/components.js"
import {
  validateMoney, canEditAnnouncement, canDeleteAnnouncement,
  canBumpAnnouncement, sanitizeString, validateText, validateDiscordId,
} from "../utils/validator.js"

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. parseMoney
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("parseMoney", () => {
  it("string vazia → null", () => expect(parseMoney("")).toBeNull())
  it("null → null",         () => expect(parseMoney(null)).toBeNull())
  it("zero → null",         () => expect(parseMoney("0")).toBeNull())
  it("negativo → null",     () => expect(parseMoney("-100")).toBeNull())

  it('"150"       → 150',    () => expect(parseMoney("150")).toBe(150))
  it('"1500.50"   → 1500.5', () => expect(parseMoney("1500.50")).toBeCloseTo(1500.5))
  it('"1.500,00"  → 1500',   () => expect(parseMoney("1.500,00")).toBeCloseTo(1500))
  it('"200,50"    → 200.5',  () => expect(parseMoney("200,50")).toBeCloseTo(200.5))
  it('"1.500"     → 1.5 (sem vírgula → decimal EN)', () => expect(parseMoney("1.500")).toBeCloseTo(1.5))
  it('espaços são ignorados', () => expect(parseMoney("  300  ")).toBe(300))
  it("número direto (500)  → 500", () => expect(parseMoney(500)).toBe(500))
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. formatValor
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("formatValor", () => {
  it("1500.5   → '1.500,50'",   () => expect(formatValor(1500.5)).toBe("1.500,50"))
  it("300      → '300,00'",     () => expect(formatValor(300)).toBe("300,00"))
  it("0        → '0,00'",       () => expect(formatValor(0)).toBe("0,00"))
  it("999999   → '999.999,00'", () => expect(formatValor(999999)).toBe("999.999,00"))
  it("0.5      → '0,50'",       () => expect(formatValor(0.5)).toBe("0,50"))
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. validateMoney
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("validateMoney", () => {
  it("vazio → válido (campo opcional)", () => expect(validateMoney("").valid).toBe(true))

  it('"300"      → válido', () => {
    const r = validateMoney("300")
    expect(r.valid).toBe(true)
    expect(parseFloat(r.value)).toBe(300)
  })

  it('"1.500,00" → válido', () => {
    const r = validateMoney("1.500,00")
    expect(r.valid).toBe(true)
    expect(parseFloat(r.value)).toBeCloseTo(1500)
  })

  it('"999999"   → válido (limite máximo)', () => expect(validateMoney("999999").valid).toBe(true))

  it('"1.2.3"    → inválido (duplo ponto)',   () => expect(validateMoney("1.2.3").valid).toBe(false))
  it('"1,2,3"    → inválido (dupla vírgula)', () => expect(validateMoney("1,2,3").valid).toBe(false))
  it('"0"        → inválido (zero)',           () => expect(validateMoney("0").valid).toBe(false))
  it('"-100"     → inválido (negativo)',       () => expect(validateMoney("-100").valid).toBe(false))
  it('"1000000"  → inválido (> 999999)',       () => expect(validateMoney("1000000").valid).toBe(false))
  it('"abc"      → inválido',                  () => expect(validateMoney("abc").valid).toBe(false))
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. canEditAnnouncement
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("canEditAnnouncement", () => {
  it("null     → não pode editar",   () => expect(canEditAnnouncement(null).canEdit).toBe(false))
  it("pending  → pode editar",       () => expect(canEditAnnouncement({ status: "pending" }).canEdit).toBe(true))
  it("approved → pode editar",       () => expect(canEditAnnouncement({ status: "approved" }).canEdit).toBe(true))
  it("sold     → não pode editar",   () => expect(canEditAnnouncement({ status: "sold" }).canEdit).toBe(false))
  it("expired  → não pode editar",   () => expect(canEditAnnouncement({ status: "expired" }).canEdit).toBe(false))
  it("rejected → não pode editar",   () => expect(canEditAnnouncement({ status: "rejected" }).canEdit).toBe(false))
  it("sold     → reason preenchido", () => expect(canEditAnnouncement({ status: "sold" }).reason).toBeTruthy())
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 5. canDeleteAnnouncement
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("canDeleteAnnouncement", () => {
  it("null     → não pode deletar", () => expect(canDeleteAnnouncement(null).canDelete).toBe(false))
  it("sold     → não pode deletar", () => expect(canDeleteAnnouncement({ status: "sold" }).canDelete).toBe(false))
  it("pending  → pode deletar",     () => expect(canDeleteAnnouncement({ status: "pending" }).canDelete).toBe(true))
  it("approved → pode deletar",     () => expect(canDeleteAnnouncement({ status: "approved" }).canDelete).toBe(true))
  it("expired  → pode deletar",     () => expect(canDeleteAnnouncement({ status: "expired" }).canDelete).toBe(true))
  it("rejected → pode deletar",     () => expect(canDeleteAnnouncement({ status: "rejected" }).canDelete).toBe(true))
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 6. canBumpAnnouncement
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("canBumpAnnouncement", () => {
  it("bumped agora → não pode (remaining > 0)", () => {
    const r = canBumpAnnouncement({ bumped_at: new Date().toISOString() })
    expect(r.canBump).toBe(false)
    expect(r.remainingHours).toBeGreaterThan(0)
  })

  it("bumped 25h atrás → pode", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    expect(canBumpAnnouncement({ bumped_at: old }).canBump).toBe(true)
  })

  it("bumped 23h atrás → não pode", () => {
    const recent = new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString()
    expect(canBumpAnnouncement({ bumped_at: recent }).canBump).toBe(false)
  })

  it("bumped_at null cai em created_at", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    expect(canBumpAnnouncement({ bumped_at: null, created_at: old }).canBump).toBe(true)
  })

  it("remainingHours = 0 quando canBump = true", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    expect(canBumpAnnouncement({ bumped_at: old }).remainingHours).toBe(0)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 7. sanitizeString
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("sanitizeString", () => {
  it("null → string vazia",           () => expect(sanitizeString(null)).toBe(""))
  it("string vazia → string vazia",   () => expect(sanitizeString("")).toBe(""))
  it("remove aspas simples",          () => expect(sanitizeString("O'Brian")).not.toContain("'"))
  it("remove aspas duplas",           () => expect(sanitizeString('say "hi"')).not.toContain('"'))
  it("remove ponto e vírgula",        () => expect(sanitizeString("a;b")).not.toContain(";"))
  it("remove backslash",              () => expect(sanitizeString("a\\b")).not.toContain("\\"))
  it("remove < e >",                  () => {
    const r = sanitizeString("<script>")
    expect(r).not.toContain("<")
    expect(r).not.toContain(">")
  })
  it("string normal preservada",      () => expect(sanitizeString("Hypixel VIP+")).toBe("Hypixel VIP+"))
  it("faz trim",                      () => expect(sanitizeString("  nick  ")).toBe("nick"))
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 8. Lógica de diff — simulação do handleEditSubmit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe("Diff de campos (lógica de handleEditSubmit)", () => {
  /** Extrai apenas os campos alterados — espelha a lógica do handler */
  function computeDiff(oldAnn, newFields) {
    const changes = {}
    for (const [field, newValue] of Object.entries(newFields)) {
      const oldValue = oldAnn[field] ?? null
      if (newValue !== oldValue) changes[field] = newValue
    }
    return changes
  }

  it("campo igual → sem diff",                  () => expect(Object.keys(computeDiff({ vips: "VIP+" }, { vips: "VIP+" }))).toHaveLength(0))
  it("campo alterado → diff gerado",             () => expect(computeDiff({ vips: "VIP+" }, { vips: "MVP++" }).vips).toBe("MVP++"))
  it("campo novo (era null) → diff gerado",      () => expect(computeDiff({ tags: null }, { tags: "[LEGEND]" }).tags).toBe("[LEGEND]"))
  it("campo removido (para null) → diff gerado", () => expect(computeDiff({ tags: "[VIP]" }, { tags: null }).tags).toBeNull())

  it("múltiplos campos → só os alterados retornados", () => {
    const diff = computeDiff(
      { vips: "VIP+", capas: "Nenhuma", valor: 300 },
      { vips: "MVP++", capas: "Nenhuma", valor: 300 }
    )
    expect(Object.keys(diff)).toEqual(["vips"])
  })

  it("todos os campos alterados → todos no diff", () => {
    const diff = computeDiff(
      { vips: "VIP+", capas: "Nenhuma" },
      { vips: "MVP++", capas: "Minecon 2016" }
    )
    expect(Object.keys(diff)).toHaveLength(2)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 9 & 10. edit_logs + CHECK CONSTRAINT (banco em memória)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

let db

beforeAll(() => {
  db = new Database(":memory:")
  db.exec(`
    CREATE TABLE announcements (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT    NOT NULL,
      nick    TEXT    NOT NULL,
      valor   REAL    NOT NULL DEFAULT 0,
      status  TEXT    NOT NULL DEFAULT 'pending'
              CHECK(status IN ('pending','approved','rejected','sold','expired'))
    );

    CREATE TABLE edit_logs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      announcement_id INTEGER NOT NULL,
      user_id         TEXT    NOT NULL,
      campo           TEXT    NOT NULL,
      old_value       TEXT,
      new_value       TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );
  `)
})

afterAll(() => db.close())

describe("edit_logs — persistência de histórico", () => {
  it("insere e recupera um log de edição", () => {
    const ann = db.prepare(`INSERT INTO announcements (user_id, nick, valor) VALUES ('u1', 'Steve', 300)`).run()
    db.prepare(`INSERT INTO edit_logs (announcement_id, user_id, campo, old_value, new_value) VALUES (?, ?, ?, ?, ?)`)
      .run(ann.lastInsertRowid, "u1", "vips", "VIP+", "MVP++")

    const logs = db.prepare(`SELECT * FROM edit_logs WHERE announcement_id = ?`).all(ann.lastInsertRowid)
    expect(logs).toHaveLength(1)
    expect(logs[0].campo).toBe("vips")
    expect(logs[0].old_value).toBe("VIP+")
    expect(logs[0].new_value).toBe("MVP++")
  })

  it("múltiplas edições — todas registradas", () => {
    const ann = db.prepare(`INSERT INTO announcements (user_id, nick, valor) VALUES ('u2', 'Alex', 500)`).run()
    const ins = db.prepare(`INSERT INTO edit_logs (announcement_id, user_id, campo, old_value, new_value) VALUES (?, ?, ?, ?, ?)`)
    ins.run(ann.lastInsertRowid, "u2", "valor",  "500",     "450")
    ins.run(ann.lastInsertRowid, "u2", "capas",  "Nenhuma", "Minecon 2016")

    const logs = db.prepare(`SELECT * FROM edit_logs WHERE announcement_id = ?`).all(ann.lastInsertRowid)
    expect(logs).toHaveLength(2)
    expect(logs.map(l => l.campo)).toContain("valor")
    expect(logs.map(l => l.campo)).toContain("capas")
  })

  it("anúncio sem edições → lista vazia", () => {
    const ann = db.prepare(`INSERT INTO announcements (user_id, nick, valor) VALUES ('u3', 'Notch', 200)`).run()
    const logs = db.prepare(`SELECT * FROM edit_logs WHERE announcement_id = ?`).all(ann.lastInsertRowid)
    expect(logs).toHaveLength(0)
  })
})

describe("CHECK CONSTRAINT em announcements.status (migration v10)", () => {
  it.each(["pending", "approved", "rejected", "sold", "expired"])("status '%s' → aceito", (status) => {
    expect(() => {
      db.prepare(`INSERT INTO announcements (user_id, nick, valor, status) VALUES ('u', 'n', 100, '${status}')`).run()
    }).not.toThrow()
  })

  it("status 'hacked' via INSERT → lança erro", () => {
    expect(() => {
      db.prepare(`INSERT INTO announcements (user_id, nick, valor, status) VALUES ('u', 'n', 100, 'hacked')`).run()
    }).toThrow()
  })

  it("status inválido via UPDATE → lança erro", () => {
    const r = db.prepare(`INSERT INTO announcements (user_id, nick, valor) VALUES ('u', 'n', 100)`).run()
    expect(() => {
      db.prepare(`UPDATE announcements SET status = 'invalid' WHERE id = ?`).run(r.lastInsertRowid)
    }).toThrow()
  })

  it("UPDATE para status válido → aceito", () => {
    const r = db.prepare(`INSERT INTO announcements (user_id, nick, valor) VALUES ('u', 'n', 100)`).run()
    expect(() => {
      db.prepare(`UPDATE announcements SET status = 'approved' WHERE id = ?`).run(r.lastInsertRowid)
    }).not.toThrow()
  })
})
