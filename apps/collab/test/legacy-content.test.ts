import { createDocument, hashPassword, stateFromMarkdown, toAuthUser, type AuthUser } from '@wick/core'
import { disconnectPrisma, getPrisma } from '@wick/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { warnLegacyContent } from '../src/legacy-content'

let user: AuthUser

beforeAll(async () => {
  const prisma = getPrisma()
  await prisma.documentVersion.deleteMany()
  await prisma.document.deleteMany()
  await prisma.folder.deleteMany()
  await prisma.workspace.deleteMany({ where: { id: { not: 'general' } } })
  await prisma.session.deleteMany()
  await prisma.user.deleteMany()
  user = toAuthUser(
    await prisma.user.create({ data: { username: 'legado', name: 'Legado', passwordHash: await hashPassword('x'.repeat(12)) } }),
  )
})

afterAll(async () => {
  await disconnectPrisma()
})

/** Estado como lo guardaba el editor anterior: un fragmento de ProseMirror. */
function legacyState(): Uint8Array<ArrayBuffer> {
  const doc = new Y.Doc()
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText('nota antigua')])
  doc.getXmlFragment('prosemirror').push([p])
  return new Uint8Array(Y.encodeStateAsUpdate(doc))
}

describe('notas del editor anterior (p. ej. al restaurar una copia antigua)', () => {
  it('sin notas antiguas no dice nada', async () => {
    const doc = await createDocument(user, { title: 'Actual' })
    await getPrisma().document.update({ where: { id: doc.id }, data: { yjsState: new Uint8Array(stateFromMarkdown('# Hola')) } })
    const logs: string[] = []
    expect(await warnLegacyContent((m) => logs.push(m))).toEqual({ documents: 0, versions: 0 })
    expect(logs).toEqual([])
  })

  it('avisa de cuántas hay y cómo convertirlas, sin tocarlas', async () => {
    const prisma = getPrisma()
    const old = legacyState()
    const doc = await createDocument(user, { title: 'Antigua' })
    await prisma.document.update({ where: { id: doc.id }, data: { yjsState: old } })
    await prisma.documentVersion.create({ data: { documentId: doc.id, title: 'Antigua', yjsState: old, contentText: 'x', reason: 'MANUAL' } })

    const logs: string[] = []
    expect(await warnLegacyContent((m) => logs.push(m))).toEqual({ documents: 1, versions: 1 })
    expect(logs.join('\n')).toContain('1 notas y 1 versiones')
    expect(logs.join('\n')).toContain('c1cbd76')
    const row = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })
    expect(new Uint8Array(row.yjsState!)).toEqual(old)
  })
})
