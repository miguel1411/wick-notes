import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { disconnectPrisma, getPrisma } from '@wick/db'
import {
  createDocument,
  DEFAULT_TITLE,
  deleteDocument,
  documentExists,
  getDocument,
  listDocuments,
  loadYjsState,
  NotFoundError,
  renameDocument,
  saveYjsState,
  ValidationError,
} from '../src'

beforeEach(async () => {
  await getPrisma().document.deleteMany()
})

afterAll(async () => {
  await disconnectPrisma()
})

describe('documentos', () => {
  it('crea un documento con título por defecto o recortado', async () => {
    const a = await createDocument()
    const b = await createDocument({ title: '  Notas de red  ' })
    const c = await createDocument({ title: '   ' })
    expect(a.title).toBe(DEFAULT_TITLE)
    expect(b.title).toBe('Notas de red')
    expect(c.title).toBe(DEFAULT_TITLE)
  })

  it('rechaza títulos demasiado largos', async () => {
    await expect(createDocument({ title: 'x'.repeat(201) })).rejects.toBeInstanceOf(ValidationError)
  })

  it('lista los documentos del más reciente al más antiguo', async () => {
    const first = await createDocument({ title: 'Primero' })
    const second = await createDocument({ title: 'Segundo' })
    expect((await listDocuments()).map((d) => d.id)).toEqual([second.id, first.id])

    await renameDocument(first.id, { title: 'Primero (editado)' })
    expect((await listDocuments()).map((d) => d.id)).toEqual([first.id, second.id])
  })

  it('obtiene, renombra y borra', async () => {
    const doc = await createDocument({ title: 'Original' })
    expect((await getDocument(doc.id)).title).toBe('Original')

    const renamed = await renameDocument(doc.id, { title: 'Renombrado' })
    expect(renamed.title).toBe('Renombrado')

    await deleteDocument(doc.id)
    expect(await documentExists(doc.id)).toBe(false)
    await expect(getDocument(doc.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('devuelve NotFoundError para ids inexistentes', async () => {
    await expect(getDocument('no-existe')).rejects.toBeInstanceOf(NotFoundError)
    await expect(renameDocument('no-existe', { title: 'x' })).rejects.toBeInstanceOf(NotFoundError)
    await expect(deleteDocument('no-existe')).rejects.toBeInstanceOf(NotFoundError)
    await expect(loadYjsState('no-existe')).rejects.toBeInstanceOf(NotFoundError)
    await expect(saveYjsState('no-existe', new Uint8Array([0]))).rejects.toBeInstanceOf(NotFoundError)
    expect(await documentExists('')).toBe(false)
  })
})

describe('estado Yjs', () => {
  it('un documento nuevo no tiene estado', async () => {
    const doc = await createDocument()
    expect(await loadYjsState(doc.id)).toBeNull()
  })

  it('guarda y recupera el estado sin pérdida', async () => {
    const doc = await createDocument()

    const ydoc = new Y.Doc()
    ydoc.getText('t').insert(0, 'hola mundo ñ 🚀')
    await saveYjsState(doc.id, Y.encodeStateAsUpdate(ydoc))

    const restored = new Y.Doc()
    const state = await loadYjsState(doc.id)
    expect(state).not.toBeNull()
    Y.applyUpdate(restored, state!)
    expect(restored.getText('t').toString()).toBe('hola mundo ñ 🚀')
  })
})
