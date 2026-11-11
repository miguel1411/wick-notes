import { getPrisma, Prisma } from '@wick/db'
import { requireActor, type AuthUser } from './auth/actor'
import { readMarkdown } from './content'
import type { DocumentSummary } from './documents'
import { readableDocumentsWhere } from './workspaces'

/**
 * Minúsculas, sin tildes y sin guiones: «Canción» y «cancion», o «Wi-Fi» y «wifi»,
 * se encuentran igual. Los puntos se conservan (IPs, versiones, dominios).
 */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[\u00AD\u2010\u2011\u2012\u2013-]/g, '')
    .toLowerCase()
}

/**
 * Texto de una nota para buscar y para las versiones: su Markdown tal cual.
 * Buscar por subcadena encuentra igual «negrita» dentro de «**negrita**».
 */
export function extractPlainText(state: Uint8Array | null): string {
  return readMarkdown(state)
}

/**
 * Columnas de búsqueda derivadas del contenido. Si el estado no se puede leer,
 * el índice queda vacío: indexar nunca debe impedir guardar una nota.
 */
export function contentIndex(state: Uint8Array | null) {
  let contentText = ''
  try {
    contentText = extractPlainText(state)
  } catch (err) {
    console.warn('[search] no se pudo extraer el texto de una nota:', (err as Error).message)
  }
  return { contentText, contentSearch: normalizeForSearch(contentText) }
}

export interface SearchResult extends DocumentSummary {
  /** Fragmento del contenido alrededor de la primera coincidencia (o el principio). */
  snippet: string
  /** Si las palabras aparecen todas en el título. */
  titleMatch: boolean
}

const SNIPPET_RADIUS = 70

/** Fragmento del texto original alrededor de la primera aparición de algún término. */
function makeSnippet(text: string, terms: string[]): string {
  if (!text) return ''
  // Normaliza carácter a carácter guardando la posición original de cada uno.
  let normalized = ''
  const map: number[] = []
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i)!
    const ch = String.fromCodePoint(cp)
    const n = normalizeForSearch(ch)
    for (let k = 0; k < n.length; k++) map.push(i)
    normalized += n
    i += ch.length
  }
  const hits = terms.map((t) => normalized.indexOf(t)).filter((i) => i >= 0)
  const at = hits.length ? map[Math.min(...hits)]! : 0
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(text.length, at + SNIPPET_RADIUS * 2)
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`
}

const resultSelect = {
  id: true,
  title: true,
  workspaceId: true,
  folderId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  contentText: true,
  titleSearch: true,
  contentSearch: true,
} as const

/**
 * Busca notas cuyo título o contenido contengan TODAS las palabras de la consulta
 * (sin distinguir mayúsculas ni tildes). Primero las que coinciden en el título,
 * después por número de apariciones y, a igualdad, las más recientes.
 */
export async function searchDocuments(
  actor: AuthUser,
  query: string,
  options: { limit?: number; workspaceId?: string } = {},
): Promise<SearchResult[]> {
  requireActor(actor)
  const terms = [...new Set(normalizeForSearch(query).split(/\s+/).filter(Boolean))].slice(0, 10)
  if (!terms.length) return []
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100)

  const where: Prisma.DocumentWhereInput = {
    AND: [
      await readableDocumentsWhere(actor),
      ...(options.workspaceId ? [{ workspaceId: options.workspaceId }] : []),
      ...terms.map((t) => ({ OR: [{ titleSearch: { contains: t } }, { contentSearch: { contains: t } }] })),
    ],
  }
  const rows = await getPrisma().document.findMany({
    where,
    select: resultSelect,
    orderBy: { updatedAt: 'desc' },
    take: 500,
  })

  const count = (haystack: string, needle: string) => haystack.split(needle).length - 1
  return rows
    .map((r) => {
      const titleMatch = terms.every((t) => r.titleSearch.includes(t))
      const score = (titleMatch ? 1000 : 0) + terms.reduce((s, t) => s + count(r.titleSearch, t) * 10 + count(r.contentSearch, t), 0)
      return { r, titleMatch, score }
    })
    .sort((a, b) => b.score - a.score || b.r.updatedAt.getTime() - a.r.updatedAt.getTime())
    .slice(0, limit)
    .map(({ r, titleMatch }) => ({
      id: r.id,
      title: r.title,
      workspaceId: r.workspaceId,
      folderId: r.folderId,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      createdBy: r.createdBy,
      titleMatch,
      snippet: makeSnippet(r.contentText, terms),
    }))
}

/**
 * Rellena el índice de búsqueda de las notas que no lo tienen (las creadas antes
 * de que existiera la búsqueda). Se llama al arrancar el servidor de colaboración.
 */
export async function reindexMissingDocuments(): Promise<number> {
  const prisma = getPrisma()
  let done = 0
  // Títulos sin normalizar.
  const titles = await prisma.document.findMany({ where: { titleSearch: '' }, select: { id: true, title: true } })
  for (const d of titles) {
    await prisma.document.update({ where: { id: d.id }, data: { titleSearch: normalizeForSearch(d.title) } })
  }
  // Contenido sin indexar.
  for (;;) {
    const batch = await prisma.document.findMany({
      where: { contentText: '', yjsState: { not: null } },
      select: { id: true, yjsState: true },
      take: 50,
    })
    for (const d of batch) {
      const index = contentIndex(new Uint8Array(d.yjsState!))
      // Una nota sin texto se marca con un espacio para no volver a procesarla.
      await prisma.document.update({ where: { id: d.id }, data: { ...index, contentText: index.contentText || ' ' } })
      done++
    }
    if (batch.length < 50) break
  }
  return done + titles.length
}
