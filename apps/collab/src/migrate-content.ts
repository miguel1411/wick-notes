import { contentIndex, extractPlainText, isLegacyState, stateFromMarkdown } from '@wick/core'
import { getPrisma } from '@wick/db'
import { LegacyMarkdownConverter } from '@wick/markdown'

const BATCH = 50

/**
 * Pasa al formato actual (Markdown en un Y.Text) las notas y versiones guardadas
 * con el editor anterior (Milkdown, Y.XmlFragment). Se ejecuta al arrancar, antes
 * de aceptar conexiones; solo toca lo que sigue en el formato antiguo, así que
 * repetirla no cambia nada.
 *
 * Cada nota se guarda como un documento Yjs nuevo, sin el historial interno del
 * formato anterior. El historial de versiones de wick se conserva (también se
 * convierte).
 */
export async function migrateLegacyContent(log: (msg: string) => void = console.log): Promise<{ documents: number; versions: number; failed: number }> {
  const prisma = getPrisma()
  const converter = new LegacyMarkdownConverter()
  const result = { documents: 0, versions: 0, failed: 0 }

  const convert = async (kind: string, id: string, state: Uint8Array): Promise<Uint8Array | null> => {
    try {
      return stateFromMarkdown(await converter.toMarkdown(state))
    } catch (err) {
      result.failed++
      log(`[collab] migración: no se pudo convertir ${kind} ${id}: ${(err as Error).message}`)
      return null
    }
  }

  try {
    let cursor: string | undefined
    for (;;) {
      const docs = await prisma.document.findMany({
        where: { yjsState: { not: null } },
        select: { id: true, yjsState: true, updatedAt: true },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      for (const d of docs) {
        const state = new Uint8Array(d.yjsState!)
        if (!isLegacyState(state)) continue
        const next = await convert('la nota', d.id, state)
        if (!next) continue
        // Se conserva updatedAt: para quien la lee, la nota no ha cambiado.
        await prisma.document.update({
          where: { id: d.id },
          data: { yjsState: new Uint8Array(next), ...contentIndex(next), updatedAt: d.updatedAt },
        })
        result.documents++
      }
      if (docs.length < BATCH) break
      cursor = docs.at(-1)!.id
    }

    cursor = undefined
    for (;;) {
      const versions: { id: string; yjsState: Uint8Array }[] = await prisma.documentVersion.findMany({
        select: { id: true, yjsState: true },
        orderBy: { id: 'asc' },
        take: BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
      for (const v of versions) {
        const state = new Uint8Array(v.yjsState)
        if (!isLegacyState(state)) continue
        const next = await convert('la versión', v.id, state)
        if (!next) continue
        await prisma.documentVersion.update({
          where: { id: v.id },
          data: { yjsState: new Uint8Array(next), contentText: extractPlainText(next) },
        })
        result.versions++
      }
      if (versions.length < BATCH) break
      cursor = versions.at(-1)!.id
    }
  } finally {
    await converter.close()
  }

  if (result.documents || result.versions || result.failed) {
    log(`[collab] migración al editor Markdown: ${result.documents} notas y ${result.versions} versiones convertidas${result.failed ? `, ${result.failed} con error (se quedan como estaban)` : ''}`)
  }
  return result
}
