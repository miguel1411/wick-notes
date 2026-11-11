/** Estado de «Nota desde foto» para el usuario actual (ver getAiStatus en @wick/core). */
export interface AiStatus {
  enabled: boolean
  providerLabel: string
  model: string
  webSearch: boolean
  dailyLimit: number
  usedToday: number
  remainingToday: number
  maxPhotos: number
}

export type PhotoNoteStage = 'reading' | 'context' | 'writing' | 'saving'

/** Error de «Nota desde foto», tal como llega del servidor. */
export interface PhotoNoteError {
  statusCode: number
  message: string
  code?: string
  details?: { reason?: string; photos?: { photo: number; reason: string }[] }
}

export function useAiStatus() {
  const requestFetch = useRequestFetch()
  const { data, refresh } = useAsyncData('ai-status', () => requestFetch<AiStatus>('/api/ai/status').catch(() => null), {
    default: () => null,
  })
  return { status: data, refresh }
}

/** Separa un bloque de texto SSE («event: …\ndata: …») en nombre y datos. */
function parseEvent(raw: string): { event: string; data: string } {
  let event = 'message'
  const data: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  return { event, data: data.join('\n') }
}

/**
 * Envía las fotos y sigue el progreso (eventos del servidor) hasta que la nota
 * está creada. Lanza un PhotoNoteError si algo falla.
 */
export async function sendPhotoNote(
  form: FormData,
  onStage: (stage: PhotoNoteStage, research: boolean) => void,
): Promise<{ document: DocumentSummary; researched: boolean }> {
  const lost: PhotoNoteError = {
    statusCode: 0,
    message: 'Se perdió la conexión con el servidor. Si la nota se llegó a crear, aparecerá en tu carpeta.',
  }
  let res: Response
  try {
    res = await fetch('/api/documents/from-photo', { method: 'POST', body: form, headers: { accept: 'text/event-stream' } })
  } catch {
    throw lost
  }
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null
    throw { statusCode: res.status, message: body?.message ?? 'No se pudo crear la nota' } satisfies PhotoNoteError
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true as const }))
    if (done) break
    buffer += value.replace(/\r\n/g, '\n')
    for (let i = buffer.indexOf('\n\n'); i >= 0; i = buffer.indexOf('\n\n')) {
      const { event, data } = parseEvent(buffer.slice(0, i))
      buffer = buffer.slice(i + 2)
      if (!data) continue
      const payload = JSON.parse(data)
      if (event === 'stage') onStage(payload.stage, payload.research)
      else if (event === 'done') return payload
      else if (event === 'error') throw payload as PhotoNoteError
    }
  }
  throw lost
}
