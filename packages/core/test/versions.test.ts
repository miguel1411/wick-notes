import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectPrisma, getPrisma } from '@wick/db'
import {
  AUTO_VERSION_INTERVAL_MS,
  createDocument,
  createVersion,
  deleteDocument,
  getVersionState,
  listVersions,
  maybeCreateAutoVersion,
  MAX_VERSIONS_PER_DOCUMENT,
  NotFoundError,
  protectBeforeChange,
  readMarkdown,
  stateFromMarkdown,
  type AuthUser,
} from '../src'
import { makeUser, resetDatabase } from './helpers'

const state = (text: string) => stateFromMarkdown(text)

let ana: AuthUser
let docId: string
beforeEach(async () => {
  await resetDatabase()
  ana = await makeUser()
  docId = (await createDocument(ana, { title: 'Notas' })).id
})
afterAll(async () => {
  await disconnectPrisma()
})

describe('versiones', () => {
  it('la primera versión automática se crea al haber contenido', async () => {
    expect(await maybeCreateAutoVersion(docId, state(''), ana.id)).toBeNull()
    const v = await maybeCreateAutoVersion(docId, state('hola'), ana.id)
    expect(v).toMatchObject({ reason: 'auto', title: 'Notas', author: { id: ana.id }, preview: 'hola' })
  })

  it('respeta el intervalo y no duplica contenido igual', async () => {
    const t0 = Date.now()
    await maybeCreateAutoVersion(docId, state('uno'), ana.id, t0)
    expect(await maybeCreateAutoVersion(docId, state('dos'), ana.id, t0 + 60_000)).toBeNull()
    // Pasado el intervalo, pero mismo contenido que la última → nada.
    await getPrisma().documentVersion.updateMany({ data: { createdAt: new Date(t0 - AUTO_VERSION_INTERVAL_MS - 1) } })
    expect(await maybeCreateAutoVersion(docId, state('uno'), ana.id)).toBeNull()
    expect(await maybeCreateAutoVersion(docId, state('dos'), ana.id)).not.toBeNull()
    expect((await listVersions(ana, docId)).map((v) => v.preview)).toEqual(['dos', 'uno'])
  })

  it('protege antes de reemplazar o restaurar, sin duplicar', async () => {
    const before = await protectBeforeChange(docId, state('original'), 'before_replace', ana.id)
    expect(before?.reason).toBe('before_replace')
    expect(await protectBeforeChange(docId, state('original'), 'before_restore', ana.id)).toBeNull()
    expect(await protectBeforeChange(docId, state('cambiado'), 'before_restore', ana.id)).toMatchObject({ reason: 'before_restore' })
  })

  it('guarda el estado completo y comprueba que la versión es de esa nota', async () => {
    const v = await createVersion(docId, state('texto exacto'), { reason: 'manual', authorId: ana.id })
    const { state: s, title } = await getVersionState(docId, v.id)
    expect(readMarkdown(s)).toBe('texto exacto')
    expect(title).toBe('Notas')

    const other = (await createDocument(ana, { title: 'Otra' })).id
    await expect(getVersionState(other, v.id)).rejects.toBeInstanceOf(NotFoundError)
    await expect(listVersions(ana, 'no-existe')).rejects.toBeInstanceOf(NotFoundError)
  })

  it(`conserva como mucho ${MAX_VERSIONS_PER_DOCUMENT} por nota`, async () => {
    const rows = Array.from({ length: MAX_VERSIONS_PER_DOCUMENT + 5 }, (_, i) => ({
      documentId: docId,
      title: 'Notas',
      yjsState: new Uint8Array(state(`v${i}`)),
      contentText: `v${i}`,
      reason: 'AUTO' as const,
      createdAt: new Date(Date.now() - (200 - i) * 60_000),
    }))
    await getPrisma().documentVersion.createMany({ data: rows })
    await createVersion(docId, state('la última'), { reason: 'manual' })
    const list = await listVersions(ana, docId)
    expect(list).toHaveLength(MAX_VERSIONS_PER_DOCUMENT)
    expect(list[0]!.preview).toBe('la última')
    expect(list.at(-1)!.preview).toBe('v6')
  })

  it('las versiones se borran con la nota', async () => {
    await createVersion(docId, state('x'), { reason: 'manual' })
    await deleteDocument(ana, docId)
    expect(await getPrisma().documentVersion.count()).toBe(0)
  })
})
