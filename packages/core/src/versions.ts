import { getPrisma } from '@wick/db'
import { requireActor, type AuthUser } from './auth/actor'
import { NotFoundError } from './errors'
import { extractPlainText } from './search'

/** Mientras se edita, como mucho una versión automática cada 10 minutos. */
export const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000
/** Versiones que se conservan por nota (las más recientes). */
export const MAX_VERSIONS_PER_DOCUMENT = 100

export type VersionReason = 'auto' | 'manual' | 'before_replace' | 'before_restore'

const toDb = { auto: 'AUTO', manual: 'MANUAL', before_replace: 'BEFORE_REPLACE', before_restore: 'BEFORE_RESTORE' } as const
const fromDb = { AUTO: 'auto', MANUAL: 'manual', BEFORE_REPLACE: 'before_replace', BEFORE_RESTORE: 'before_restore' } as const

export interface VersionSummary {
  id: string
  documentId: string
  createdAt: Date
  /** Título de la nota en ese momento. */
  title: string
  reason: VersionReason
  /**
   * auto: quien hizo los últimos cambios · manual: quien la guardó ·
   * before_replace: quien iba a reemplazar el contenido · before_restore: quien restauró.
   */
  author: { id: string; name: string } | null
  /** Principio del texto, para reconocerla. */
  preview: string
}

const summarySelect = {
  id: true,
  documentId: true,
  createdAt: true,
  title: true,
  reason: true,
  contentText: true,
  author: { select: { id: true, name: true } },
} as const

type Row = { id: string; documentId: string; createdAt: Date; title: string; reason: keyof typeof fromDb; contentText: string; author: { id: string; name: string } | null }

function toSummary(row: Row): VersionSummary {
  const flat = row.contentText.replace(/\s+/g, ' ').trim()
  return {
    id: row.id,
    documentId: row.documentId,
    createdAt: row.createdAt,
    title: row.title,
    reason: fromDb[row.reason],
    author: row.author,
    preview: flat.length > 160 ? `${flat.slice(0, 159)}…` : flat,
  }
}

/**
 * Guarda una instantánea (uso interno: servidor de colaboración). No comprueba
 * permisos: quien llama ya autorizó la operación.
 */
export async function createVersion(
  documentId: string,
  state: Uint8Array,
  options: { reason: VersionReason; authorId?: string | null },
): Promise<VersionSummary> {
  const prisma = getPrisma()
  const doc = await prisma.document.findUnique({ where: { id: documentId }, select: { title: true } })
  if (!doc) throw new NotFoundError('Documento')
  const row = await prisma.documentVersion.create({
    data: {
      documentId,
      title: doc.title,
      yjsState: new Uint8Array(state),
      contentText: safeText(state),
      reason: toDb[options.reason],
      authorId: options.authorId ?? null,
    },
    select: summarySelect,
  })
  await pruneVersions(documentId)
  return toSummary(row)
}

/**
 * Versión automática al guardar: solo si pasó el intervalo desde la última y el
 * contenido cambió. Devuelve null si no hacía falta.
 */
export async function maybeCreateAutoVersion(
  documentId: string,
  state: Uint8Array,
  authorId: string | null | undefined,
  now = Date.now(),
): Promise<VersionSummary | null> {
  const prisma = getPrisma()
  const last = await prisma.documentVersion.findFirst({
    where: { documentId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, contentText: true },
  })
  if (last && now - last.createdAt.getTime() < AUTO_VERSION_INTERVAL_MS) return null
  const text = safeText(state)
  if (last ? last.contentText === text : text.trim() === '') return null
  return createVersion(documentId, state, { reason: 'auto', authorId })
}

/**
 * Instantánea de protección antes de una operación que reemplaza el contenido.
 * Si la última versión ya tiene este mismo contenido, no se duplica.
 */
export async function protectBeforeChange(
  documentId: string,
  state: Uint8Array,
  reason: 'before_replace' | 'before_restore',
  authorId: string,
): Promise<VersionSummary | null> {
  const last = await getPrisma().documentVersion.findFirst({
    where: { documentId },
    orderBy: { createdAt: 'desc' },
    select: { contentText: true },
  })
  const text = safeText(state)
  if (last?.contentText === text || (!last && text.trim() === '')) return null
  return createVersion(documentId, state, { reason, authorId })
}

export async function listVersions(actor: AuthUser, documentId: string): Promise<VersionSummary[]> {
  requireActor(actor)
  const prisma = getPrisma()
  if ((await prisma.document.count({ where: { id: documentId } })) === 0) throw new NotFoundError('Documento')
  const rows = await prisma.documentVersion.findMany({
    where: { documentId },
    orderBy: { createdAt: 'desc' },
    select: summarySelect,
  })
  return rows.map(toSummary)
}

/** Estado completo de una versión (uso interno). Comprueba que es de esa nota. */
export async function getVersionState(documentId: string, versionId: string): Promise<{ state: Uint8Array; title: string }> {
  const row = await getPrisma().documentVersion.findFirst({
    where: { id: versionId, documentId },
    select: { yjsState: true, title: true },
  })
  if (!row) throw new NotFoundError('Versión')
  return { state: new Uint8Array(row.yjsState), title: row.title }
}

async function pruneVersions(documentId: string) {
  const prisma = getPrisma()
  const old = await prisma.documentVersion.findMany({
    where: { documentId },
    orderBy: { createdAt: 'desc' },
    skip: MAX_VERSIONS_PER_DOCUMENT,
    select: { id: true },
  })
  if (old.length) await prisma.documentVersion.deleteMany({ where: { id: { in: old.map((v) => v.id) } } })
}

function safeText(state: Uint8Array): string {
  try {
    return extractPlainText(state)
  } catch {
    return ''
  }
}
