import { createApiToken, type CreateApiTokenInput } from '@wick/core'

/** Crea un token propio. La respuesta es la única vez que se ve el token completo. */
export default defineEventHandler(async (event) => {
  const body = await readJson<CreateApiTokenInput>(event)
  const result = await runCore(() => createApiToken(requireUser(event), body), event)
  setResponseStatus(event, 201)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return result
})
