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
      { name: "nick",       description: "Buscar por nickname",   type: 3,  required: false },
      { name: "preco_min",  description: "Preço mínimo (R$)",     type: 10, required: false },
      { name: "preco_max",  description: "Preço máximo (R$)",     type: 10, required: false },
      { name: "vip",        description: "Filtrar por VIP/tag",   type: 3,  required: false },
      {
        name: "ordenar",
        description: "Ordenar resultados",
        type: 3,
        required: false,
        choices: [
          { name: "Mais recente",   value: "newest"    },
          { name: "Mais antigo",    value: "oldest"    },
          { name: "Menor preço",    value: "cheapest"  },
          { name: "Maior preço",    value: "expensive" },
          { name: "Melhor avaliação", value: "rating"  },
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
    name: "meufavoritos",
    description: "Ver seus anúncios favoritados com status atual e opções de gerenciamento",
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
    console.warn("[COMANDOS] Nao foi possivel salvar hash dos comandos:", err.message)
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
    console.log("[COMANDOS] Sem mudancas detectadas — registro da API pulado.")
    return
  }

  const rest = new REST({ version: "10" }).setToken(token)

  try {
    console.log("[COMANDOS] Mudancas detectadas. Registrando comandos slash...")
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: COMMANDS })
    saveHash(currentHash)
    console.log("[COMANDOS] Comandos registrados e hash salvo.")
  } catch (error) {
    console.error("[COMANDOS] Erro ao registrar comandos:", error)
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
