import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectPrisma, getPrisma } from '@wick/db'
import {
  createApiToken,
  listApiTokens,
  NotFoundError,
  revokeApiToken,
  updateUser,
  validateApiToken,
  ValidationError,
} from '../src'
import { makeUser, resetDatabase } from './helpers'

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await disconnectPrisma()
})

describe('tokens de API', () => {
  it('crea un token que solo se muestra una vez y valida con su alcance', async () => {
    const user = await makeUser()
    const { token, summary } = await createApiToken(user, { name: 'CLI portátil', scope: 'write' })
    expect(token).toMatch(/^wick_[A-Za-z0-9_-]{43}$/)
    expect(summary).toMatchObject({ name: 'CLI portátil', scope: 'write', prefix: token.slice(0, 9), expiresAt: null })

    // En la base de datos no está el token en claro.
    const row = await getPrisma().apiToken.findFirstOrThrow()
    expect(JSON.stringify(row)).not.toContain(token)

    const valid = await validateApiToken(token)
    expect(valid).toMatchObject({ tokenId: summary.id, scope: 'write', user: { id: user.id } })
  })

  it('por defecto es de solo lectura', async () => {
    const user = await makeUser()
    const { token } = await createApiToken(user, { name: 'Agente' })
    expect((await validateApiToken(token))?.scope).toBe('read')
  })

  it('rechaza tokens inválidos, caducados o de cuentas desactivadas', async () => {
    const admin = await makeUser('ADMIN')
    const user = await makeUser()
    expect(await validateApiToken('wick_' + 'x'.repeat(43))).toBeNull()
    expect(await validateApiToken('otra-cosa')).toBeNull()

    const { token } = await createApiToken(user, { name: 'Caduca', expiresInDays: 1 })
    await getPrisma().apiToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await validateApiToken(token)).toBeNull()

    const other = await createApiToken(user, { name: 'Activo' })
    await updateUser(admin, user.id, { disabled: true })
    expect(await validateApiToken(other.token)).toBeNull()
  })

  it('cada usuario lista y revoca solo sus propios tokens', async () => {
    const alice = await makeUser()
    const bob = await makeUser()
    const a = await createApiToken(alice, { name: 'de Alice' })
    await createApiToken(bob, { name: 'de Bob' })

    expect((await listApiTokens(alice)).map((t) => t.name)).toEqual(['de Alice'])
    await expect(revokeApiToken(bob, a.summary.id)).rejects.toBeInstanceOf(NotFoundError)

    await revokeApiToken(alice, a.summary.id)
    expect(await validateApiToken(a.token)).toBeNull()
    expect(await listApiTokens(alice)).toEqual([])
  })

  it('valida nombre, alcance y caducidad', async () => {
    const user = await makeUser()
    await expect(createApiToken(user, { name: '  ' })).rejects.toBeInstanceOf(ValidationError)
    await expect(createApiToken(user, { name: 'x', scope: 'admin' as 'read' })).rejects.toBeInstanceOf(ValidationError)
    await expect(createApiToken(user, { name: 'x', expiresInDays: 0 })).rejects.toBeInstanceOf(ValidationError)
  })

  it('registra el último uso', async () => {
    const user = await makeUser()
    const { token, summary } = await createApiToken(user, { name: 'x' })
    expect(summary.lastUsedAt).toBeNull()
    await validateApiToken(token)
    expect((await listApiTokens(user))[0]!.lastUsedAt).not.toBeNull()
  })
})
