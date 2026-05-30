/**
 * registerCommands.js — v2
 *
 * Melhoria: compara hash dos comandos antes de chamar a API do Discord.
 * Se os comandos não mudaram desde o último registro, pula o PUT —
 * evitando rate limit desnecessário e atraso no boot.
 *
 * O hash é salvo em .commands-hash (gitignored) ao lado do bot-data.sqlite.
 */

import { REST, Routes, PermissionFlagsBits } from "discord.js"
import { createHash }   from "crypto"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { fileLog } from "./fileLogger.js"
import { join, dirname }  from "path"
import { fileURLToPath } from "url"

const __dirname  = dirname(fileURLToPath(import.meta.url))
const HASH_FILE  = join(__dirname, "..", ".commands-hash")

// ─────────────────────────────────────────────
// DEFINIÇÃO DOS COMANDOS
// ─────────────────────────────────────────────

const COMMANDS = [
  // ===== PAINEL TICKETS =====
  {
    name: "ticket",
    description: "Envia o painel de tickets no canal atual",
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
  },
  {
    name: "setuppainel",
    description: "Configura o painel de tickets em um canal específico",
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      { name: "canal", description: "Canal onde o painel será enviado", type: 7, required: true },
    ],
  },
  {
    name: "setupanuncio",
    description: "Configura o painel de anúncios em um canal específico",
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
    options: [
      { name: "canal", description: "Canal onde o painel será enviado", type: 7, required: true },
    ],
  },

  // ===== PAINEL STAFF UNIFICADO =====
  {
    name: "staff",
    description: "Painel de gerenciamento da staff (blacklist, anúncios, config, dashboard)",
    default_member_permissions: PermissionFlagsBits.Administrator.toString(),
  },

  // ===== COMANDOS DE USUÁRIO =====
  {
    name: "perfil",
    description: "Ver perfil completo de um usuário no servidor",
    options: [
      { name: "usuario", description: "Usuário para ver o perfil (vazio = você mesmo)", type: 6, required: false },
    ],
  },
  {
    name: "reputacao",
    description: "Ver a reputação de um usuário",
    options: [
      { name: "usuario", description: "Usuário para ver reputação (vazio = você mesmo)", type: 6, required: false },
    ],
  },
  {
    name: "buscar",
    description: "Buscar contas disponíveis para compra",
    options: [
      { name: "nick",      description: "Buscar por nickname",  type: 3,  required: false },
      { name: "preco_min", description: "Preço mínimo (R$)",    type: 10, required: false },
      { name: "preco_max", description: "Preço máximo (R$)",    type: 10, required: false },
      {
        name: "vip",
        description: "Filtrar por VIP/rank",
        type: 3,
        required: false,
        choices: [
          { name: "VIP",   value: "VIP"   },
          { name: "VIP+",  value: "VIP+"  },
          { name: "MVP",   value: "MVP"   },
          { name: "MVP+",  value: "MVP+"  },
          { name: "MVP++", value: "MVP++" },
        ],
      },
      {
        name: "capa",
        description: "Filtrar por capa",
        type: 3,
        required: false,
        choices: [
          { name: "Migratória",   value: "Migrat"     },
          { name: "Minecon 2011", value: "Minecon 2011" },
          { name: "Minecon 2012", value: "Minecon 2012" },
          { name: "Minecon 2013", value: "Minecon 2013" },
          { name: "Minecon 2015", value: "Minecon 2015" },
          { name: "Minecon 2016", value: "Minecon 2016" },
        ],
      },
      {
        name: "ordenar",
        description: "Ordenar resultados",
        type: 3,
        required: false,
        choices: [
          { name: "Mais recente",     value: "newest"    },
          { name: "Mais antigo",      value: "oldest"    },
          { name: "Menor preço",      value: "cheapest"  },
          { name: "Maior preço",      value: "expensive" },
          { name: "Melhor avaliação", value: "rating"    },
        ],
      },
    ],
  },
  {
    name: "meusanuncios",
    description: "Ver seus anúncios ativos e histórico com opções de gerenciamento",
  },
  {
    name: "ranking",
    description: "Ver ranking dos melhores vendedores",
    options: [
      {
        name: "tipo",
        description: "Tipo de ranking",
        type: 3,
        required: false,
        choices: [
          { name: "Mais vendas",      value: "sales"         },
          { name: "Melhor avaliação", value: "rating"        },
          { name: "Mais anúncios",    value: "announcements" },
        ],
      },
    ],
  },
  {
    name: "verificarconta",
    description: "Verificar se uma conta Minecraft já foi anunciada antes",
    options: [{ name: "nick", description: "Nickname da conta", type: 3, required: true }],
  },
  {
    name: "minhascompras",
    description: "Ver o histórico de contas que você comprou",
  },
  {
    name: "alertas",
    description: "Gerenciar seus alertas de interesse por contas (criar, listar, deletar)",
  },
  {
    name: "stats",
    description: "Ver estatísticas do servidor",
  },
  {
    name: "ajuda",
    description: "Ver todos os comandos e como usar o sistema",
  },
  {
    name: "meusfavoritos",
    description: "Ver seus anúncios favoritados com status atual e opções de gerenciamento",
  },
  // ===== NOVOS COMANDOS =====
  {
    name: "notificar",
    description: "Ativar ou desativar notificações de novos anúncios",
    options: [
      {
        name: "acao",
        description: "Escolha a ação",
        type: 3,
        required: true,
        choices: [
          { name: "✅ Ativar notificações", value: "on" },
          { name: "❌ Desativar notificações", value: "off" },
          { name: "📊 Ver status", value: "status" },
        ],
      },
    ],
  },
]

// ─────────────────────────────────────────────
// HASH DOS COMANDOS
// ─────────────────────────────────────────────

function computeHash(commands) {
  return createHash("sha256").update(JSON.stringify(commands)).digest("hex")
}

function loadSavedHash() {
  try {
    return existsSync(HASH_FILE) ? readFileSync(HASH_FILE, "utf-8").trim() : null
  } catch {
    return null
  }
}

function saveHash(hash) {
  try {
    writeFileSync(HASH_FILE, hash, "utf-8")
  } catch (err) {
    fileLog.warn({ err: err.message }, "[COMANDOS] Nao foi possivel salvar hash dos comandos")
  }
}

// ─────────────────────────────────────────────
// REGISTRO COM DETECÇÃO DE MUDANÇAS
// ─────────────────────────────────────────────

/**
 * Registra comandos slash apenas se houve mudanças desde o último registro.
 * Usa SHA-256 do JSON dos comandos para comparar.
 */
export async function registerCommandsIfChanged(token, clientId, guildId) {
  const currentHash = computeHash(COMMANDS)
  const savedHash   = loadSavedHash()

  if (savedHash === currentHash) {
    fileLog.info("[COMANDOS] Sem mudancas detectadas — registro da API pulado.")
    return
  }

  const rest = new REST({ version: "10" }).setToken(token)

  try {
    fileLog.info("[COMANDOS] Mudancas detectadas. Registrando comandos slash...")
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: COMMANDS })
    saveHash(currentHash)
    fileLog.info("[COMANDOS] Comandos registrados e hash salvo.")
  } catch (error) {
    fileLog.error({ err: String(error) }, "[COMANDOS] Erro ao registrar comandos")
  }
}

/**
 * Força o registro ignorando o hash (útil para debug/deploy forçado).
 * Use: FORCE_REGISTER=true node index.js
 */
export async function registerCommands(token, clientId, guildId) {
  if (process.env.FORCE_REGISTER === "true") {
    // Apaga o hash para forçar re-registro na próxima chamada normal
    try { writeFileSync(HASH_FILE, "", "utf-8") } catch {}
  }
  return registerCommandsIfChanged(token, clientId, guildId)
}
