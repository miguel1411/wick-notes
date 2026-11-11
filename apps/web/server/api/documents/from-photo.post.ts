import { createNoteFromPhotos, MAX_PHOTOS_TOTAL_BYTES, WickError } from '@wick/core'

/**
 * Nota desde foto. Multipart: `images` (1 a 4 ficheros), `workspaceId`,
 * `research` ("false" para no investigar) e `instructions`.
 *
 * Responde con eventos (SSE), porque tarda de segundos a minutos:
 *   stage  { stage: 'reading' | 'context' | 'writing' | 'saving', research }
 *   done   { document, folderId, researched }
 *   error  { statusCode, message, code, details }
 *
 *   ping   {}  (cada 15 s, para que la conexión no se corte por inactividad)
 *
 * Las fotos solo están en memoria durante la petición. Si el cliente se
 * desconecta, el proceso sigue y la nota se crea igual.
 */
export default defineEventHandler(async (event) => {
  const user = requireUser(event)
  // Sin tamaño declarado no se sabría cuánto se va a leer en memoria.
  const declared = getRequestHeader(event, 'content-length')
  if (!declared) throw createError({ statusCode: 411, message: 'Falta el tamaño de la petición (Content-Length)' })
  if (Number(declared) > MAX_PHOTOS_TOTAL_BYTES + 1024 * 1024) {
    throw createError({ statusCode: 413, message: 'Entre todas, las fotos superan los 20 MB' })
  }

  const parts = (await readMultipartFormData(event)) ?? []
  const field = (name: string) => parts.find((p) => p.name === name && !p.filename)?.data.toString('utf8')
  const input = {
    images: parts.filter((p) => p.name === 'images').map((p) => new Uint8Array(p.data)),
    workspaceId: field('workspaceId') || undefined,
    research: field('research') !== 'false',
    instructions: field('instructions'),
  }

  const stream = createEventStream(event)
  // Escribir en una conexión cerrada no falla: el proceso sigue y la nota se crea igual.
  const send = (name: string, data: unknown) => stream.push({ event: name, data: JSON.stringify(data) }).catch(() => {})
  // Latido: la redacción puede tardar minutos sin otros eventos, y los proxies
  // (o el cliente) cortan las conexiones que pasan un rato en silencio.
  const heartbeat = setInterval(() => void send('ping', {}), 15_000)

  void (async () => {
    try {
      const result = await createNoteFromPhotos(user, input, { onStage: (stage, info) => void send('stage', { stage, ...info }) })
      await send('done', { document: result.document, folderId: result.folderId, researched: result.researched })
    } catch (err) {
      if (!(err instanceof WickError)) console.error('[nota desde foto]', err)
      await send('error', errorPayload(err))
    } finally {
      clearInterval(heartbeat)
      await stream.close().catch(() => {})
    }
  })()

  return stream.send()
})
