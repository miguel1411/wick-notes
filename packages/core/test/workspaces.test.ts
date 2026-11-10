import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectPrisma, getPrisma } from '@wick/db'
import {
  canAccessDocument,
  ConflictError,
  createDocument,
  createFolder,
  createVersion,
  createWorkspace,
  defaultWorkspaceId,
  deleteDocument,
  deleteFolder,
  deleteWorkspace,
  ForbiddenError,
  getDocument,
  listDocuments,
  listFolders,
  listVersions,
  listWorkspaceMembers,
  listWorkspaces,
  moveFolder,
  NotFoundError,
  removeWorkspaceMember,
  renameDocument,
  searchDocuments,
  setWorkspaceMember,
  updateDocument,
  updateWorkspace,
  ValidationError,
  type AuthUser,
} from '../src'
import { makeUser, resetDatabase } from './helpers'

let admin: AuthUser
let ana: AuthUser
let bruno: AuthUser
let carla: AuthUser

beforeEach(async () => {
  await resetDatabase()
  admin = await makeUser('ADMIN')
  ana = await makeUser()
  bruno = await makeUser()
  carla = await makeUser()
})
afterAll(async () => {
  await disconnectPrisma()
})

describe('espacio General (para todos)', () => {
  it('todos son editores y las notas nuevas van ahí por defecto', async () => {
    expect(await defaultWorkspaceId(ana)).toBe('general')
    const doc = await createDocument(ana, { title: 'Compartida' })
    expect(doc.workspaceId).toBe('general')
    const late = await makeUser()
    expect((await listDocuments(late)).map((d) => d.id)).toEqual([doc.id])
    expect((await getDocument(late, doc.id)).canEdit).toBe(true)
    expect((await listWorkspaces(late))[0]).toMatchObject({ id: 'general', role: 'editor', everyone: true })
  })
})

describe('espacios privados', () => {
  it('son invisibles para quien no es miembro: lista, búsqueda, nota e historial', async () => {
    const ws = await createWorkspace(ana, { name: 'Personal de Ana' })
    expect(ws.role).toBe('owner')
    const secret = await createDocument(ana, { title: 'Diario secreto', workspaceId: ws.id })
    await createVersion(secret.id, new Uint8Array([0, 0]), { reason: 'manual' })

    expect((await listWorkspaces(bruno)).map((w) => w.id)).toEqual(['general'])
    expect(await listDocuments(bruno)).toEqual([])
    expect(await searchDocuments(bruno, 'secreto')).toEqual([])
    expect(await canAccessDocument(bruno, secret.id)).toBe(false)
    await expect(getDocument(bruno, secret.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(listVersions(bruno, secret.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(renameDocument(bruno, secret.id, { title: 'x' })).rejects.toBeInstanceOf(NotFoundError)
    await expect(listDocuments(bruno, { workspaceId: ws.id })).rejects.toBeInstanceOf(NotFoundError)

    // Los administradores de la instancia ven todo.
    expect((await listDocuments(admin)).map((d) => d.id)).toContain(secret.id)
    expect((await searchDocuments(admin, 'secreto')).map((d) => d.id)).toEqual([secret.id])
  })

  it('lectores leen pero no escriben; editores escriben pero no gestionan', async () => {
    const ws = await createWorkspace(ana, { name: 'Equipo' })
    const doc = await createDocument(ana, { title: 'Arquitectura', workspaceId: ws.id })
    await setWorkspaceMember(ana, ws.id, bruno.id, 'viewer')
    await setWorkspaceMember(ana, ws.id, carla.id, 'editor')

    const asViewer = await getDocument(bruno, doc.id)
    expect(asViewer).toMatchObject({ role: 'viewer', canEdit: false })
    await expect(renameDocument(bruno, doc.id, { title: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(deleteDocument(bruno, doc.id)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createDocument(bruno, { title: 'x', workspaceId: ws.id })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createFolder(bruno, ws.id, { name: 'x' })).rejects.toBeInstanceOf(ForbiddenError)

    expect((await renameDocument(carla, doc.id, { title: 'Arquitectura v2' })).title).toBe('Arquitectura v2')
    await expect(updateWorkspace(carla, ws.id, { name: 'Otro' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(setWorkspaceMember(carla, ws.id, bruno.id, 'editor')).rejects.toBeInstanceOf(ForbiddenError)

    expect((await listWorkspaceMembers(bruno, ws.id)).map((m) => [m.user.id, m.role])).toEqual([
      [ana.id, 'owner'],
      [bruno.id, 'viewer'],
      [carla.id, 'editor'],
    ])
    await removeWorkspaceMember(ana, ws.id, bruno.id)
    expect(await canAccessDocument(bruno, doc.id)).toBe(false)
  })

  it('siempre queda al menos un propietario', async () => {
    const ws = await createWorkspace(ana, { name: 'Equipo' })
    await expect(removeWorkspaceMember(ana, ws.id, ana.id)).rejects.toBeInstanceOf(ConflictError)
    await expect(setWorkspaceMember(ana, ws.id, ana.id, 'editor')).rejects.toBeInstanceOf(ConflictError)
    await setWorkspaceMember(ana, ws.id, bruno.id, 'owner')
    await setWorkspaceMember(ana, ws.id, ana.id, 'editor')
    expect((await listWorkspaces(ana)).find((w) => w.id === ws.id)?.role).toBe('editor')
  })

  it('convertir un espacio en «para todos» da acceso de editor a todo el mundo', async () => {
    const ws = await createWorkspace(ana, { name: 'Equipo' })
    const doc = await createDocument(ana, { title: 'x', workspaceId: ws.id })
    expect(await canAccessDocument(bruno, doc.id)).toBe(false)
    await updateWorkspace(ana, ws.id, { everyone: true })
    expect((await getDocument(bruno, doc.id)).canEdit).toBe(true)
  })

  it('solo se borran espacios vacíos, y nunca el último', async () => {
    const ws = await createWorkspace(ana, { name: 'Temporal' })
    const doc = await createDocument(ana, { title: 'x', workspaceId: ws.id })
    await expect(deleteWorkspace(ana, ws.id)).rejects.toBeInstanceOf(ConflictError)
    await deleteDocument(ana, doc.id)
    await deleteWorkspace(ana, ws.id)
    expect((await listWorkspaces(ana)).map((w) => w.id)).toEqual(['general'])
    await expect(deleteWorkspace(admin, 'general')).rejects.toBeInstanceOf(ConflictError)
  })

  it('sin ningún espacio con escritura no se pueden crear notas', async () => {
    await updateWorkspace(admin, 'general', { everyone: false })
    await expect(defaultWorkspaceId(ana)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createDocument(ana, { title: 'x' })).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('mover notas', () => {
  it('exige escribir en origen y destino, y la carpeta debe ser del destino', async () => {
    const team = await createWorkspace(ana, { name: 'Equipo' })
    await setWorkspaceMember(ana, team.id, bruno.id, 'viewer')
    const doc = await createDocument(bruno, { title: 'De Bruno' })

    await expect(updateDocument(bruno, doc.id, { workspaceId: team.id })).rejects.toBeInstanceOf(ForbiddenError)
    const folder = await createFolder(ana, team.id, { name: 'Docs' })
    await expect(updateDocument(ana, doc.id, { folderId: folder.id })).rejects.toBeInstanceOf(ValidationError)

    const moved = await updateDocument(ana, doc.id, { workspaceId: team.id, folderId: folder.id })
    expect(moved).toMatchObject({ workspaceId: team.id, folderId: folder.id })
    expect((await getDocument(bruno, doc.id)).canEdit).toBe(false)

    // Cambiar de espacio sin indicar carpeta la deja en la raíz.
    expect(await updateDocument(admin, doc.id, { workspaceId: 'general' })).toMatchObject({ workspaceId: 'general', folderId: null })
  })
})

describe('carpetas', () => {
  it('se anidan, se mueven sin crear ciclos y al borrarlas no se pierde nada', async () => {
    const a = await createFolder(ana, 'general', { name: 'Infra' })
    const b = await createFolder(ana, 'general', { name: 'Servidores', parentId: a.id })
    const c = await createFolder(ana, 'general', { name: 'dev-home', parentId: b.id })
    const doc = await createDocument(ana, { title: 'Red', folderId: b.id })

    await expect(moveFolder(ana, a.id, c.id)).rejects.toBeInstanceOf(ValidationError)
    await expect(moveFolder(ana, a.id, a.id)).rejects.toBeInstanceOf(ValidationError)

    await deleteFolder(ana, b.id)
    const folders = await listFolders(ana, 'general')
    expect(folders.map((f) => [f.name, f.parentId])).toEqual([
      ['dev-home', a.id],
      ['Infra', null],
    ])
    expect((await getDocument(ana, doc.id)).folderId).toBe(a.id)
    expect(await getPrisma().document.count()).toBe(1)

    const other = await createWorkspace(ana, { name: 'Otro' })
    await expect(createFolder(ana, other.id, { name: 'x', parentId: a.id })).rejects.toBeInstanceOf(ValidationError)
  })
})
