import { getPrisma } from '@wick/db'
import { requireActor, type AuthUser } from './auth/actor'
import { updateDocument } from './documents'
import { ConflictError, NotFoundError, ValidationError, WickError } from './errors'
import {
  assertFolderInWorkspace,
  listWorkspaces,
  requireDocumentAccess,
  requireWorkspaceAccess,
  type WorkspaceRole,
} from './workspaces'

// ------------------------------------------------------------------ árbol

export interface TreeNote {
  id: string
  title: string
  updatedAt: Date
}

export interface TreeFolderNode {
  id: string
  name: string
  folders: TreeFolderNode[]
  notes: TreeNote[]
}

export interface WorkspaceTree {
  id: string
  name: string
  role: WorkspaceRole
  everyone: boolean
  folders: TreeFolderNode[]
  notes: TreeNote[]
}

const byName = (a: string, b: string) => a.localeCompare(b, 'es', { sensitivity: 'base' })

/** Árbol completo (carpetas anidadas y notas) de los espacios que el usuario puede leer. */
export async function getWorkspaceTrees(actor: AuthUser, workspaceId?: string): Promise<WorkspaceTree[]> {
  requireActor(actor)
  if (workspaceId) await requireWorkspaceAccess(actor, workspaceId, 'read')
  const workspaces = (await listWorkspaces(actor)).filter((w) => !workspaceId || w.id === workspaceId)
  const ids = workspaces.map((w) => w.id)
  const prisma = getPrisma()
  const [folders, docs] = await Promise.all([
    prisma.folder.findMany({ where: { workspaceId: { in: ids } }, select: { id: true, name: true, parentId: true, workspaceId: true } }),
    prisma.document.findMany({
      where: { workspaceId: { in: ids } },
      select: { id: true, title: true, folderId: true, workspaceId: true, updatedAt: true },
    }),
  ])

  return workspaces.map((ws) => {
    const build = (parentId: string | null): TreeFolderNode[] =>
      folders
        .filter((f) => f.workspaceId === ws.id && f.parentId === parentId)
        .sort((a, b) => byName(a.name, b.name))
        .map((f) => ({ id: f.id, name: f.name, folders: build(f.id), notes: notesIn(f.id) }))
    const notesIn = (folderId: string | null): TreeNote[] =>
      docs
        .filter((d) => d.workspaceId === ws.id && d.folderId === folderId)
        .sort((a, b) => byName(a.title, b.title))
        .map((d) => ({ id: d.id, title: d.title, updatedAt: d.updatedAt }))
    return { id: ws.id, name: ws.name, role: ws.role, everyone: ws.everyone, folders: build(null), notes: notesIn(null) }
  })
}

/** Ruta legible de cada carpeta de los espacios dados: id → «Infra / Servidores». */
async function folderPaths(workspaceIds: string[]): Promise<Map<string, string>> {
  const folders = await getPrisma().folder.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { id: true, name: true, parentId: true },
  })
  const byId = new Map(folders.map((f) => [f.id, f]))
  const paths = new Map<string, string>()
  const pathOf = (id: string, seen = new Set<string>()): string => {
    if (paths.has(id)) return paths.get(id)!
    const f = byId.get(id)
    if (!f) return ''
    const parent = f.parentId && !seen.has(f.parentId) ? pathOf(f.parentId, seen.add(id)) : ''
    const path = parent ? `${parent} / ${f.name}` : f.name
    paths.set(id, path)
    return path
  }
  for (const f of folders) pathOf(f.id)
  return paths
}

/**
 * Carpeta de un espacio por id o por ruta («Infra/Servidores», sin distinguir
 * mayúsculas). Pensado para agentes, que no conocen los ids.
 */
export async function resolveFolder(actor: AuthUser, workspaceId: string, ref: string): Promise<string> {
  await requireWorkspaceAccess(actor, workspaceId, 'read')
  const folders = await getPrisma().folder.findMany({
    where: { workspaceId },
    select: { id: true, name: true, parentId: true },
  })
  if (folders.some((f) => f.id === ref)) return ref

  const parts = ref
    .split('/')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  if (!parts.length) throw new ValidationError('Indica una carpeta')
  let candidates = folders.filter((f) => f.name.toLowerCase() === parts[0] && (parts.length > 1 ? !f.parentId : true))
  for (const part of parts.slice(1)) {
    const parents = new Set(candidates.map((c) => c.id))
    candidates = folders.filter((f) => f.parentId && parents.has(f.parentId) && f.name.toLowerCase() === part)
  }
  if (candidates.length === 1) return candidates[0]!.id
  const paths = await folderPaths([workspaceId])
  if (!candidates.length) {
    const all = [...paths.values()].sort(byName)
    throw new ValidationError(`No hay ninguna carpeta «${ref}» en ese espacio.${all.length ? ` Carpetas: ${all.join(', ')}` : ' No tiene carpetas.'}`)
  }
  throw new ValidationError(
    `«${ref}» coincide con varias carpetas; indica la ruta completa: ${candidates.map((c) => paths.get(c.id)).join(', ')}`,
  )
}

// ------------------------------------------------------------------ solicitudes de movimiento

export type MoveRequestStatus = 'pending' | 'approved' | 'rejected' | 'failed' | 'superseded'
const fromDb = { PENDING: 'pending', APPROVED: 'approved', REJECTED: 'rejected', FAILED: 'failed', SUPERSEDED: 'superseded' } as const
const toDb = { pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED', failed: 'FAILED', superseded: 'SUPERSEDED' } as const

interface Place {
  workspaceId: string
  workspaceName: string
  folderId: string | null
  /** «Espacio / Carpeta / Subcarpeta». */
  path: string
}

export interface MoveRequestSummary {
  id: string
  status: MoveRequestStatus
  reason: string | null
  createdAt: Date
  decidedAt: Date | null
  error: string | null
  document: { id: string; title: string }
  /** Dónde está ahora la nota. */
  from: Place
  /** Adónde se propone moverla. */
  to: Place
  /** Nombre del token (el agente) con el que se pidió. */
  agent: string | null
  decidedBy: { id: string; name: string } | null
}

const requestSelect = {
  id: true,
  status: true,
  reason: true,
  createdAt: true,
  decidedAt: true,
  error: true,
  targetWorkspaceId: true,
  targetFolderId: true,
  document: { select: { id: true, title: true, workspaceId: true, folderId: true } },
  token: { select: { name: true } },
  decidedBy: { select: { id: true, name: true } },
} as const

type RequestRow = {
  id: string
  status: keyof typeof fromDb
  reason: string | null
  createdAt: Date
  decidedAt: Date | null
  error: string | null
  targetWorkspaceId: string
  targetFolderId: string | null
  document: { id: string; title: string; workspaceId: string; folderId: string | null }
  token: { name: string } | null
  decidedBy: { id: string; name: string } | null
}

async function summarize(rows: RequestRow[]): Promise<MoveRequestSummary[]> {
  const wsIds = [...new Set(rows.flatMap((r) => [r.targetWorkspaceId, r.document.workspaceId]))]
  const [workspaces, paths] = await Promise.all([
    getPrisma().workspace.findMany({ where: { id: { in: wsIds } }, select: { id: true, name: true } }),
    folderPaths(wsIds),
  ])
  const wsName = new Map(workspaces.map((w) => [w.id, w.name]))
  const place = (workspaceId: string, folderId: string | null): Place => {
    const name = wsName.get(workspaceId) ?? workspaceId
    const folder = folderId ? paths.get(folderId) : undefined
    return { workspaceId, workspaceName: name, folderId, path: folder ? `${name} / ${folder}` : name }
  }
  return rows.map((r) => ({
    id: r.id,
    status: fromDb[r.status],
    reason: r.reason,
    createdAt: r.createdAt,
    decidedAt: r.decidedAt,
    error: r.error,
    document: { id: r.document.id, title: r.document.title },
    from: place(r.document.workspaceId, r.document.folderId),
    to: place(r.targetWorkspaceId, r.targetFolderId),
    agent: r.token?.name ?? null,
    decidedBy: r.decidedBy,
  }))
}

/**
 * Propone mover una nota (no la mueve). Exige que el usuario pudiera moverla él
 * mismo; una solicitud pendiente anterior para la misma nota queda sustituida.
 */
export async function requestMove(
  actor: AuthUser,
  input: { documentId: string; workspaceId?: string; folderId: string | null; reason?: string },
  context: { tokenId?: string } = {},
): Promise<MoveRequestSummary> {
  const current = await requireDocumentAccess(actor, input.documentId, 'write')
  const workspaceId = input.workspaceId ?? current.workspaceId
  await requireWorkspaceAccess(actor, workspaceId, 'write')
  await assertFolderInWorkspace(input.folderId, workspaceId)
  if (workspaceId === current.workspaceId && (input.folderId ?? null) === current.folderId) {
    throw new ValidationError('La nota ya está en ese sitio')
  }
  const reason = input.reason?.trim().slice(0, 500) || null

  const prisma = getPrisma()
  const row = await prisma.$transaction(async (tx) => {
    await tx.moveRequest.updateMany({
      where: { documentId: input.documentId, requestedById: actor.id, status: 'PENDING' },
      data: { status: 'SUPERSEDED', decidedAt: new Date() },
    })
    return tx.moveRequest.create({
      data: {
        documentId: input.documentId,
        requestedById: actor.id,
        tokenId: context.tokenId ?? null,
        targetWorkspaceId: workspaceId,
        targetFolderId: input.folderId ?? null,
        reason,
      },
      select: requestSelect,
    })
  })
  return (await summarize([row]))[0]!
}

/** Solicitudes del propio usuario (las de sus agentes), las más recientes primero. */
export async function listMoveRequests(
  actor: AuthUser,
  options: { status?: MoveRequestStatus; limit?: number } = {},
): Promise<MoveRequestSummary[]> {
  requireActor(actor)
  const rows = await getPrisma().moveRequest.findMany({
    where: { requestedById: actor.id, ...(options.status ? { status: toDb[options.status] } : {}) },
    select: requestSelect,
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(options.limit ?? 50, 1), 200),
  })
  return summarize(rows)
}

export async function countPendingMoveRequests(actor: AuthUser): Promise<number> {
  requireActor(actor)
  return getPrisma().moveRequest.count({ where: { requestedById: actor.id, status: 'PENDING' } })
}

/**
 * Aprueba o rechaza una solicitud propia. Al aprobar, se mueve con los permisos de
 * quien aprueba, comprobados de nuevo en ese momento; si ya no se puede, queda
 * como «failed» con el motivo. Solo debe llamarse desde una sesión de navegador
 * (nunca con un token: un agente no puede aprobar sus propias solicitudes).
 */
export async function decideMoveRequest(
  actor: AuthUser,
  id: string,
  decision: 'approve' | 'reject',
): Promise<MoveRequestSummary> {
  requireActor(actor)
  const prisma = getPrisma()
  const req = await prisma.moveRequest.findFirst({ where: { id, requestedById: actor.id }, select: requestSelect })
  if (!req) throw new NotFoundError('Solicitud')
  if (req.status !== 'PENDING') throw new ConflictError('Esta solicitud ya se resolvió')

  let status: 'APPROVED' | 'REJECTED' | 'FAILED' = decision === 'approve' ? 'APPROVED' : 'REJECTED'
  let error: string | null = null
  if (decision === 'approve') {
    try {
      await updateDocument(actor, req.document.id, { workspaceId: req.targetWorkspaceId, folderId: req.targetFolderId })
    } catch (err) {
      if (!(err instanceof WickError)) throw err
      status = 'FAILED'
      error = err.message
    }
  }
  const row = await prisma.moveRequest.update({
    where: { id },
    data: { status, error, decidedAt: new Date(), decidedById: actor.id },
    select: requestSelect,
  })
  return (await summarize([row]))[0]!
}
