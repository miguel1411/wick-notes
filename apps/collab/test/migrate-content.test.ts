import { createDocument, hashPassword, readMarkdown, toAuthUser, type AuthUser } from '@wick/core'
import { disconnectPrisma, getPrisma } from '@wick/db'
import { LegacyMarkdownConverter } from '@wick/markdown'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrateLegacyContent } from '../src/migrate-content'

const legacy = new LegacyMarkdownConverter()
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
    await prisma.user.create({ data: { username: 'migra', name: 'Migra', passwordHash: await hashPassword('x'.repeat(12)) } }),
  )
})

afterAll(async () => {
  await legacy.close()
  await disconnectPrisma()
})

describe('migración del formato anterior', () => {
  it('convierte notas y versiones antiguas a Markdown, una sola vez', async () => {
    const prisma = getPrisma()
    const old = new Uint8Array(await legacy.fromMarkdown('# Servidor\n\nNotas con **negrita**.\n\n* uno\n* dos'))
    const doc = await createDocument(user, { title: 'Antigua' })
    const updatedAt = new Date('2026-01-02T03:04:05Z')
    await prisma.document.update({ where: { id: doc.id }, data: { yjsState: old, contentText: 'viejo', updatedAt } })
    const version = await prisma.documentVersion.create({
      data: { documentId: doc.id, title: 'Antigua', yjsState: old, contentText: 'viejo', reason: 'MANUAL' },
    })
    const nueva = await createDocument(user, { title: 'Nueva' })

    const logs: string[] = []
    expect(await migrateLegacyContent((m) => logs.push(m))).toEqual({ documents: 1, versions: 1, failed: 0 })
    expect(logs.join('\n')).toContain('1 notas y 1 versiones')

    const row = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })
    const md = readMarkdown(new Uint8Array(row.yjsState!))
    expect(md).toContain('# Servidor')
    expect(md).toContain('**negrita**')
    expect(row.contentText).toBe(md)
    expect(row.updatedAt.toISOString()).toBe(updatedAt.toISOString())

    const v = await prisma.documentVersion.findUniqueOrThrow({ where: { id: version.id } })
    expect(readMarkdown(new Uint8Array(v.yjsState))).toBe(md)
    expect(v.contentText).toBe(md)

    // La nota nueva (sin estado) no se toca, y repetir no cambia nada.
    expect((await prisma.document.findUniqueOrThrow({ where: { id: nueva.id } })).yjsState).toBeNull()
    expect(await migrateLegacyContent(() => {})).toEqual({ documents: 0, versions: 0, failed: 0 })
  })
})
