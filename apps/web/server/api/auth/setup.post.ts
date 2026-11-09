import { createInitialAdmin, createSession, type SetupInput } from '@wick/core'

/** Crea el primer administrador (solo si no existe ningún usuario) y abre su sesión. */
export default defineEventHandler(async (event) => {
  const body = await readJson<SetupInput>(event)
  const user = await runCore(() => createInitialAdmin(body), event)
  const session = await createSession(user, getClientInfo(event))
  setSessionCookie(event, session.token, session.expiresAt)
  setResponseStatus(event, 201)
  return { user }
})
