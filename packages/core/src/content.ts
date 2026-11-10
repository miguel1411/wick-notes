/**
 * Contenido de las notas: texto Markdown en un Y.Text.
 *
 * El editor (CodeMirror) edita ese texto directamente, así que lo que se guarda,
 * se exporta y leen la CLI o los agentes es exactamente lo que se escribió. No
 * hay conversión entre formatos.
 *
 * Los cambios que llegan desde fuera (API, CLI, MCP, restaurar versión) se
 * calculan por diferencias de texto: solo se tocan los tramos que cambian, así
 * que se pueden aplicar sobre la nota viva aunque alguien esté escribiendo.
 *
 * Quien reescribe una nota que leyó hace un rato (un agente, `wick notes edit`)
 * usa `mergeUpdate`: su cambio se calcula sobre lo que leyó y Yjs lo une con lo
 * que otras personas escribieron desde entonces, en vez de borrarlo.
 */
import diff from 'fast-diff'
import * as Y from 'yjs'

/** Nombre del Y.Text con el Markdown dentro del documento Yjs. */
export const CONTENT_KEY = 'markdown'

/**
 * Formato del contenido que entiende este servidor. El editor lo envía al
 * conectarse; así una pestaña con una versión antigua de la web no puede
 * escribir en el formato anterior.
 */
export const CONTENT_FORMAT = 'markdown-v1'

/** Cabecera HTTP con la revisión de la nota que se acaba de leer o escribir. */
export const REVISION_HEADER = 'x-wick-revision'

/** Fragmento del formato anterior (Milkdown/ProseMirror), solo para detectarlo. */
const LEGACY_FRAGMENT = 'prosemirror'

/** Saltos de línea de Windows y BOM fuera: el texto se guarda siempre igual. */
export function normalizeMarkdown(markdown: string): string {
  return markdown.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}

function loadDoc(state: Uint8Array | null): Y.Doc {
  const doc = new Y.Doc()
  if (state?.length) Y.applyUpdate(doc, state)
  return doc
}

/** Markdown de un estado Yjs (vacío si no hay estado). */
export function readMarkdown(state: Uint8Array | null): string {
  if (!state?.length) return ''
  const doc = loadDoc(state)
  try {
    return doc.getText(CONTENT_KEY).toString()
  } finally {
    doc.destroy()
  }
}

/** Estado completo de una nota nueva con este Markdown. */
export function stateFromMarkdown(markdown: string): Uint8Array {
  const doc = new Y.Doc()
  try {
    doc.getText(CONTENT_KEY).insert(0, normalizeMarkdown(markdown))
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

/**
 * Aplica sobre `text` los cambios mínimos para que el tramo `source`, que empieza
 * en `offset`, pase a ser `target` (por defecto, todo el texto).
 */
function applyDiff(text: Y.Text, target: string, source = text.toString(), offset = 0) {
  let pos = offset
  for (const [op, chunk] of diff(source, target, undefined, true)) {
    if (op === diff.EQUAL) pos += chunk.length
    else if (op === diff.DELETE) text.delete(pos, chunk.length)
    else {
      text.insert(pos, chunk)
      pos += chunk.length
    }
  }
}

/**
 * Identificador de cliente para un cambio que llega desde fuera (agente, CLI).
 *
 * Si una persona y el agente insertan a la vez en el mismo punto, Yjs pone
 * primero el texto del cliente con identificador menor. Con uno alto, lo que la
 * persona está escribiendo queda delante y el agente no se mete en medio de su
 * frase. No se repite ninguno que ya esté en la nota (repetirlo la corrompería).
 */
function externalClientId(...states: (Uint8Array | null)[]): number {
  const used = new Set<number>()
  for (const state of states) {
    if (state?.length) for (const client of Y.decodeStateVector(Y.encodeStateVectorFromUpdate(state)).keys()) used.add(client)
  }
  let id: number
  // La franja más alta (un millón de valores): casi ningún navegador queda por encima.
  do id = 0xfff00000 + Math.floor(Math.random() * 0x100000)
  while (used.has(id))
  return id
}

/**
 * Cambios Yjs (solo lo nuevo) que hace `mutate` sobre el texto del estado dado.
 * `live`: la nota actual, si `state` es una lectura anterior.
 */
function updateFrom(state: Uint8Array | null, mutate: (text: Y.Text) => void, live: Uint8Array | null = null): Uint8Array {
  const doc = loadDoc(state)
  doc.clientID = externalClientId(state, live)
  try {
    const before = Y.encodeStateVector(doc)
    doc.transact(() => mutate(doc.getText(CONTENT_KEY)))
    return Y.encodeStateAsUpdate(doc, before)
  } finally {
    doc.destroy()
  }
}

/** Cambios Yjs que convierten el contenido de `state` en `markdown`, por diferencias. */
export function replaceUpdate(state: Uint8Array | null, markdown: string): Uint8Array {
  return updateFrom(state, (text) => applyDiff(text, normalizeMarkdown(markdown)))
}

/**
 * Cambios Yjs para pasar de una lectura anterior de la nota (`base`) a
 * `markdown`. Se calculan sobre la base y no sobre la nota actual: al aplicarlos
 * a la nota viva, Yjs los une con lo que otras personas hayan escrito desde esa
 * lectura, como si el agente hubiera escrito a la vez que ellas. Solo se borra
 * lo que ya estaba en la base.
 *
 * `base` debe ser un estado anterior de `live`, la nota actual (ver `stateIncludes`).
 */
export function mergeUpdate(base: Uint8Array, markdown: string, live: Uint8Array | null): Uint8Array {
  return updateFrom(base, (text) => applyDiff(text, normalizeMarkdown(markdown)), live)
}

/** ¿Contiene `state` todo lo que había en `base`? (es decir, `base` es un estado anterior de la misma nota) */
export function stateIncludes(state: Uint8Array | null, base: Uint8Array): boolean {
  const have = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(state?.length ? state : Y.encodeStateAsUpdate(new Y.Doc())))
  const need = Y.decodeStateVector(Y.encodeStateVectorFromUpdate(base))
  for (const [client, clock] of need) if ((have.get(client) ?? 0) < clock) return false
  return true
}

/** Un cambio puntual: el fragmento `find` (que debe aparecer una sola vez) pasa a ser `replace`. */
export interface TextEdit {
  find: string
  replace: string
}

/** Un fragmento a cambiar no está en la nota o aparece varias veces. */
export class ContentEditError extends Error {
  override name = 'ContentEditError'
}

/**
 * Cambios Yjs que aplican `edits` en orden sobre el texto actual. Todo o nada:
 * si un fragmento no aparece exactamente una vez, no se cambia nada. Dentro de
 * cada fragmento solo se tocan los caracteres que cambian.
 */
export function editUpdate(state: Uint8Array | null, edits: TextEdit[]): Uint8Array {
  return updateFrom(state, (text) => {
    edits.forEach((edit, i) => {
      const find = normalizeMarkdown(edit.find)
      const replace = normalizeMarkdown(edit.replace)
      const which = edits.length > 1 ? `El fragmento n.º ${i + 1}` : 'El fragmento'
      const current = text.toString()
      const at = find ? current.indexOf(find) : -1
      if (at < 0) {
        throw new ContentEditError(`${which} no está en la nota (puede que alguien lo haya cambiado). Vuelve a leerla y cópialo tal cual.`)
      }
      if (current.indexOf(find, at + 1) >= 0) {
        throw new ContentEditError(`${which} aparece varias veces en la nota. Incluye más texto alrededor para que sea único.`)
      }
      applyDiff(text, replace, find, at)
    })
  })
}

/** Cambios Yjs que añaden `markdown` al final, separado por una línea en blanco. */
export function appendUpdate(state: Uint8Array | null, markdown: string): Uint8Array {
  return updateFrom(state, (text) => {
    const current = text.toString()
    const added = normalizeMarkdown(markdown)
    const separator = !current.trim() ? '' : current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n'
    // Si el documento solo tenía líneas en blanco, se sustituyen.
    if (!current.trim() && current.length) text.delete(0, current.length)
    text.insert(text.length, separator + added)
  })
}

/** Cambios Yjs que llevan `state` al contenido de otra versión (`target`), por diferencias. */
export function restoreUpdate(state: Uint8Array | null, target: Uint8Array | null): Uint8Array {
  return replaceUpdate(state, readMarkdown(target))
}

/**
 * Estado del formato anterior: contenido en el fragmento de ProseMirror y nada
 * en el texto Markdown. Se convierte una sola vez (ver apps/collab).
 */
export function isLegacyState(state: Uint8Array | null): boolean {
  if (!state?.length) return false
  const doc = loadDoc(state)
  try {
    return doc.getXmlFragment(LEGACY_FRAGMENT).length > 0 && doc.getText(CONTENT_KEY).length === 0
  } finally {
    doc.destroy()
  }
}
