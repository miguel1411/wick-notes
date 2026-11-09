import { logout } from '@wick/core'

export default defineEventHandler(async (event) => {
  await logout(getSessionToken(event))
  clearSessionCookie(event)
  setResponseStatus(event, 204)
  return null
})
