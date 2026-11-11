/**
 * Proveedor Anthropic (Claude), con el SDK oficial.
 *
 * - Lectura: visión + salida estructurada (JSON con esquema), effort «medium».
 * - Redacción: effort «high» y, si se permite, la búsqueda web del servidor de
 *   Anthropic (la versión que admite el modelo), con un máximo de búsquedas.
 * - Respaldo ante rechazos de seguridad: `fallbacks: "default"` (beta
 *   server-side-fallback), que reintenta en otro modelo dentro de la misma llamada.
 * - Pensamiento: adaptativo (en claude-opus-5-5 siempre está activo).
 */
import Anthropic from '@anthropic-ai/sdk'
import type { BetaContentBlock, BetaMessage, BetaMessageParam, BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { z } from 'zod'
import { COMPOSE_SYSTEM, composeUserText, extractNote, READ_SCHEMA, READ_SYSTEM, readUserText } from './prompts'
import {
  type AiImage,
  type AiProvider,
  type AiProviderConfig,
  AiProviderError,
  type AiUsage,
  type ComposeInput,
  type PhotoReading,
  type Source,
} from './types'

const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
/**
 * Si la búsqueda web se alarga, la API pausa el turno (pause_turn) y se reanuda.
 * Pocas veces: cada reanudación es otra petición con su propio máximo de búsquedas.
 */
const MAX_CONTINUATIONS = 2

const readingSchema = z.object({
  photos: z.array(z.object({ handwritten: z.boolean(), reason: z.string() })),
  hasContent: z.boolean(),
  title: z.string(),
  language: z.string(),
  transcription: z.string(),
  keyTerms: z.array(z.string()),
})

/**
 * La búsqueda web con filtrado dinámico (web_search_20260209) solo funciona bien
 * en los modelos grandes; en el resto (Haiku, modelos antiguos) se usa la básica.
 */
export function webSearchToolType(model: string): 'web_search_20260209' | 'web_search_20250305' {
  return /^claude-(fable|mythos|opus-5|opus-4-[678]|sonnet-5|sonnet-4-6)/.test(model) ? 'web_search_20260209' : 'web_search_20250305'
}

const zeroUsage = (): AiUsage => ({ inputTokens: 0, outputTokens: 0, webSearches: 0 })

function addUsage(total: AiUsage, msg: BetaMessage) {
  const u = msg.usage
  // Con respaldo ante rechazos, cada intento (también el del modelo que se negó)
  // viene en `iterations`; el total de arriba solo cuenta el que respondió.
  const parts = u.iterations?.length ? u.iterations : [u]
  for (const p of parts) {
    total.inputTokens += p.input_tokens + (p.cache_creation_input_tokens ?? 0) + (p.cache_read_input_tokens ?? 0)
    total.outputTokens += (p as { output_tokens?: number }).output_tokens ?? 0
  }
  total.webSearches += u.server_tool_use?.web_search_requests ?? 0
}

const textOf = (blocks: BetaContentBlock[]) =>
  blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')

function checkStop(msg: BetaMessage) {
  if (msg.stop_reason === 'refusal') {
    throw new AiProviderError('El modelo se negó a procesar este contenido.', 'refused')
  }
  if (msg.stop_reason === 'max_tokens') {
    throw new AiProviderError('La respuesta del modelo quedó incompleta (demasiado larga).', 'invalid_response')
  }
}

/** Traduce los errores del SDK a mensajes para el usuario o el administrador. */
async function call<T>(model: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof AiProviderError) throw err
    if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
      throw new AiProviderError('La clave de API de Anthropic no es válida o no tiene permiso.', 'auth')
    }
    if (err instanceof Anthropic.NotFoundError) {
      throw new AiProviderError(`El modelo «${model}» no existe o la clave no tiene acceso a él.`, 'model')
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AiProviderError('Anthropic está limitando las peticiones. Prueba de nuevo en unos minutos.', 'unavailable')
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new AiProviderError('No se pudo conectar con Anthropic. Revisa la conexión a internet del servidor.', 'unavailable')
    }
    if (err instanceof Anthropic.BadRequestError) {
      throw new AiProviderError(`Anthropic rechazó la petición: ${err.message}`, 'invalid_response')
    }
    if (err instanceof Anthropic.APIError) {
      throw new AiProviderError('Anthropic no está disponible en este momento. Prueba de nuevo más tarde.', 'unavailable')
    }
    throw err
  }
}

export class AnthropicProvider implements AiProvider {
  readonly id = 'anthropic'
  readonly capabilities = { webSearch: true }
  readonly model: string
  private readonly client: Anthropic

  constructor(config: AiProviderConfig) {
    this.model = config.model
    // Lectura y redacción pueden tardar varios minutos (sobre todo con búsquedas).
    this.client = new Anthropic({ apiKey: config.apiKey, maxRetries: 2, timeout: 10 * 60 * 1000 })
  }

  async check(): Promise<void> {
    await call(this.model, () => this.client.models.retrieve(this.model))
  }

  async readPhotos(images: AiImage[], instructions?: string): Promise<{ reading: PhotoReading; usage: AiUsage }> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = images.flatMap((img, i) => [
      { type: 'text' as const, text: `Foto ${i + 1}:` },
      {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: img.mediaType, data: Buffer.from(img.data).toString('base64') },
      },
    ])
    content.push({ type: 'text', text: readUserText(images.length, instructions) })

    const msg = await call(this.model, () =>
      this.client.beta.messages
        .stream({
          model: this.model,
          max_tokens: 32000,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          system: READ_SYSTEM,
          output_config: { effort: 'medium', format: { type: 'json_schema', schema: READ_SCHEMA } },
          messages: [{ role: 'user', content }],
        })
        .finalMessage(),
    )
    checkStop(msg)
    const usage = zeroUsage()
    addUsage(usage, msg)

    let parsed: unknown
    try {
      parsed = JSON.parse(textOf(msg.content))
    } catch {
      throw new AiProviderError('La respuesta del modelo no tiene el formato esperado.', 'invalid_response')
    }
    const result = readingSchema.safeParse(parsed)
    if (!result.success) throw new AiProviderError('La respuesta del modelo no tiene el formato esperado.', 'invalid_response')
    return { reading: result.data, usage }
  }

  async composeNote(input: ComposeInput): Promise<{ markdown: string; sources: Source[]; usage: AiUsage }> {
    const tools: BetaToolUnion[] =
      input.research && input.maxSearches > 0
        ? [{ type: webSearchToolType(this.model), name: 'web_search', max_uses: input.maxSearches }]
        : []
    const question: BetaMessageParam = { role: 'user', content: composeUserText(input) }
    const usage = zeroUsage()
    const blocks: BetaContentBlock[] = []

    for (let turn = 0; ; turn++) {
      const messages: BetaMessageParam[] = blocks.length ? [question, { role: 'assistant', content: blocks }] : [question]
      const msg = await call(this.model, () =>
        this.client.beta.messages
          .stream({
            model: this.model,
            max_tokens: 64000,
            betas: [FALLBACK_BETA],
            fallbacks: 'default',
            system: COMPOSE_SYSTEM,
            output_config: { effort: 'high' },
            ...(tools.length ? { tools } : {}),
            messages,
          })
          .finalMessage(),
      )
      addUsage(usage, msg)
      blocks.push(...msg.content)
      if (msg.stop_reason === 'pause_turn' && turn < MAX_CONTINUATIONS) continue
      if (msg.stop_reason === 'pause_turn') {
        throw new AiProviderError('La investigación se alargó demasiado. Prueba sin investigar en internet.', 'unavailable')
      }
      checkStop(msg)
      break
    }

    const markdown = extractNote(textOf(blocks))
    if (!markdown) throw new AiProviderError('El modelo no devolvió ninguna nota.', 'invalid_response')
    return { markdown, sources: collectSources(blocks), usage }
  }
}

/** Páginas citadas en la respuesta (búsqueda web), sin repetir. */
function collectSources(blocks: BetaContentBlock[]): Source[] {
  const seen = new Map<string, Source>()
  for (const b of blocks) {
    if (b.type !== 'text' || !b.citations) continue
    for (const c of b.citations) {
      if (c.type === 'web_search_result_location' && !seen.has(c.url)) seen.set(c.url, { url: c.url, title: c.title })
    }
  }
  return [...seen.values()]
}
