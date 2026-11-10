import { getPrisma, type Prisma } from '@wick/db'
import { z } from 'zod'
import { requireActor, type AuthUser } from './auth/actor'
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors'
import { parse } from './validation'

/**
 * Permisos de wick notes, en un solo sitio.
 *
 * Rol efectivo de un usuario en un espacio:
 *  - administrador de la instancia → owner en todos;
 *  - miembro → su rol (owner, editor, viewer);
 *  - espacio «para todos» (everyone) → al menos editor;
 *  - si no, ninguno: el espacio y sus notas no existen para él.
 * Una nota hereda los permisos de su espacio.
 */
export type WorkspaceRole = 'owner' | 'editor' | 'viewer'
export type Access = 'read' | 'write' | 'manage'

const RANK: Record<WorkspaceRole, number> = { viewer: 1, editor: 2, owner: 3 }
const NEEDS: Record<Access, number> = { read: 1, write: 2, manage: 3 }
const fromDb = { OWNER: 'owner', EDITOR: 'editor', VIEWER: 'viewer' } as const
const toDb = { owner: 'OWNER', editor: 'EDITOR', viewer: 'VIEWER' } as const

export const roleAllows = (role: WorkspaceRole | null, access: Access) => !!role && RANK[role] >= NEEDS[access]

function effectiveRole(actor: AuthUser, ws: { everyone: boolean; members: { role: keyof typeof fromDb }[] }): WorkspaceRole | null {
  if (actor.role === 'ADMIN') return 'owner'
  let role: WorkspaceRole | null = ws.everyone ? 'editor' : null
  for (const m of ws.members) {
    const r = fromDb[m.role]
    if (!role || RANK[r] > RANK[role]) role = r
  }
  return role
}

const membersOf = (actor: AuthUser) => ({ where: { userId: actor.id }, select: { role: true } }) as const

/** Rol de un usuario en un espacio (null si no tiene acceso o no existe). */
export async function getWorkspaceRole(actor: AuthUser, workspaceId: string): Promise<WorkspaceRole | null> {
  requireActor(actor)
  const ws = await getPrisma().workspace.findUnique({
    where: { id: workspaceId },
    select: { everyone: true, members: membersOf(actor) },
  })
  return ws ? effectiveRole(actor, ws) : null
}

/** Comprueba el acceso a un espacio. Sin lectura, el espacio «no existe» (404). */
export async function requireWorkspaceAccess(actor: AuthUser, workspaceId: string, access: Access): Promise<WorkspaceRole> {
  const role = await getWorkspaceRole(actor, workspaceId)
  if (!roleAllows(role, 'read')) throw new NotFoundError('Espacio de trabajo')
  if (!roleAllows(role, access)) {
    throw new ForbiddenError(access === 'manage' ? 'Solo quien gestiona este espacio puede hacer esto' : 'En este espacio solo tienes permiso de lectura')
  }
  return role!
}

/** Ids de los espacios que el usuario puede leer (null = todos, para administradores). */
export async function readableWorkspaceIds(actor: AuthUser): Promise<string[] | null> {
  requireActor(actor)
  if (actor.role === 'ADMIN') return null
  const rows = await getPrisma().workspace.findMany({
    where: { OR: [{ everyone: true }, { members: { some: { userId: actor.id } } }] },
    select: { id: true },
  })
  return rows.map((r) => r.id)
}

/** Condición de Prisma: notas en espacios que el usuario puede leer. */
export async function readableDocumentsWhere(actor: AuthUser): Promise<Prisma.DocumentWhereInput> {
  const ids = await readableWorkspaceIds(actor)
  return ids === null ? {} : { workspaceId: { in: ids } }
}

/**
 * Comprueba el acceso a una nota. Si no puede leerla, responde como si no
 * existiera (no revela que existe). Devuelve su espacio, carpeta y el rol.
 */
export async function requireDocumentAccess(
  actor: AuthUser,
  documentId: string,
  access: Access,
): Promise<{ workspaceId: string; folderId: string | null; role: WorkspaceRole }> {
  requireActor(actor)
  const doc = await getPrisma().document.findUnique({
    where: { id: documentId },
    select: { workspaceId: true, folderId: true, workspace: { select: { everyone: true, members: membersOf(actor) } } },
  })
  const role = doc ? effectiveRole(actor, doc.workspace) : null
  if (!doc || !roleAllows(role, 'read')) throw new NotFoundError('Documento')
  if (!roleAllows(role, access)) throw new ForbiddenError('En este espacio solo tienes permiso de lectura')
  return { workspaceId: doc.workspaceId, folderId: doc.folderId, role: role! }
}

// ------------------------------------------------------------------ espacios

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(1, 'Ponle un nombre al espacio')
  .max(80, 'El nombre no puede superar 80 caracteres')

export const createWorkspaceInput = z.object({ name: workspaceNameSchema, everyone: z.boolean().default(false) })
export const updateWorkspaceInput = z
  .object({ name: workspaceNameSchema.optional(), everyone: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'No hay nada que cambiar')
export type CreateWorkspaceInput = z.input<typeof createWorkspaceInput>
export type UpdateWorkspaceInput = z.input<typeof updateWorkspaceInput>

export interface WorkspaceSummary {
  id: string
  name: string
  everyone: boolean
  role: WorkspaceRole
  documentCount: number
  createdAt: Date
}

/** Espacios que el usuario puede ver, el más antiguo primero (General suele ser el primero). */
export async function listWorkspaces(actor: AuthUser): Promise<WorkspaceSummary[]> {
  requireActor(actor)
  const rows = await getPrisma().workspace.findMany({
    where: actor.role === 'ADMIN' ? {} : { OR: [{ everyone: true }, { members: { some: { userId: actor.id } } }] },
    select: {
      id: true,
      name: true,
      everyone: true,
      createdAt: true,
      members: membersOf(actor),
      _count: { select: { documents: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((w) => ({
    id: w.id,
    name: w.name,
    everyone: w.everyone,
    createdAt: w.createdAt,
    role: effectiveRole(actor, w)!,
    documentCount: w._count.documents,
  }))
}

/** Espacio donde se crean las notas si no se indica otro: el primero en el que puede escribir. */
export async function defaultWorkspaceId(actor: AuthUser): Promise<string> {
  const writable = (await listWorkspaces(actor)).find((w) => roleAllows(w.role, 'write'))
  if (!writable) throw new ForbiddenError('No tienes ningún espacio de trabajo en el que puedas escribir')
  return writable.id
}

/** Cualquier usuario puede crear un espacio; queda como propietario. */
export async function createWorkspace(actor: AuthUser, input: CreateWorkspaceInput): Promise<WorkspaceSummary> {
  requireActor(actor)
  const data = parse(createWorkspaceInput, input)
  const ws = await getPrisma().workspace.create({
    data: { name: data.name, everyone: data.everyone, createdById: actor.id, members: { create: { userId: actor.id, role: 'OWNER' } } },
  })
  return { id: ws.id, name: ws.name, everyone: ws.everyone, createdAt: ws.createdAt, role: 'owner', documentCount: 0 }
}

export async function updateWorkspace(actor: AuthUser, id: string, input: UpdateWorkspaceInput): Promise<WorkspaceSummary> {
  const role = await requireWorkspaceAccess(actor, id, 'manage')
  const data = parse(updateWorkspaceInput, input)
  const ws = await getPrisma().workspace.update({
    where: { id },
    data,
    select: { id: true, name: true, everyone: true, createdAt: true, _count: { select: { documents: true } } },
  })
  return { id: ws.id, name: ws.name, everyone: ws.everyone, createdAt: ws.createdAt, role, documentCount: ws._count.documents }
}

/** Solo se borran espacios vacíos: las notas hay que moverlas o borrarlas antes. */
export async function deleteWorkspace(actor: AuthUser, id: string): Promise<void> {
  await requireWorkspaceAccess(actor, id, 'manage')
  const prisma = getPrisma()
  const docs = await prisma.document.count({ where: { workspaceId: id } })
  if (docs > 0) throw new ConflictError(`El espacio tiene ${docs} ${docs === 1 ? 'nota' : 'notas'}; muévelas o bórralas antes`)
  if ((await prisma.workspace.count()) <= 1) throw new ConflictError('No se puede borrar el único espacio de trabajo')
  await prisma.workspace.delete({ where: { id } })
}

// ------------------------------------------------------------------ miembros

export interface WorkspaceMemberSummary {
  user: { id: string; username: string; name: string; disabled: boolean }
  role: WorkspaceRole
}

export async function listWorkspaceMembers(actor: AuthUser, workspaceId: string): Promise<WorkspaceMemberSummary[]> {
  await requireWorkspaceAccess(actor, workspaceId, 'read')
  const rows = await getPrisma().workspaceMember.findMany({
    where: { workspaceId },
    select: { role: true, user: { select: { id: true, username: true, name: true, disabledAt: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map((m) => ({
    role: fromDb[m.role],
    user: { id: m.user.id, username: m.user.username, name: m.user.name, disabled: !!m.user.disabledAt },
  }))
}

const memberRoleSchema = z.enum(['owner', 'editor', 'viewer'])

async function assertKeepsAnOwner(workspaceId: string, changingUserId: string) {
  const owners = await getPrisma().workspaceMember.count({
    where: { workspaceId, role: 'OWNER', userId: { not: changingUserId } },
  })
  if (owners === 0) throw new ConflictError('El espacio tiene que conservar al menos un propietario')
}

/** Añade un miembro o cambia su rol. */
export async function setWorkspaceMember(
  actor: AuthUser,
  workspaceId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<WorkspaceMemberSummary> {
  await requireWorkspaceAccess(actor, workspaceId, 'manage')
  const r = parse(memberRoleSchema, role)
  const prisma = getPrisma()
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, username: true, name: true, disabledAt: true } })
  if (!user) throw new NotFoundError('Usuario')
  const existing = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } })
  if (existing?.role === 'OWNER' && r !== 'owner') await assertKeepsAnOwner(workspaceId, userId)
  await prisma.workspaceMember.upsert({
    where: { workspaceId_userId: { workspaceId, userId } },
    create: { workspaceId, userId, role: toDb[r] },
    update: { role: toDb[r] },
  })
  return { role: r, user: { id: user.id, username: user.username, name: user.name, disabled: !!user.disabledAt } }
}

export async function removeWorkspaceMember(actor: AuthUser, workspaceId: string, userId: string): Promise<void> {
  await requireWorkspaceAccess(actor, workspaceId, 'manage')
  const prisma = getPrisma()
  const existing = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId, userId } } })
  if (!existing) throw new NotFoundError('Miembro')
  if (existing.role === 'OWNER') await assertKeepsAnOwner(workspaceId, userId)
  await prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId, userId } } })
}

// ------------------------------------------------------------------ carpetas

export const folderNameSchema = z
  .string()
  .trim()
  .min(1, 'Ponle un nombre a la carpeta')
  .max(120, 'El nombre no puede superar 120 caracteres')

export interface FolderSummary {
  id: string
  workspaceId: string
  parentId: string | null
  name: string
}

const folderSelect = { id: true, workspaceId: true, parentId: true, name: true } as const

export async function listFolders(actor: AuthUser, workspaceId: string): Promise<FolderSummary[]> {
  await requireWorkspaceAccess(actor, workspaceId, 'read')
  return getPrisma().folder.findMany({ where: { workspaceId }, select: folderSelect, orderBy: { name: 'asc' } })
}

async function requireFolder(actor: AuthUser, folderId: string, access: Access) {
  const folder = await getPrisma().folder.findUnique({ where: { id: folderId }, select: folderSelect })
  if (!folder) throw new NotFoundError('Carpeta')
  await requireWorkspaceAccess(actor, folder.workspaceId, access)
  return folder
}

/** Comprueba que `folderId` (si se indica) es una carpeta del espacio dado. */
export async function assertFolderInWorkspace(folderId: string | null | undefined, workspaceId: string) {
  if (!folderId) return
  const folder = await getPrisma().folder.findUnique({ where: { id: folderId }, select: { workspaceId: true } })
  if (!folder || folder.workspaceId !== workspaceId) throw new ValidationError('La carpeta no pertenece a ese espacio de trabajo')
}

export async function createFolder(
  actor: AuthUser,
  workspaceId: string,
  input: { name: string; parentId?: string | null },
): Promise<FolderSummary> {
  await requireWorkspaceAccess(actor, workspaceId, 'write')
  const name = parse(folderNameSchema, input.name)
  await assertFolderInWorkspace(input.parentId, workspaceId)
  return getPrisma().folder.create({ data: { workspaceId, name, parentId: input.parentId ?? null }, select: folderSelect })
}

export async function renameFolder(actor: AuthUser, folderId: string, name: string): Promise<FolderSummary> {
  await requireFolder(actor, folderId, 'write')
  return getPrisma().folder.update({ where: { id: folderId }, data: { name: parse(folderNameSchema, name) }, select: folderSelect })
}

/** Mueve una carpeta dentro de su espacio (null = a la raíz). Evita ciclos. */
export async function moveFolder(actor: AuthUser, folderId: string, parentId: string | null): Promise<FolderSummary> {
  const folder = await requireFolder(actor, folderId, 'write')
  if (parentId) {
    await assertFolderInWorkspace(parentId, folder.workspaceId)
    // ¿El destino está dentro de la propia carpeta?
    const prisma = getPrisma()
    for (let cursor: string | null = parentId; cursor; ) {
      if (cursor === folderId) throw new ValidationError('No se puede mover una carpeta dentro de sí misma')
      cursor = (await prisma.folder.findUnique({ where: { id: cursor }, select: { parentId: true } }))?.parentId ?? null
    }
  }
  return getPrisma().folder.update({ where: { id: folderId }, data: { parentId }, select: folderSelect })
}

/**
 * Borra una carpeta sin borrar nada de su contenido: sus notas y subcarpetas
 * pasan a la carpeta superior (o a la raíz del espacio).
 */
export async function deleteFolder(actor: AuthUser, folderId: string): Promise<void> {
  const folder = await requireFolder(actor, folderId, 'write')
  await getPrisma().$transaction([
    getPrisma().document.updateMany({ where: { folderId }, data: { folderId: folder.parentId } }),
    getPrisma().folder.updateMany({ where: { parentId: folderId }, data: { parentId: folder.parentId } }),
    getPrisma().folder.delete({ where: { id: folderId } }),
  ])
}
