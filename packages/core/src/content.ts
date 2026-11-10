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

/** Fragmento del formato anterior (Milkdown/ProseMirror), solo para migrar. */
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

/** Aplica sobre `text` los cambios mínimos para que pase a ser `target`. */
function applyDiff(text: Y.Text, target: string) {
  let pos = 0
  for (const [op, chunk] of diff(text.toString(), target, undefined, true)) {
    if (op === diff.EQUAL) pos += chunk.length
    else if (op === diff.DELETE) text.delete(pos, chunk.length)
    else {
      text.insert(pos, chunk)
      pos += chunk.length
    }
  }
}

/** Cambios Yjs (solo lo nuevo) que hace `mutate` sobre el texto del estado dado. */
function updateFrom(state: Uint8Array | null, mutate: (text: Y.Text) => void): Uint8Array {
  const doc = loadDoc(state)
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
