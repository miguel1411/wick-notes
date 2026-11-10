import { getPrisma, Prisma } from '@wick/db'
import { requireActor, type AuthUser } from './auth/actor'
import { NotFoundError } from './errors'
import {
  createDocumentInput,
  DEFAULT_TITLE,
  documentIdSchema,
  renameDocumentInput,
  updateDocumentInput,
  type CreateDocumentInput,
  type RenameDocumentInput,
  type UpdateDocumentInput,
} from './schemas'
import { contentIndex, normalizeForSearch } from './search'
import { parse } from './validation'
import {
  assertFolderInWorkspace,
  defaultWorkspaceId,
  readableDocumentsWhere,
  requireDocumentAccess,
  requireWorkspaceAccess,
  roleAllows,
  type WorkspaceRole,
} from './workspaces'

// Permisos: cada nota hereda los de su espacio de trabajo (ver workspaces.ts).
// Todas las operaciones reciben `actor`, así valen igual para web, CLI y MCP.

/** Metadatos de un documento, sin el estado Yjs (que puede ser grande). */
export interface DocumentSummary {
  id: string
  title: string
  workspaceId: string
  folderId: string | null
  createdAt: Date
  updatedAt: Date
  createdBy: { id: string; name: string } | null
}

/** Nota con el rol del usuario en su espacio (para saber si puede editarla). */
export interface DocumentDetail extends DocumentSummary {
  role: WorkspaceRole
  canEdit: boolean
}

const summarySelect = {
  id: true,
  title: true,
  workspaceId: true,
  folderId: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
} as const

function isNotFound(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025'
}

export interface ListDocumentsOptions {
  /** Filtra por título (contiene, sin distinguir mayúsculas). */
  query?: string
  /** Solo las notas de este espacio. */
  workspaceId?: string
  limit?: number
}

/** Notas que el usuario puede leer, de la más reciente a la más antigua. */
export async function listDocuments(actor: AuthUser, options: ListDocumentsOptions = {}): Promise<DocumentSummary[]> {
  requireActor(actor)
  if (options.workspaceId) await requireWorkspaceAccess(actor, options.workspaceId, 'read')
  const query = options.query?.trim()
  return getPrisma().document.findMany({
    where: {
      AND: [
        await readableDocumentsWhere(actor),
        options.workspaceId ? { workspaceId: options.workspaceId } : {},
        query ? { title: { contains: query, mode: 'insensitive' } } : {},
      ],
    },
    select: summarySelect,
    orderBy: { updatedAt: 'desc' },
    take: options.limit && options.limit > 0 ? Math.min(options.limit, 1000) : undefined,
  })
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
  const workspaceId = data.workspaceId ?? (await defaultWorkspaceId(actor))
  await requireWorkspaceAccess(actor, workspaceId, 'write')
  await assertFolderInWorkspace(data.folderId, workspaceId)
  const title = data.title ?? DEFAULT_TITLE
  return getPrisma().document.create({
    data: {
      title,
      titleSearch: normalizeForSearch(title),
      workspaceId,
      folderId: data.folderId ?? null,
      createdById: actor.id,
      ...(initialState ? { yjsState: new Uint8Array(initialState), ...contentIndex(initialState) } : {}),
    },
    select: summarySelect,
  })
}

export async function getDocument(actor: AuthUser, id: string): Promise<DocumentDetail> {
  const { role } = await requireDocumentAccess(actor, parse(documentIdSchema, id), 'read')
  const doc = await getPrisma().document.findUnique({ where: { id }, select: summarySelect })
  if (!doc) throw new NotFoundError('Documento')
  return { ...doc, role, canEdit: roleAllows(role, 'write') }
}

/** ¿Existe la nota y puede leerla este usuario? */
export async function canAccessDocument(actor: AuthUser, id: string): Promise<boolean> {
  requireActor(actor)
  if (!documentIdSchema.safeParse(id).success) return false
  try {
    await requireDocumentAccess(actor, id, 'read')
    return true
  } catch {
    return false
  }
}

export async function renameDocument(actor: AuthUser, id: string, input: RenameDocumentInput): Promise<DocumentSummary> {
  return updateDocument(actor, id, parse(renameDocumentInput, input))
}

/** Cambia el título y/o mueve la nota a otro espacio o carpeta. */
export async function updateDocument(actor: AuthUser, id: string, input: UpdateDocumentInput): Promise<DocumentSummary> {
  const data = parse(updateDocumentInput, input)
  const current = await requireDocumentAccess(actor, parse(documentIdSchema, id), 'write')

  const workspaceId = data.workspaceId ?? current.workspaceId
  if (workspaceId !== current.workspaceId) await requireWorkspaceAccess(actor, workspaceId, 'write')
  // Al cambiar de espacio sin indicar carpeta, la nota va a la raíz del nuevo espacio.
  const folderId =
    data.folderId !== undefined ? data.folderId : workspaceId !== current.workspaceId ? null : current.folderId
  await assertFolderInWorkspace(folderId, workspaceId)

  try {
    return await getPrisma().document.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title, titleSearch: normalizeForSearch(data.title) } : {}),
        workspaceId,
        folderId,
      },
      select: summarySelect,
    })
  } catch (err) {
    if (isNotFound(err)) throw new NotFoundError('Documento')
    throw err
  }
}

export async function deleteDocument(actor: AuthUser, id: string): Promise<void> {
  await requireDocumentAccess(actor, parse(documentIdSchema, id), 'write')
  try {
    await getPrisma().document.delete({ where: { id } })
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

/**
 * Guarda el estado Yjs y actualiza el índice de búsqueda del contenido.
 * Igual que loadYjsState, la autorización es de la conexión.
 */
export async function saveYjsState(id: string, state: Uint8Array): Promise<void> {
  try {
    await getPrisma().document.update({
      where: { id: parse(documentIdSchema, id) },
      data: { yjsState: new Uint8Array(state), ...contentIndex(state) },
    })
  } catch (err) {
    if (isNotFound(err)) throw new NotFoundError('Documento')
    throw err
  }
}
