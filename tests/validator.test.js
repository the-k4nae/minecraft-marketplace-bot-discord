/**
 * tests/validator.test.js
 *
 * Testes dos validadores e rate limiter.
 * Executar: npx vitest run
 *
 * Instalar devDependencies:
 *   npm install -D vitest
 */

import { describe, it, expect, beforeEach } from "vitest"
import {
  validateMoney, validateDiscordId, validateText,
  validateHours, sanitizeString, isValidUrl,
  canBumpAnnouncement,
} from "../utils/validator.js"
import { checkLimit, resetLimit, LIMITS, checkNamedLimit } from "../utils/rateLimiter.js"

// ─── validateMoney ────────────────────────────────────────────────────────────

describe("validateMoney", () => {
  it("aceita inteiro simples", () => {
    const r = validateMoney("300")
    expect(r.valid).toBe(true)
    expect(r.value).toBe("300.00")
  })

  it("aceita decimal com ponto", () => {
    const r = validateMoney("150.50")
    expect(r.valid).toBe(true)
    expect(r.value).toBe("150.50")
  })

  it("aceita formato BR com vírgula", () => {
    const r = validateMoney("1.500,00")
    expect(r.valid).toBe(true)
    expect(r.value).toBe("1500.00")
  })

  it("aceita valor sem centavos com vírgula", () => {
    const r = validateMoney("200,00")
    expect(r.valid).toBe(true)
    expect(r.value).toBe("200.00")
  })

  it("rejeita valor negativo", () => {
    const r = validateMoney("-50")
    expect(r.valid).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it("rejeita zero", () => {
    const r = validateMoney("0")
    expect(r.valid).toBe(false)
  })

  it("rejeita texto não numérico", () => {
    const r = validateMoney("abc")
    expect(r.valid).toBe(false)
  })

  it("rejeita valor acima do limite", () => {
    const r = validateMoney("9999999")
    expect(r.valid).toBe(false)
  })

  it("aceita campo vazio quando não obrigatório", () => {
    const r = validateMoney("")
    expect(r.valid).toBe(true)
    expect(r.value).toBeNull()
  })

  it("preserva casas decimais relevantes", () => {
    const r = validateMoney("99.9")
    expect(r.valid).toBe(true)
    expect(parseFloat(r.value)).toBeCloseTo(99.9)
  })
})

// ─── validateDiscordId ────────────────────────────────────────────────────────

describe("validateDiscordId", () => {
  it("aceita ID de 18 dígitos", () => {
    const r = validateDiscordId("123456789012345678")
    expect(r.valid).toBe(true)
    expect(r.normalizedId).toBe("123456789012345678")
  })

  it("aceita ID com menção @", () => {
    const r = validateDiscordId("<@123456789012345678>")
    expect(r.valid).toBe(true)
    expect(r.normalizedId).toBe("123456789012345678")
  })

  it("rejeita ID muito curto", () => {
    const r = validateDiscordId("123")
    expect(r.valid).toBe(false)
  })

  it("rejeita ID muito longo", () => {
    const r = validateDiscordId("1".repeat(25))
    expect(r.valid).toBe(false)
  })

  it("rejeita vazio", () => {
    const r = validateDiscordId("")
    expect(r.valid).toBe(false)
  })

  it("rejeita undefined/null", () => {
    expect(validateDiscordId(null).valid).toBe(false)
    expect(validateDiscordId(undefined).valid).toBe(false)
  })
})

// ─── validateText ─────────────────────────────────────────────────────────────

describe("validateText", () => {
  it("aceita texto normal", () => {
    const r = validateText("Olá Mundo", 100, false)
    expect(r.valid).toBe(true)
    expect(r.value).toBe("Olá Mundo")
  })

  it("rejeita texto acima do maxLength", () => {
    const r = validateText("a".repeat(101), 100, false)
    expect(r.valid).toBe(false)
  })

  it("rejeita vazio quando required=true", () => {
    const r = validateText("", 100, true)
    expect(r.valid).toBe(false)
  })

  it("aceita vazio quando required=false", () => {
    const r = validateText("", 100, false)
    expect(r.valid).toBe(true)
    expect(r.value).toBeNull()
  })

  it("faz trim do valor", () => {
    const r = validateText("  olá  ", 100, false)
    expect(r.value).toBe("olá")
  })
})

// ─── validateHours ────────────────────────────────────────────────────────────

describe("validateHours", () => {
  it("aceita valor dentro do range", () => {
    const r = validateHours(12, 1, 72)
    expect(r.valid).toBe(true)
    expect(r.value).toBe(12)
  })

  it("rejeita abaixo do mínimo", () => {
    const r = validateHours(0, 1, 72)
    expect(r.valid).toBe(false)
  })

  it("rejeita acima do máximo", () => {
    const r = validateHours(100, 1, 72)
    expect(r.valid).toBe(false)
  })

  it("rejeita texto", () => {
    const r = validateHours("abc", 1, 72)
    expect(r.valid).toBe(false)
  })

  it("aceita valor limite inferior", () => {
    expect(validateHours(1, 1, 72).valid).toBe(true)
  })

  it("aceita valor limite superior", () => {
    expect(validateHours(72, 1, 72).valid).toBe(true)
  })
})

// ─── sanitizeString ───────────────────────────────────────────────────────────

describe("sanitizeString", () => {
  it("remove caracteres perigosos", () => {
    const r = sanitizeString("<script>alert(1)</script>")
    expect(r).not.toContain("<")
    expect(r).not.toContain(">")
  })

  it("remove aspas e backslash", () => {
    const r = sanitizeString("O'Brien; DROP TABLE--")
    expect(r).not.toContain("'")
    expect(r).not.toContain(";")
  })

  it("mantém texto normal", () => {
    const r = sanitizeString("Nick123 com acento: ção")
    expect(r).toContain("Nick123")
    expect(r).toContain("ção")
  })

  it("retorna string vazia para null/undefined", () => {
    expect(sanitizeString(null)).toBe("")
    expect(sanitizeString(undefined)).toBe("")
  })

  it("faz trim", () => {
    expect(sanitizeString("  olá  ")).toBe("olá")
  })
})

// ─── isValidUrl ───────────────────────────────────────────────────────────────

describe("isValidUrl", () => {
  it("aceita URL https válida", () => {
    expect(isValidUrl("https://example.com/img.png")).toBe(true)
  })

  it("aceita URL Discord CDN", () => {
    expect(isValidUrl("https://cdn.discordapp.com/attachments/123/456/file.png")).toBe(true)
  })

  it("rejeita string sem protocolo", () => {
    expect(isValidUrl("example.com")).toBe(false)
  })

  it("rejeita string vazia", () => {
    expect(isValidUrl("")).toBe(false)
  })
})

// ─── canBumpAnnouncement ──────────────────────────────────────────────────────

describe("canBumpAnnouncement", () => {
  it("permite bump após 24h", () => {
    const bumped_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
    const r = canBumpAnnouncement({ bumped_at })
    expect(r.canBump).toBe(true)
    expect(r.remainingHours).toBe(0)
  })

  it("bloqueia bump antes de 24h", () => {
    const bumped_at = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
    const r = canBumpAnnouncement({ bumped_at })
    expect(r.canBump).toBe(false)
    expect(r.remainingHours).toBeGreaterThan(0)
  })

  it("usa created_at quando bumped_at é null", () => {
    const created_at = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    const r = canBumpAnnouncement({ bumped_at: null, created_at })
    expect(r.canBump).toBe(true)
  })
})

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

describe("checkLimit (sliding window)", () => {
  const USER = "test_user_rl"

  beforeEach(() => {
    // Limpa estado entre testes
    resetLimit(USER, "test_action")
  })

  it("permite ação dentro do limite", () => {
    const r = checkLimit(USER, "test_action", 3, 60_000)
    expect(r.allowed).toBe(true)
    expect(r.count).toBe(1)
    expect(r.remaining).toBe(2)
  })

  it("bloqueia após atingir o limite", () => {
    checkLimit(USER, "test_action", 3, 60_000)
    checkLimit(USER, "test_action", 3, 60_000)
    checkLimit(USER, "test_action", 3, 60_000)
    const r = checkLimit(USER, "test_action", 3, 60_000)
    expect(r.allowed).toBe(false)
    expect(r.remaining).toBe(0)
    expect(r.resetIn).toBeGreaterThan(0)
  })

  it("conta corretamente ações acumuladas", () => {
    checkLimit(USER, "test_action", 5, 60_000)
    checkLimit(USER, "test_action", 5, 60_000)
    const r = checkLimit(USER, "test_action", 5, 60_000)
    expect(r.count).toBe(3)
    expect(r.remaining).toBe(2)
  })

  it("resetLimit zera o contador", () => {
    checkLimit(USER, "test_action", 2, 60_000)
    checkLimit(USER, "test_action", 2, 60_000)
    resetLimit(USER, "test_action")
    const r = checkLimit(USER, "test_action", 2, 60_000)
    expect(r.allowed).toBe(true)
    expect(r.count).toBe(1)
  })

  it("limites nomeados funcionam", () => {
    const r = checkNamedLimit(USER, "OPEN_TICKET")
    expect(r.allowed).toBe(true)
  })

  it("limites nomeados desconhecidos lançam erro", () => {
    expect(() => checkNamedLimit(USER, "NAO_EXISTE")).toThrow()
  })

  it("usuários diferentes não interferem", () => {
    const userA = "user_a_rl"
    const userB = "user_b_rl"
    checkLimit(userA, "x", 1, 60_000)
    checkLimit(userA, "x", 1, 60_000) // bloqueia A
    const r = checkLimit(userB, "x", 1, 60_000)
    expect(r.allowed).toBe(true) // B não é afetado
    resetLimit(userA, "x")
    resetLimit(userB, "x")
  })
})
