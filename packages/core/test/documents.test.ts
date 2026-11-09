import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { disconnectPrisma } from '@wick/db'
import {
  canAccessDocument,
  createDocument,
  DEFAULT_TITLE,
  deleteDocument,
  getDocument,
  listDocuments,
  loadYjsState,
  NotFoundError,
  renameDocument,
  saveYjsState,
  UnauthorizedError,
  ValidationError,
  type AuthUser,
} from '../src'
import { makeUser, resetDatabase } from './helpers'

let alice: AuthUser
let bob: AuthUser

beforeEach(async () => {
  await resetDatabase()
  alice = await makeUser()
  bob = await makeUser()
})

afterAll(async () => {
  await disconnectPrisma()
})

describe('documentos', () => {
  it('crea un documento con título por defecto o recortado y registra quién lo creó', async () => {
    const a = await createDocument(alice)
    const b = await createDocument(alice, { title: '  Notas de red  ' })
    const c = await createDocument(alice, { title: '   ' })
    expect(a.title).toBe(DEFAULT_TITLE)
    expect(b.title).toBe('Notas de red')
    expect(c.title).toBe(DEFAULT_TITLE)
    expect(a.createdBy).toEqual({ id: alice.id, name: alice.name })
  })

  it('rechaza títulos demasiado largos', async () => {
    await expect(createDocument(alice, { title: 'x'.repeat(201) })).rejects.toBeInstanceOf(ValidationError)
  })

  it('exige un usuario', async () => {
    await expect(listDocuments(null as unknown as AuthUser)).rejects.toBeInstanceOf(UnauthorizedError)
    await expect(createDocument(undefined as unknown as AuthUser)).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('todos los usuarios ven y editan todas las notas', async () => {
    const doc = await createDocument(alice, { title: 'De Alice' })
    expect((await listDocuments(bob)).map((d) => d.id)).toEqual([doc.id])
    expect(await canAccessDocument(bob, doc.id)).toBe(true)
    expect((await renameDocument(bob, doc.id, { title: 'Editada por Bob' })).title).toBe('Editada por Bob')
  })

  it('lista los documentos del más reciente al más antiguo', async () => {
    const first = await createDocument(alice, { title: 'Primero' })
    const second = await createDocument(alice, { title: 'Segundo' })
    expect((await listDocuments(alice)).map((d) => d.id)).toEqual([second.id, first.id])

    await renameDocument(alice, first.id, { title: 'Primero (editado)' })
    expect((await listDocuments(alice)).map((d) => d.id)).toEqual([first.id, second.id])
  })

  it('obtiene, renombra y borra', async () => {
    const doc = await createDocument(alice, { title: 'Original' })
    expect((await getDocument(alice, doc.id)).title).toBe('Original')
    expect((await renameDocument(alice, doc.id, { title: 'Renombrado' })).title).toBe('Renombrado')
    await deleteDocument(alice, doc.id)
    expect(await canAccessDocument(alice, doc.id)).toBe(false)
    await expect(getDocument(alice, doc.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('devuelve NotFoundError para ids inexistentes', async () => {
    await expect(getDocument(alice, 'no-existe')).rejects.toBeInstanceOf(NotFoundError)
    await expect(renameDocument(alice, 'no-existe', { title: 'x' })).rejects.toBeInstanceOf(NotFoundError)
    await expect(deleteDocument(alice, 'no-existe')).rejects.toBeInstanceOf(NotFoundError)
    await expect(loadYjsState('no-existe')).rejects.toBeInstanceOf(NotFoundError)
    await expect(saveYjsState('no-existe', new Uint8Array([0]))).rejects.toBeInstanceOf(NotFoundError)
    expect(await canAccessDocument(alice, '')).toBe(false)
  })

  it('la nota se conserva aunque se desactive o borre su autor', async () => {
    const doc = await createDocument(alice, { title: 'Persistente' })
    const { getPrisma } = await import('@wick/db')
    await getPrisma().user.delete({ where: { id: alice.id } })
    const after = await getDocument(bob, doc.id)
    expect(after.title).toBe('Persistente')
    expect(after.createdBy).toBeNull()
  })
})

describe('estado Yjs', () => {
  it('un documento nuevo no tiene estado', async () => {
    const doc = await createDocument(alice)
    expect(await loadYjsState(doc.id)).toBeNull()
  })

  it('guarda y recupera el estado sin pérdida', async () => {
    const doc = await createDocument(alice)
    const ydoc = new Y.Doc()
    ydoc.getText('t').insert(0, 'hola mundo ñ 🚀')
    await saveYjsState(doc.id, Y.encodeStateAsUpdate(ydoc))

    const restored = new Y.Doc()
    Y.applyUpdate(restored, (await loadYjsState(doc.id))!)
    expect(restored.getText('t').toString()).toBe('hola mundo ñ 🚀')
  })
})
