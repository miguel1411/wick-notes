import { resetUserPassword } from '@wick/core'

/** Un admin pone una contraseña nueva a otra cuenta. */
export default defineEventHandler(async (event) => {
  const body = await readJson<{ password: string }>(event)
  await runCore(() => resetUserPassword(requireUser(event), requireId(event), body), event)
  setResponseStatus(event, 204)
  return null
})
