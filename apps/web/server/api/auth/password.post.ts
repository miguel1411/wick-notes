import { changeOwnPassword, type ChangeOwnPasswordInput } from '@wick/core'

/** Cambia la contraseña propia; las demás sesiones de la cuenta se cierran. */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const body = await readJson<ChangeOwnPasswordInput>(event)
  await runCore(() => changeOwnPassword(user, body, event.context.auth?.sessionId), event)
  setResponseStatus(event, 204)
  return null
})
