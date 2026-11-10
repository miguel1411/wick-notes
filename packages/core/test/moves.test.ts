import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectPrisma, getPrisma } from '@wick/db'
import {
  ConflictError,
  countPendingMoveRequests,
  createApiToken,
  createDocument,
  createFolder,
  createWorkspace,
  decideMoveRequest,
  deleteFolder,
  ForbiddenError,
  getDocument,
  getWorkspaceTrees,
  listMoveRequests,
  NotFoundError,
  requestMove,
  resolveFolder,
  setWorkspaceMember,
  ValidationError,
  type AuthUser,
} from '../src'
import { makeUser, resetDatabase } from './helpers'

let ana: AuthUser
let bruno: AuthUser
beforeEach(async () => {
  await resetDatabase()
  ana = await makeUser()
  bruno = await makeUser()
})
afterAll(async () => {
  await disconnectPrisma()
})

describe('árbol de espacios', () => {
  it('devuelve carpetas anidadas y notas de los espacios legibles', async () => {
    const infra = await createFolder(ana, 'general', { name: 'Infra' })
    const servers = await createFolder(ana, 'general', { name: 'Servidores', parentId: infra.id })
    await createDocument(ana, { title: 'dev-home', folderId: servers.id })
    await createDocument(ana, { title: 'Suelta' })
    const priv = await createWorkspace(ana, { name: 'Privado' })
    await createDocument(ana, { title: 'Secreto', workspaceId: priv.id })

    const trees = await getWorkspaceTrees(ana)
    expect(trees.map((t) => t.name)).toEqual(['General', 'Privado'])
    const general = trees[0]!
    expect(general.notes.map((n) => n.title)).toEqual(['Suelta'])
    expect(general.folders[0]).toMatchObject({ name: 'Infra', notes: [], folders: [{ name: 'Servidores', notes: [{ title: 'dev-home' }] }] })

    expect((await getWorkspaceTrees(bruno)).map((t) => t.name)).toEqual(['General'])
    await expect(getWorkspaceTrees(bruno, priv.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('encuentra carpetas por id, nombre o ruta', async () => {
    const infra = await createFolder(ana, 'general', { name: 'Infra' })
    const a = await createFolder(ana, 'general', { name: 'Docs', parentId: infra.id })
    const b = await createFolder(ana, 'general', { name: 'Docs' })
    expect(await resolveFolder(ana, 'general', infra.id)).toBe(infra.id)
    expect(await resolveFolder(ana, 'general', 'infra')).toBe(infra.id)
    expect(await resolveFolder(ana, 'general', 'Infra/Docs')).toBe(a.id)
    await expect(resolveFolder(ana, 'general', 'docs')).rejects.toThrow('Infra / Docs')
    await expect(resolveFolder(ana, 'general', 'nada')).rejects.toBeInstanceOf(ValidationError)
    expect(b.id).toBeTruthy()
  })
})

describe('solicitudes de movimiento', () => {
  it('proponer no mueve nada; aprobar sí', async () => {
    const folder = await createFolder(ana, 'general', { name: 'Archivo' })
    const doc = await createDocument(ana, { title: 'Acta' })
    const { summary: token } = await createApiToken(ana, { name: 'Claude', scope: 'write' })

    const req = await requestMove(ana, { documentId: doc.id, folderId: folder.id, reason: 'Es un acta antigua' }, { tokenId: token.id })
    expect(req).toMatchObject({ status: 'pending', agent: 'Claude', reason: 'Es un acta antigua', from: { path: 'General' }, to: { path: 'General / Archivo' } })
    expect((await getDocument(ana, doc.id)).folderId).toBeNull()
    expect(await countPendingMoveRequests(ana)).toBe(1)

    const done = await decideMoveRequest(ana, req.id, 'approve')
    expect(done).toMatchObject({ status: 'approved', decidedBy: { id: ana.id } })
    expect((await getDocument(ana, doc.id)).folderId).toBe(folder.id)
    expect(await countPendingMoveRequests(ana)).toBe(0)
    await expect(decideMoveRequest(ana, req.id, 'reject')).rejects.toBeInstanceOf(ConflictError)
  })

  it('rechazar no mueve; una solicitud nueva sustituye a la pendiente', async () => {
    const f1 = await createFolder(ana, 'general', { name: 'Uno' })
    const f2 = await createFolder(ana, 'general', { name: 'Dos' })
    const doc = await createDocument(ana, { title: 'Nota' })
    const first = await requestMove(ana, { documentId: doc.id, folderId: f1.id })
    const second = await requestMove(ana, { documentId: doc.id, folderId: f2.id })
    expect((await listMoveRequests(ana)).map((r) => [r.id, r.status])).toEqual([
      [second.id, 'pending'],
      [first.id, 'superseded'],
    ])
    await decideMoveRequest(ana, second.id, 'reject')
    expect((await getDocument(ana, doc.id)).folderId).toBeNull()
  })

  it('valida permisos y destino al proponer', async () => {
    const team = await createWorkspace(ana, { name: 'Equipo' })
    await setWorkspaceMember(ana, team.id, bruno.id, 'viewer')
    const doc = await createDocument(ana, { title: 'x', workspaceId: team.id })
    await expect(requestMove(bruno, { documentId: doc.id, workspaceId: 'general', folderId: null })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(requestMove(ana, { documentId: doc.id, folderId: null })).rejects.toBeInstanceOf(ValidationError)
    const otherFolder = await createFolder(ana, 'general', { name: 'Fuera' })
    await expect(requestMove(ana, { documentId: doc.id, folderId: otherFolder.id })).rejects.toBeInstanceOf(ValidationError)
  })

  it('cada persona solo ve y decide sus propias solicitudes', async () => {
    const folder = await createFolder(ana, 'general', { name: 'Archivo' })
    const doc = await createDocument(ana, { title: 'x' })
    const req = await requestMove(ana, { documentId: doc.id, folderId: folder.id })
    expect(await listMoveRequests(bruno)).toEqual([])
    await expect(decideMoveRequest(bruno, req.id, 'approve')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('si al aprobar ya no se puede mover, queda como fallida con el motivo', async () => {
    const folder = await createFolder(ana, 'general', { name: 'Temporal' })
    const doc = await createDocument(ana, { title: 'x' })
    const req = await requestMove(ana, { documentId: doc.id, folderId: folder.id })
    await deleteFolder(ana, folder.id)
    // Al borrar la carpeta, el destino de la solicitud deja de existir.
    await getPrisma().moveRequest.update({ where: { id: req.id }, data: { targetFolderId: folder.id } })
    const done = await decideMoveRequest(ana, req.id, 'approve')
    expect(done.status).toBe('failed')
    expect(done.error).toContain('carpeta')
    expect((await getDocument(ana, doc.id)).folderId).toBeNull()
  })
})
