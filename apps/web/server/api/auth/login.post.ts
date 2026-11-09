import { login, type LoginInput } from '@wick/core'

export default defineEventHandler(async (event) => {
  const body = await readJson<LoginInput>(event)
  const session = await runCore(() => login(body, getClientInfo(event)), event)
  setSessionCookie(event, session.token, session.expiresAt)
  return { user: session.user }
})
