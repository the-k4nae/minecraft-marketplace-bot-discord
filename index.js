/**
 * index.js — v3
 *
 * Melhorias:
 *  - Imports de eventos com top-level await (sem race condition de clientReady)
 *  - Removido client.on("rateLimit") que foi removido no discord.js v14+
 *  - Removida duplicação de config (somente .env como source of truth)
 */

import "dotenv/config"
import { Client, GatewayIntentBits, Collection } from "discord.js"
import { readFileSync, readdirSync } from "fs"
import { pathToFileURL, fileURLToPath } from "url"
import { join, dirname } from "path"
import { initDatabase, saveDatabase, saveDatabaseSync, updateChannelActivity } from "./utils/database.js"
import { registerCommandsIfChanged } from "./utils/registerCommands.js"
import { startSchedulers } from "./utils/scheduler.js"
import { startHealthcheck } from "./utils/healthcheck.js"
import { startAutoBackup, createBackupSync } from "./utils/backup.js"
import { sendLogEmbed } from "./utils/logger.js"
import { fileLogError, fileLog } from "./utils/fileLogger.js"
import { initErrorAlerter, sendCriticalError } from "./utils/errorAlerter.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─────────────────────────────────────────────
// VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE
// ─────────────────────────────────────────────

const requiredEnvVars = [
  "DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID",
  "CHANNEL_ANUNCIOS", "CHANNEL_LOGS", "CHANNEL_ANTISCAM", "CHANNEL_VENDAS",
  "CHANNEL_MEDIA_ARCHIVE", "ROLE_STAFF", "CATEGORY_TICKETS", "CATEGORY_NEGOCIACOES",
]
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    fileLog.error({ envVar }, "[FATAL] Variavel de ambiente nao definida. Verifique seu arquivo .env")
    process.exit(1)
  }
}

// ─────────────────────────────────────────────
// CONFIGURAÇÃO
// .env é o único source of truth para credenciais.
// config.json guarda apenas configurações do servidor (canais, roles, etc.)
// ─────────────────────────────────────────────

let config
try {
  config = JSON.parse(readFileSync(join(__dirname, "config.json"), "utf-8"))
} catch (error) {
  fileLog.error({ err: error.message }, "[FATAL] Erro ao carregar config.json")
  process.exit(1)
}

// Injetar credenciais e IDs do .env — único source of truth para dados sensíveis
config.token    = process.env.DISCORD_TOKEN
config.clientId = process.env.DISCORD_CLIENT_ID
config.guildId  = process.env.DISCORD_GUILD_ID

config.channels = {
  anuncios:      process.env.CHANNEL_ANUNCIOS,
  logs:          process.env.CHANNEL_LOGS,
  antiscam:      process.env.CHANNEL_ANTISCAM,
  vendas:        process.env.CHANNEL_VENDAS,
  mediaArchive:  process.env.CHANNEL_MEDIA_ARCHIVE,
  review:        process.env.CHANNEL_REVIEW || "",  // canal onde reviews de anúncios chegam — NUNCA usar logs como fallback
}
config.roles      = { staff: process.env.ROLE_STAFF }
config.categories = {
  tickets:      process.env.CATEGORY_TICKETS,
  negociacoes:  process.env.CATEGORY_NEGOCIACOES,
}

// ─────────────────────────────────────────────
// CLIENTE DISCORD
// ─────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  failIfNotExists: false,
})

client.commands  = new Collection()
client.config    = config
client.cooldowns = new Collection()

// ─────────────────────────────────────────────
// BANCO DE DADOS
// ─────────────────────────────────────────────

initDatabase()

// ─────────────────────────────────────────────
// EVENTOS DE CONEXÃO / RECONEXÃO
// ─────────────────────────────────────────────

let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 5

client.on("shardReconnecting", () => {
  reconnectAttempts++
  fileLog.info({ attempt: reconnectAttempts, max: MAX_RECONNECT_ATTEMPTS }, "[RECONEXAO] Tentativa")
})

client.on("shardResume", () => {
  reconnectAttempts = 0
  fileLog.info("[RECONEXAO] Reconectado com sucesso!")
})

client.on("shardDisconnect", event => {
  fileLog.warn({ code: event.code, reason: event.reason || "desconhecido" }, "[DESCONEXAO]")
})

client.on("shardError", error => {
  fileLogError("shardError", error)
})

// Nota: client.on("rateLimit") foi removido no discord.js v14.
// Rate limits agora são tratados internamente pela lib com queue automática.
// Para monitorar, use client.rest.on("rateLimited", ...) se necessário.

client.on("error", error => {
  fileLogError("clientError", error)
})

client.on("warn", message => {
  fileLog.warn({ message }, "[CLIENT AVISO]")
})

if (process.env.DEBUG === "true") {
  client.on("debug", message => {
    fileLog.debug({ message }, "[DEBUG]")
  })
}

// ─────────────────────────────────────────────
// IMPORTS DE EVENTOS — top-level await para evitar race condition
//
// Antes: import().then(m => client.once("clientReady", () => m.default(client)))
// Problema: se o evento disparar antes do .then() resolver, é perdido.
// Solução: await no import antes de registrar o listener.
// ─────────────────────────────────────────────

const readyModule = await import("./events/ready.js")
const interactionModule = await import("./events/interactionCreate.js")
const { handlePhotoMessage } = await import("./handlers/photoEdit.js")

client.once("clientReady", () => {
  readyModule.default(client)
  reconnectAttempts = 0

  initErrorAlerter(client)
  startSchedulers(client)
  startHealthcheck(client)
  startAutoBackup(6)

  sendLogEmbed(client, {
    title: "Bot Iniciado",
    description: `Bot **${client.user.username}** conectado com sucesso.`,
    color: "#00FF00",
    fields: [
      { name: "Servidores", value: client.guilds.cache.size.toString(), inline: true },
      { name: "Usuarios",   value: client.users.cache.size.toString(),  inline: true },
      { name: "Canais",     value: client.channels.cache.size.toString(), inline: true },
    ],
  }).catch(() => {})
})

client.on("interactionCreate", interaction =>
  interactionModule.default(interaction, client)
)

// Rastrear atividade de canais para anti-inatividade + edição de foto
client.on("messageCreate", message => {
  if (!message.author.bot && message.channelId) {
    updateChannelActivity(message.channelId)
  }
  handlePhotoMessage(message, client)
})

// ─────────────────────────────────────────────
// CARREGAMENTO DE COMANDOS
// ─────────────────────────────────────────────

async function loadCommands() {
  const commandsPath = join(__dirname, "commands")
  const files = readdirSync(commandsPath).filter(f => f.endsWith(".js"))
  for (const file of files) {
    const module = await import(pathToFileURL(join(commandsPath, file)).href)
    if (module.data && module.execute) {
      client.commands.set(module.data.name, module)
      fileLog.info({ command: module.data.name }, "[COMANDOS] Carregado")
    }
  }
}

await loadCommands().catch(err => fileLog.error({ err: err?.message }, "[COMANDOS] Erro ao carregar"))

// Registra comandos slash apenas se houve mudanças (evita rate limit)
await registerCommandsIfChanged(config.token, config.clientId, config.guildId)

// ─────────────────────────────────────────────
// TRATAMENTO GLOBAL DE ERROS
// ─────────────────────────────────────────────

process.on("unhandledRejection", (reason) => {
  fileLogError("unhandledRejection", reason)
  sendCriticalError("unhandledRejection", reason)
  sendLogEmbed(client, {
    title: "Erro Nao Tratado",
    description: `\`\`\`${String(reason).substring(0, 1000)}\`\`\``,
    color: "#FF0000",
  }).catch(() => {})
})

process.on("uncaughtException", error => {
  fileLogError("uncaughtException", error)
  sendCriticalError("uncaughtException", error)
  try {
    saveDatabaseSync()
    createBackupSync()
  } catch (e) {
    fileLog.error({ err: e?.message }, "[EMERGENCY] Falha ao salvar dados")
  }
  process.exit(1)
})

// ─────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────

async function gracefulShutdown(signal) {
  fileLog.info({ signal }, "[SHUTDOWN] Sinal recebido. Desligando graciosamente...")
  try {
    saveDatabaseSync()
    fileLog.info("[SHUTDOWN] Banco de dados salvo.")

    createBackupSync()
    fileLog.info("[SHUTDOWN] Backup de emergencia criado.")

    await sendLogEmbed(client, {
      title: "Bot Desligado",
      description: `Bot **${client.user?.username || "desconhecido"}** desligado graciosamente. Sinal: ${signal}`,
      color: "#FF6B6B",
    }).catch(() => {})

    client.destroy()
    fileLog.info("[SHUTDOWN] Client destruido. Ate mais!")
  } catch (error) {
    fileLog.error({ err: error?.message }, "[SHUTDOWN] Erro durante desligamento")
  }
  process.exit(0)
}

process.on("SIGINT",  () => gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))

// ─────────────────────────────────────────────
// LOGIN COM RETRY + BACKOFF EXPONENCIAL
// ─────────────────────────────────────────────

async function loginWithRetry(maxRetries = 3, delayMs = 5000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await client.login(config.token)
      fileLog.info("[LOGIN] Login realizado com sucesso!")
      return
    } catch (error) {
      fileLog.error({ attempt, max: maxRetries, err: error?.message }, "[LOGIN] Tentativa falhou")
      if (attempt < maxRetries) {
        fileLog.info({ delayMs }, "[LOGIN] Tentando novamente...")
        await new Promise(res => setTimeout(res, delayMs))
        delayMs *= 2
      } else {
        fileLog.error("[FATAL] Nao foi possivel conectar ao Discord apos todas as tentativas.")
        process.exit(1)
      }
    }
  }
}

loginWithRetry()
