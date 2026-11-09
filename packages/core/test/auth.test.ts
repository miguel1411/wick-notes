import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectPrisma, getPrisma } from '@wick/db'
import {
  changeOwnPassword,
  ConflictError,
  createInitialAdmin,
  createUser,
  ForbiddenError,
  hashPassword,
  isSetupRequired,
  listUsers,
  login,
  logout,
  NotFoundError,
  RateLimitedError,
  resetUserPassword,
  SESSION_TTL_MS,
  UnauthorizedError,
  updateUser,
  validateSession,
  ValidationError,
  verifyPassword,
} from '../src'
import { makeUser, resetDatabase, TEST_PASSWORD } from './helpers'

beforeEach(async () => {
  await resetDatabase()
})

afterAll(async () => {
  await disconnectPrisma()
})

describe('contraseñas', () => {
  it('verifica la contraseña correcta y rechaza las demás', async () => {
    const hash = await hashPassword('correcta horse battery')
    expect(hash.startsWith('scrypt$')).toBe(true)
    expect(hash).not.toContain('correcta')
    expect(await verifyPassword('correcta horse battery', hash)).toBe(true)
    expect(await verifyPassword('incorrecta', hash)).toBe(false)
    expect(await verifyPassword('x', 'basura')).toBe(false)
  })

  it('el mismo texto produce hashes distintos (sal aleatoria)', async () => {
    expect(await hashPassword('igual-igual-igual')).not.toBe(await hashPassword('igual-igual-igual'))
  })
})

describe('primer administrador', () => {
  it('solo se puede crear cuando no hay usuarios', async () => {
    expect(await isSetupRequired()).toBe(true)
    const admin = await createInitialAdmin({ username: ' Admin ', name: 'Admin', password: 'una-contraseña-larga' })
    expect(admin).toMatchObject({ username: 'admin', role: 'ADMIN' })
    expect(await isSetupRequired()).toBe(false)
    await expect(
      createInitialAdmin({ username: 'otro', name: 'Otro', password: 'una-contraseña-larga' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('dos peticiones simultáneas no crean dos administradores', async () => {
    const results = await Promise.allSettled(
      ['uno', 'dos', 'tres'].map((u) => createInitialAdmin({ username: u, name: u, password: 'una-contraseña-larga' })),
    )
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await getPrisma().user.count()).toBe(1)
  })

  it('valida usuario y contraseña', async () => {
    await expect(createInitialAdmin({ username: 'ab', name: 'x', password: 'una-contraseña-larga' })).rejects.toBeInstanceOf(ValidationError)
    await expect(createInitialAdmin({ username: 'José', name: 'x', password: 'una-contraseña-larga' })).rejects.toBeInstanceOf(ValidationError)
    await expect(createInitialAdmin({ username: 'admin', name: 'x', password: 'corta' })).rejects.toBeInstanceOf(ValidationError)
  })
})

describe('sesiones', () => {
  it('inicia sesión, valida el token y cierra sesión', async () => {
    const user = await makeUser()
    const session = await login({ username: user.username.toUpperCase(), password: TEST_PASSWORD }, { userAgent: 'test' })
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const valid = await validateSession(session.token)
    expect(valid?.user).toEqual(user)

    // En la base de datos solo está el hash del token.
    expect(await getPrisma().session.count({ where: { id: session.token } })).toBe(0)

    await logout(session.token)
    expect(await validateSession(session.token)).toBeNull()
  })

  it('rechaza credenciales incorrectas con el mismo mensaje exista o no el usuario', async () => {
    const user = await makeUser()
    const wrongPassword = login({ username: user.username, password: 'otra-cosa' })
    const unknownUser = login({ username: 'nadie', password: 'otra-cosa' })
    await expect(wrongPassword).rejects.toThrow('Usuario o contraseña incorrectos')
    await expect(unknownUser).rejects.toThrow('Usuario o contraseña incorrectos')
  })

  it('una cuenta desactivada no puede entrar y pierde sus sesiones', async () => {
    const admin = await makeUser('ADMIN')
    const user = await makeUser()
    const session = await login({ username: user.username, password: TEST_PASSWORD })
    await updateUser(admin, user.id, { disabled: true })
    expect(await validateSession(session.token)).toBeNull()
    await expect(login({ username: user.username, password: TEST_PASSWORD })).rejects.toBeInstanceOf(UnauthorizedError)
  })

  it('ignora tokens inválidos o caducados', async () => {
    const user = await makeUser()
    expect(await validateSession('')).toBeNull()
    expect(await validateSession('no-es-un-token')).toBeNull()
    const session = await login({ username: user.username, password: TEST_PASSWORD })
    await getPrisma().session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    expect(await validateSession(session.token)).toBeNull()
  })

  it('renueva la caducidad al usarse tras más de una hora', async () => {
    const user = await makeUser()
    const session = await login({ username: user.username, password: TEST_PASSWORD })
    await getPrisma().session.updateMany({
      data: { lastUsedAt: new Date(Date.now() - 2 * 3600_000), expiresAt: new Date(Date.now() + 3600_000) },
    })
    const valid = await validateSession(session.token)
    expect(valid?.renewed).toBe(true)
    expect(valid!.expiresAt.getTime()).toBeGreaterThan(Date.now() + SESSION_TTL_MS - 60_000)
  })

  it('bloquea tras muchos intentos fallidos desde el mismo origen', async () => {
    const user = await makeUser()
    for (let i = 0; i < 8; i++) {
      await expect(login({ username: user.username, password: 'mal' }, { ip: '10.0.0.1' })).rejects.toBeInstanceOf(UnauthorizedError)
    }
    // Bloqueado incluso con la contraseña correcta…
    await expect(login({ username: user.username, password: TEST_PASSWORD }, { ip: '10.0.0.1' })).rejects.toBeInstanceOf(RateLimitedError)
    // …pero solo para ese origen.
    await expect(login({ username: user.username, password: TEST_PASSWORD }, { ip: '10.0.0.2' })).resolves.toBeTruthy()
  })
})

describe('gestión de usuarios', () => {
  it('solo un admin lista, crea y modifica usuarios', async () => {
    const admin = await makeUser('ADMIN')
    const member = await makeUser()

    await expect(listUsers(member)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(createUser(member, { username: 'nuevo', name: 'N', password: 'una-contraseña-larga' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(updateUser(member, admin.id, { disabled: true })).rejects.toBeInstanceOf(ForbiddenError)

    const created = await createUser(admin, { username: 'Nuevo', name: 'Nuevo', password: 'una-contraseña-larga' })
    expect(created).toMatchObject({ username: 'nuevo', role: 'MEMBER', disabled: false })
    expect((await listUsers(admin)).map((u) => u.username)).toContain('nuevo')
    expect(await getPrisma().user.findUnique({ where: { id: created.id } })).not.toHaveProperty('password')
  })

  it('no permite usuarios duplicados', async () => {
    const admin = await makeUser('ADMIN')
    await createUser(admin, { username: 'repe', name: 'R', password: 'una-contraseña-larga' })
    await expect(createUser(admin, { username: 'REPE', name: 'R', password: 'una-contraseña-larga' })).rejects.toBeInstanceOf(ConflictError)
  })

  it('un admin no puede quitarse el rol ni desactivarse (siempre queda un admin)', async () => {
    const admin = await makeUser('ADMIN')
    await expect(updateUser(admin, admin.id, { role: 'MEMBER' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(updateUser(admin, admin.id, { disabled: true })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(updateUser(admin, admin.id, { name: 'Nuevo nombre' })).resolves.toMatchObject({ name: 'Nuevo nombre' })
  })

  it('reactivar una cuenta la deja entrar de nuevo', async () => {
    const admin = await makeUser('ADMIN')
    const user = await makeUser()
    await updateUser(admin, user.id, { disabled: true })
    await updateUser(admin, user.id, { disabled: false })
    await expect(login({ username: user.username, password: TEST_PASSWORD })).resolves.toBeTruthy()
  })

  it('restablecer la contraseña cierra las sesiones del usuario', async () => {
    const admin = await makeUser('ADMIN')
    const user = await makeUser()
    const session = await login({ username: user.username, password: TEST_PASSWORD })
    await resetUserPassword(admin, user.id, { password: 'contraseña-nueva-1' })
    expect(await validateSession(session.token)).toBeNull()
    await expect(login({ username: user.username, password: 'contraseña-nueva-1' })).resolves.toBeTruthy()
    await expect(resetUserPassword(admin, 'no-existe', { password: 'contraseña-nueva-1' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('cambiar la propia contraseña exige la actual y conserva solo la sesión en uso', async () => {
    const user = await makeUser()
    const current = await login({ username: user.username, password: TEST_PASSWORD })
    const other = await login({ username: user.username, password: TEST_PASSWORD })
    const currentId = (await validateSession(current.token))!.sessionId

    await expect(
      changeOwnPassword(user, { currentPassword: 'mal', newPassword: 'contraseña-nueva-2' }, currentId),
    ).rejects.toBeInstanceOf(ValidationError)

    await changeOwnPassword(user, { currentPassword: TEST_PASSWORD, newPassword: 'contraseña-nueva-2' }, currentId)
    expect(await validateSession(current.token)).not.toBeNull()
    expect(await validateSession(other.token)).toBeNull()
  })
})
