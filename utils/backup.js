/**
 * backup.js — v2
 *
 * FIX #1: Migrado de bot-data.json para bot-data.sqlite.
 * Usa a API nativa de backup do better-sqlite3 (.backup())
 * que é transacionalmente segura — nunca copia um arquivo corrompido.
 */

import Database from "better-sqlite3"
import { mkdirSync, readdirSync, statSync, unlinkSync, existsSync, copyFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const DB_PATH    = join(__dirname, "..", "bot-data.sqlite")
const BACKUP_DIR = join(__dirname, "..", "backups")
const MAX_BACKUPS = 10

/**
 * Cria backup assíncrono usando a API nativa do better-sqlite3 (transacionalmente seguro).
 */
export function createBackup() {
  try {
    if (!existsSync(DB_PATH)) {
      console.log("[BACKUP] Arquivo .sqlite não encontrado:", DB_PATH)
      return null
    }

    mkdirSync(BACKUP_DIR, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = join(BACKUP_DIR, `bot-data-${timestamp}.sqlite`)

    // Abre em readonly para não interferir com a DB principal
    const source = new Database(DB_PATH, { readonly: true })
    source.backup(backupPath)
      .then(() => {
        console.log(`[BACKUP] ✅ Backup criado: ${backupPath}`)
        cleanOldBackups()
        source.close()
      })
      .catch((err) => {
        console.error("[BACKUP] Erro no backup:", err.message)
        source.close()
      })

    return backupPath
  } catch (error) {
    console.error("[BACKUP] Erro ao iniciar backup:", error.message)
    return null
  }
}

/**
 * Backup síncrono — usado em gracefulShutdown e uncaughtException.
 * Usa copyFileSync (menos seguro mas garante execução síncrona antes do exit).
 */
export function createBackupSync() {
  try {
    if (!existsSync(DB_PATH)) return null

    mkdirSync(BACKUP_DIR, { recursive: true })

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const backupPath = join(BACKUP_DIR, `bot-data-${timestamp}.sqlite`)

    copyFileSync(DB_PATH, backupPath)
    console.log(`[BACKUP] ✅ Backup síncrono criado: ${backupPath}`)
    cleanOldBackups()
    return backupPath
  } catch (error) {
    console.error("[BACKUP] Erro no backup síncrono:", error.message)
    return null
  }
}

function cleanOldBackups() {
  try {
    if (!existsSync(BACKUP_DIR)) return
    const files = readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("bot-data-") && f.endsWith(".sqlite"))
      .map((f) => ({ name: f, path: join(BACKUP_DIR, f), time: statSync(join(BACKUP_DIR, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time)
    for (const file of files.slice(MAX_BACKUPS)) {
      unlinkSync(file.path)
      console.log(`[BACKUP] Removido backup antigo: ${file.name}`)
    }
  } catch (error) {
    console.error("[BACKUP] Erro ao limpar backups:", error.message)
  }
}

export function listBackups() {
  try {
    if (!existsSync(BACKUP_DIR)) return []
    return readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("bot-data-") && f.endsWith(".sqlite"))
      .map((f) => {
        const p = join(BACKUP_DIR, f)
        return { name: f, path: p, sizeKB: Math.round(statSync(p).size / 1024), created: statSync(p).mtime }
      })
      .sort((a, b) => b.created - a.created)
  } catch {
    return []
  }
}

export function getDatabaseSize() {
  try {
    return existsSync(DB_PATH) ? Math.round(statSync(DB_PATH).size / 1024) : 0
  } catch {
    return 0
  }
}

export function startAutoBackup(intervalHours = 6) {
  createBackup()
  setInterval(() => {
    console.log("[BACKUP] Executando backup automático...")
    createBackup()
  }, intervalHours * 3_600_000)
  console.log(`[BACKUP] Automático configurado a cada ${intervalHours}h.`)
}
