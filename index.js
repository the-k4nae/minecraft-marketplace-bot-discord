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
import { pathToFileURL } from "url"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { initDatabase, saveDatabase, saveDatabaseSync } from "./utils/database.js"
import { registerCommandsIfChanged } from "./utils/registerCommands.js"
import { startSchedulers } from "./utils/scheduler.js"
import { startHealthcheck } from "./utils/healthcheck.js"
import { startAutoBackup, createBackupSync } from "./utils/backup.js"
import { sendLogEmbed } from "./utils/logger.js"
import { updateChannelActivity } from "./utils/database.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

// ─────────────────────────────────────────────
// VALIDAÇÃO DE VARIÁVEIS DE AMBIENTE
// ─────────────────────────────────────────────

const requiredEnvVars = ["DISCORD_TOKEN", "DISCORD_CLIENT_ID", "DISCORD_GUILD_ID"]
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`[FATAL] Variavel de ambiente ${envVar} nao definida. Verifique seu arquivo .env`)
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
  console.error("[FATAL] Erro ao carregar config.json:", error.message)
  process.exit(1)
}

// Injetar credenciais do .env (não precisam estar no config.json)
config.token    = process.env.DISCORD_TOKEN
config.clientId = process.env.DISCORD_CLIENT_ID
config.guildId  = process.env.DISCORD_GUILD_ID

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
  console.log(`[RECONEXAO] Tentativa ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`)
})

client.on("shardResume", () => {
  reconnectAttempts = 0
  console.log("[RECONEXAO] Reconectado com sucesso!")
})

client.on("shardDisconnect", event => {
  console.warn(`[DESCONEXAO] Codigo: ${event.code} | Motivo: ${event.reason || "desconhecido"}`)
})

client.on("shardError", error => {
  console.error("[SHARD ERRO]", error.message)
})

// Nota: client.on("rateLimit") foi removido no discord.js v14.
// Rate limits agora são tratados internamente pela lib com queue automática.
// Para monitorar, use client.rest.on("rateLimited", ...) se necessário.

client.on("error", error => {
  console.error("[CLIENT ERRO]", error.message)
})

client.on("warn", message => {
  console.warn("[CLIENT AVISO]", message)
})

if (process.env.DEBUG === "true") {
  client.on("debug", message => {
    console.debug("[DEBUG]", message)
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

client.once("clientReady", () => {
  readyModule.default(client)
  reconnectAttempts = 0

  startSchedulers(client)
  startHealthcheck(client)
  startAutoBackup(6)

  sendLogEmbed(client, {
    title: "Bot Iniciado",
    description: `Bot **${client.user.tag}** conectado com sucesso.`,
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

// Rastrear atividade de canais para anti-inatividade
client.on("messageCreate", message => {
  if (!message.author.bot && message.channelId) {
    updateChannelActivity(message.channelId)
  }
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
      console.log(`[COMANDOS] Carregado: /${module.data.name}`)
    }
  }
}

await loadCommands().catch(err => console.error("[COMANDOS] Erro ao carregar:", err))

// Registra comandos slash apenas se houve mudanças (evita rate limit)
await registerCommandsIfChanged(config.token, config.clientId, config.guildId)

// ─────────────────────────────────────────────
// TRATAMENTO GLOBAL DE ERROS
// ─────────────────────────────────────────────

process.on("unhandledRejection", (reason) => {
  console.error("[UNHANDLED REJECTION]", reason)
  sendLogEmbed(client, {
    title: "Erro Nao Tratado",
    description: `\`\`\`${String(reason).substring(0, 1000)}\`\`\``,
    color: "#FF0000",
  }).catch(() => {})
})

process.on("uncaughtException", error => {
  console.error("[UNCAUGHT EXCEPTION]", error)
  try {
    saveDatabaseSync()
    createBackupSync()
  } catch (e) {
    console.error("[EMERGENCY] Falha ao salvar dados:", e.message)
  }
  process.exit(1)
})

// ─────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────

async function gracefulShutdown(signal) {
  console.log(`\n[SHUTDOWN] Sinal ${signal} recebido. Desligando graciosamente...`)
  try {
    saveDatabaseSync()
    console.log("[SHUTDOWN] Banco de dados salvo.")

    createBackupSync()
    console.log("[SHUTDOWN] Backup de emergencia criado.")

    await sendLogEmbed(client, {
      title: "Bot Desligado",
      description: `Bot **${client.user?.tag || "desconhecido"}** desligado graciosamente. Sinal: ${signal}`,
      color: "#FF6B6B",
    }).catch(() => {})

    client.destroy()
    console.log("[SHUTDOWN] Client destruido. Ate mais!")
  } catch (error) {
    console.error("[SHUTDOWN] Erro durante desligamento:", error.message)
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
      console.log("[LOGIN] Login realizado com sucesso!")
      return
    } catch (error) {
      console.error(`[LOGIN] Tentativa ${attempt}/${maxRetries} falhou:`, error.message)
      if (attempt < maxRetries) {
        console.log(`[LOGIN] Tentando novamente em ${delayMs / 1000}s...`)
        await new Promise(res => setTimeout(res, delayMs))
        delayMs *= 2
      } else {
        console.error("[FATAL] Nao foi possivel conectar ao Discord apos todas as tentativas.")
        process.exit(1)
      }
    }
  }
}

loginWithRetry()
