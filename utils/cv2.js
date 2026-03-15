/**
 * utils/cv2.js  —  Components v2 helpers para discord.js v14.16+
 *
 * ContainerBuilder NÃO tem addComponents() genérico.
 * Cada tipo de filho tem seu próprio método tipado:
 *   TextDisplayBuilder  → addTextDisplayComponents()
 *   SeparatorBuilder    → addSeparatorComponents()
 *   ActionRowBuilder    → addActionRowComponents()
 *   SectionBuilder      → addSectionComponents()
 *
 * SectionBuilder aceita um accessory: ThumbnailBuilder | ButtonBuilder
 * ThumbnailBuilder.setMedia({ url }) define a imagem lateral.
 */

import {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  ActionRowBuilder,
  MessageFlags,
} from "discord.js"

// ─────────────────────────────────────────────
// FLAGS de Components v2
// ─────────────────────────────────────────────

/** Flag obrigatória para mensagens com Components v2 */
export const C2_FLAG      = MessageFlags.IsComponentsV2
/** Flag para mensagens C2 ephemeral */
export const C2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral

// ─────────────────────────────────────────────
// PRIMITIVOS
// ─────────────────────────────────────────────

/** TextDisplay — suporta markdown completo (# ## **bold** *italic* etc.) */
export function text(content) {
  return new TextDisplayBuilder().setContent(String(content))
}

/** Separador horizontal */
export function sep(divider = true) {
  return new SeparatorBuilder().setDivider(divider)
}

/**
 * Thumbnail lateral para usar como accessory em section().
 * @param {string} url - URL da imagem
 * @returns {ThumbnailBuilder|null}
 */
export function thumb(url) {
  if (!url) return null
  try {
    return new ThumbnailBuilder().setMedia({ url })
  } catch {
    return null
  }
}

/**
 * Section: texto + thumbnail lateral (accessory).
 * Se accessory for null/undefined, retorna um TextDisplay simples.
 * @param {string} content - Conteúdo markdown
 * @param {ThumbnailBuilder|null} accessory - Thumbnail ou botão lateral
 * @returns {SectionBuilder|TextDisplayBuilder}
 */
export function section(content, accessory = null) {
  if (!accessory) return text(content)
  try {
    const s = new SectionBuilder()
    s.addTextDisplayComponents(text(content))
    s.setAccessory(accessory)
    return s
  } catch {
    // Fallback se SectionBuilder não estiver disponível nesta versão
    return text(content)
  }
}

// ─────────────────────────────────────────────
// CONTAINER — dispatch tipado por instanceof
// ─────────────────────────────────────────────

function addToContainer(container, component) {
  if (component instanceof TextDisplayBuilder) {
    container.addTextDisplayComponents(component)
  } else if (component instanceof SeparatorBuilder) {
    container.addSeparatorComponents(component)
  } else if (component instanceof ActionRowBuilder) {
    container.addActionRowComponents(component)
  } else if (component instanceof SectionBuilder) {
    container.addSectionComponents(component)
  } else {
    // Fallback para tipos não reconhecidos
    try { container.addTextDisplayComponents(component) } catch {
      try { container.addActionRowComponents(component) } catch { /* ignorar */ }
    }
  }
}

/**
 * Monta um Container a partir de um array de componentes.
 * @param {Array}       children - TextDisplay, Separator, Section, ActionRow
 * @param {number|null} color    - Cor de destaque (hex number, ex: 0x5865F2)
 */
export function build(children, color = null) {
  const c = new ContainerBuilder()
  if (color !== null) c.setAccentColor(color)
  if (children?.length) {
    for (const child of children) {
      if (child != null) addToContainer(c, child)
    }
  }
  return c
}

/**
 * Atalho: Container com apenas um TextDisplay.
 * @param {string}      content - Texto markdown
 * @param {number|null} color   - Cor de destaque
 */
export function box(content, color = null) {
  return build([text(content)], color)
}

// ─────────────────────────────────────────────
// HELPERS DE ENVIO
// ─────────────────────────────────────────────

/** Retorna options para send/reply não-ephemeral com C2. */
export function c2(containers, extra = {}) {
  return {
    components: Array.isArray(containers) ? containers : [containers],
    flags: C2_FLAG,
    ...extra,
  }
}

/** Retorna options para send/reply ephemeral com C2. */
export function ephemeral(containers, extra = {}) {
  return {
    components: Array.isArray(containers) ? containers : [containers],
    flags: C2_EPHEMERAL,
    ...extra,
  }
}

// ─────────────────────────────────────────────
// HELPERS DE CONTEÚDO
// ─────────────────────────────────────────────

/**
 * Converte array de [name, value, inline?] para texto markdown.
 */
export function fieldsToMd(fields) {
  const lines = []
  const buf   = []
  const flush = () => { if (buf.length) { lines.push(buf.join("   ·   ")); buf.length = 0 } }
  for (const [name, value, inline] of fields) {
    if (inline) {
      buf.push(`**${name}:** ${value}`)
      if (buf.length >= 3) flush()
    } else {
      flush()
      lines.push(`**${name}**\n${value}`)
    }
  }
  flush()
  return lines.join("\n\n")
}
