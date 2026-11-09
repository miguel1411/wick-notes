import { getPrisma, Prisma } from '@wick/db'
import { requireActor, type AuthUser } from './auth/actor'
import { NotFoundError } from './errors'
import {
  createDocumentInput,
  DEFAULT_TITLE,
  documentIdSchema,
  renameDocumentInput,
  type CreateDocumentInput,
  type RenameDocumentInput,
} from './schemas'
import { parse } from './validation'

// Permisos: por ahora cualquier usuario con sesión ve y edita todas las notas.
// Cada operación recibe `actor` para que, cuando lleguen los espacios de trabajo,
// las reglas se añadan aquí y valgan igual para web, CLI y MCP.

/** Metadatos de un documento, sin el estado Yjs (que puede ser grande). */
export interface DocumentSummary {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
  createdBy: { id: string; name: string } | null
}

const summarySelect = {
  id: true,
  title: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
} as const

function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
}

export async function listDocuments(actor: AuthUser): Promise<DocumentSummary[]> {
  requireActor(actor)
  return getPrisma().document.findMany({ select: summarySelect, orderBy: { updatedAt: 'desc' } })
}

/**
 * Crea una nota. `initialState` es el estado Yjs inicial (por ejemplo, de un
 * Markdown importado); sin él, la nota empieza vacía.
 */
export async function createDocument(
  actor: AuthUser,
  input: CreateDocumentInput = {},
  initialState?: Uint8Array,
): Promise<DocumentSummary> {
  requireActor(actor)
  const data = parse(createDocumentInput, input)
  return getPrisma().document.create({
    data: {
      title: data.title ?? DEFAULT_TITLE,
      createdById: actor.id,
      ...(initialState ? { yjsState: new Uint8Array(initialState) } : {}),
    },
    select: summarySelect,
  })
}

export async function getDocument(actor: AuthUser, id: string): Promise<DocumentSummary> {
  requireActor(actor)
  const doc = await getPrisma().document.findUnique({
    where: { id: parse(documentIdSchema, id) },
    select: summarySelect,
  })
  if (!doc) throw new NotFoundError('Documento')
  return doc
}

/** ¿Existe el documento y puede abrirlo este usuario? */
export async function canAccessDocument(actor: AuthUser, id: string): Promise<boolean> {
  requireActor(actor)
  const parsed = documentIdSchema.safeParse(id)
  if (!parsed.success) return false
  return (await getPrisma().document.count({ where: { id: parsed.data } })) > 0
}

export async function renameDocument(
  actor: AuthUser,
  id: string,
  input: RenameDocumentInput,
): Promise<DocumentSummary> {
  requireActor(actor)
  const data = parse(renameDocumentInput, input)
  try {
    return await getPrisma().document.update({
      where: { id: parse(documentIdSchema, id) },
      data: { title: data.title },
      select: summarySelect,
    })
  } catch (err) {
    if (isNotFound(err)) throw new NotFoundError('Documento')
    throw err
  }
}

export async function deleteDocument(actor: AuthUser, id: string): Promise<void> {
  requireActor(actor)
  try {
    await getPrisma().document.delete({ where: { id: parse(documentIdSchema, id) } })
  } catch (err) {
    if (isNotFound(err)) throw new NotFoundError('Documento')
    throw err
  }
}

/**
 * Estado Yjs guardado, o null si el documento aún no tiene contenido.
 * Sin `actor`: lo usa el servidor de colaboración tras autorizar la conexión.
 */
export async function loadYjsState(id: string): Promise<Uint8Array | null> {
  const doc = await getPrisma().document.findUnique({
    where: { id: parse(documentIdSchema, id) },
    select: { yjsState: true },
  })
  if (!doc) throw new NotFoundError('Documento')
  return doc.yjsState ? new Uint8Array(doc.yjsState) : null
}

/** Guarda el estado Yjs. Igual que loadYjsState, la autorización es de la conexión. */
export async function saveYjsState(id: string, state: Uint8Array): Promise<void> {
  try {
    await getPrisma().document.update({
      where: { id: parse(documentIdSchema, id) },
      data: { yjsState: new Uint8Array(state) },
    })
  } catch (err) {
    if (isNotFound(err)) throw new NotFoundError('Documento')
    throw err
  }
}
