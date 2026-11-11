import { testAiConnection } from '@wick/core'

/** Prueba la conexión con el proveedor (con la clave escrita en el formulario o la guardada). */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  const body = await readJson<{ apiKey?: string; model?: string; provider?: string }>(event)
  return runCore(
    () =>
      testAiConnection(user, {
        apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
        model: typeof body.model === 'string' ? body.model : undefined,
        provider: typeof body.provider === 'string' ? body.provider : undefined,
      }),
    event,
  )
})
