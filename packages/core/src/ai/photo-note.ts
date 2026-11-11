/**
 * «Nota desde foto»: de 1 a 4 fotos de apuntes escritos a mano a una nota nueva.
 *
 *   1. Lectura: el modelo comprueba que cada foto esté escrita a mano y la transcribe.
 *      Si alguna no lo está, se para aquí (solo se gasta esta llamada).
 *   2. Contexto: notas de wick relacionadas (con los permisos del usuario).
 *   3. Redacción (con búsqueda web si se permite): la nota final en Markdown.
 *   4. Se guarda en la carpeta del usuario dentro del espacio.
 *
 * Las fotos solo viven en memoria durante la petición: no se guardan en ningún
 * sitio. Cada uso queda en AiRun (sin contenido) para el límite diario y el costo.
 */
import { getPrisma, Prisma } from '@wick/db'
import { requireActor, type AuthUser } from '../auth/actor'
import { stateFromMarkdown } from '../content'
import { createDocument, type DocumentSummary } from '../documents'
import { UnavailableError, UnprocessableError, ValidationError, WickError } from '../errors'
import { splitTitleFromMarkdown } from '../markdown-title'
import { DEFAULT_TITLE } from '../schemas'
import { searchDocuments } from '../search'
import { defaultWorkspaceId, requireWorkspaceAccess } from '../workspaces'
import { preparePhotos } from './images'
import { countAiNotesToday, createAiProvider, loadAiRuntime, startOfDay } from './settings'
import { type AiProvider, AiProviderError, type AiProviderFactory, type AiUsage, type RelatedNote, type Source } from './types'

export type PhotoNoteStage = 'reading' | 'context' | 'writing' | 'saving'

export interface PhotoNoteInput {
  workspaceId?: string
  images: Uint8Array[]
  /** Investigar en internet (si el administrador lo permite). Por defecto, sí. */
  research?: boolean
  instructions?: string
}

export interface PhotoNoteDeps {
  /** Fábrica del proveedor (los tests pasan uno simulado). */
  createProvider?: AiProviderFactory
  /** Avisa de cada etapa, para mostrar el progreso. */
  onStage?: (stage: PhotoNoteStage, info: { research: boolean }) => void
  now?: () => Date
}

export interface PhotoNoteResult {
  document: DocumentSummary
  folderId: string
  researched: boolean
  usage: AiUsage
}

const MAX_INSTRUCTIONS = 1000
/** Intentos al día (creados, rechazados o fallidos) por cada nota permitida. */
const MAX_ATTEMPTS_FACTOR = 3

/** Alguna foto no está escrita a mano: no se transcribe nada. */
export class NotHandwrittenError extends UnprocessableError {
  constructor(readonly photos: { photo: number; reason: string }[]) {
    const nums = photos.map((p) => p.photo)
    const list = nums.length === 1 ? `la foto ${nums[0]} no es un documento` : `las fotos ${joinNumbers(nums)} no son documentos`
    super(`No es posible transcribir: ${list} escrito${nums.length === 1 ? '' : 's'} a mano.`, { reason: 'not_handwritten', photos })
  }
}

/** Ya se alcanzó el límite diario de notas con IA. */
export class AiDailyLimitError extends WickError {
  constructor(limit: number, retryAfterSeconds: number) {
    super(`Ya creaste ${limit} ${limit === 1 ? 'nota' : 'notas'} con IA hoy, el máximo diario. Mañana podrás crear más.`, 'RATE_LIMITED', {
      reason: 'daily_limit',
      retryAfterSeconds,
    })
  }
}

function joinNumbers(nums: number[]): string {
  return nums.length === 1 ? String(nums[0]) : `${nums.slice(0, -1).join(', ')} y ${nums.at(-1)}`
}

export async function createNoteFromPhotos(actor: AuthUser, input: PhotoNoteInput, deps: PhotoNoteDeps = {}): Promise<PhotoNoteResult> {
  requireActor(actor)
  const now = deps.now ?? (() => new Date())
  const { settings, apiKey } = await loadAiRuntime()
  if (!settings.enabled || !apiKey) throw new UnavailableError('«Nota desde foto» no está activada en este servidor', { reason: 'disabled' })

  const workspaceId = input.workspaceId ?? (await defaultWorkspaceId(actor))
  await requireWorkspaceAccess(actor, workspaceId, 'write')
  const images = await preparePhotos(input.images)
  const instructions = input.instructions?.trim() || undefined
  if (instructions && instructions.length > MAX_INSTRUCTIONS) {
    throw new ValidationError(`Las indicaciones no pueden superar ${MAX_INSTRUCTIONS} caracteres`)
  }

  const provider: AiProvider = (deps.createProvider ?? createAiProvider)({ provider: settings.provider, apiKey, model: settings.model })
  const research = input.research !== false && settings.webSearch && provider.capabilities.webSearch

  // Límite diario: se reserva el cupo antes de enviar nada al proveedor.
  const runId = await reserveRun(actor, settings.dailyLimit, now(), {
    workspaceId,
    provider: provider.id,
    model: provider.model,
    images: images.length,
  })
  const usage: AiUsage = { inputTokens: 0, outputTokens: 0, webSearches: 0 }
  const add = (u: AiUsage) => {
    usage.inputTokens += u.inputTokens
    usage.outputTokens += u.outputTokens
    usage.webSearches += u.webSearches
  }
  const record = (status: 'CREATED' | 'REJECTED' | 'FAILED', extra: { documentId?: string; error?: string } = {}) =>
    getPrisma().aiRun.update({
      where: { id: runId },
      data: {
        status,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        webSearches: usage.webSearches,
        documentId: extra.documentId ?? null,
        error: extra.error?.slice(0, 500) ?? null,
      },
    })

  try {
    // 1. Lectura
    deps.onStage?.('reading', { research })
    const read = await provider.readPhotos(images, instructions)
    add(read.usage)
    const { reading } = read
    // Sin un veredicto por foto no se puede saber si todas están escritas a mano.
    if (reading.photos.length !== images.length) {
      throw new AiProviderError('La respuesta del modelo no tiene el formato esperado.', 'invalid_response')
    }
    const rejected = reading.photos
      .map((verdict, i) => ({ photo: i + 1, ...verdict }))
      .filter((p) => !p.handwritten)
      .map((p) => ({ photo: p.photo, reason: p.reason }))
    if (rejected.length) {
      await record('REJECTED', { error: `not_handwritten: ${rejected.map((r) => r.photo).join(',')}` })
      throw new NotHandwrittenError(rejected)
    }
    if (!reading.hasContent || !reading.transcription.trim()) {
      await record('REJECTED', { error: 'no_content' })
      throw new UnprocessableError('No se encontró texto legible en las fotos.', { reason: 'no_content' })
    }

    // 2. Contexto
    deps.onStage?.('context', { research })
    const related = await findRelatedNotes(actor, workspaceId, reading.keyTerms)

    // 3. Redacción (e investigación)
    deps.onStage?.('writing', { research })
    const composed = await provider.composeNote({ reading, related, instructions, research, maxSearches: settings.maxSearches })
    add(composed.usage)

    // 4. Guardar
    deps.onStage?.('saving', { research })
    const markdown = finishMarkdown(composed.markdown, composed.sources, {
      photos: images.length,
      model: provider.model,
      date: now(),
    })
    const title = reading.title.replace(/\s+/g, ' ').trim().slice(0, 200) || DEFAULT_TITLE
    const folderId = await userFolder(actor, workspaceId)
    const document = await createDocument(actor, { title, workspaceId, folderId }, stateFromMarkdown(markdown))
    await record('CREATED', { documentId: document.id })
    return { document, folderId, researched: research, usage }
  } catch (err) {
    if (err instanceof NotHandwrittenError || (err instanceof UnprocessableError && (err.details as { reason?: string })?.reason === 'no_content')) {
      throw err
    }
    if (err instanceof AiProviderError) {
      await record('FAILED', { error: `${err.kind}: ${err.message}` })
      if (err.kind === 'refused') throw new UnprocessableError(err.message, { reason: 'refused' })
      throw new UnavailableError(err.message, { reason: err.kind })
    }
    await record('FAILED', { error: err instanceof Error ? err.message : String(err) }).catch(() => {})
    throw err
  }
}

/**
 * Reserva el cupo del día con una fila PENDING. Va en una transacción con un
 * bloqueo por usuario, así que varias peticiones a la vez no pueden saltarse el
 * límite. Además de las notas creadas, hay un tope de intentos (rechazados o
 * fallidos incluidos) para que no se pueda gastar sin límite con fotos que no valen.
 */
async function reserveRun(
  actor: AuthUser,
  dailyLimit: number,
  now: Date,
  data: { workspaceId: string; provider: string; model: string; images: number },
): Promise<string> {
  const tomorrow = startOfDay(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const retryAfter = Math.ceil((tomorrow.getTime() - now.getTime()) / 1000)
  return getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-run:${actor.id}`}))::text`
    if ((await countAiNotesToday(actor.id, now, tx)) >= dailyLimit) throw new AiDailyLimitError(dailyLimit, retryAfter)
    const attempts = await tx.aiRun.count({ where: { userId: actor.id, createdAt: { gte: startOfDay(now) } } })
    if (attempts >= dailyLimit * MAX_ATTEMPTS_FACTOR) {
      throw new WickError('Demasiados intentos de «Nota desde foto» hoy. Mañana podrás volver a intentarlo.', 'RATE_LIMITED', {
        reason: 'too_many_attempts',
        retryAfterSeconds: retryAfter,
      })
    }
    const run = await tx.aiRun.create({ data: { userId: actor.id, status: 'PENDING', createdAt: now, ...data }, select: { id: true } })
    return run.id
  })
}

/**
 * Notas relacionadas: se busca cada palabra clave por separado (la búsqueda exige
 * todas las palabras) y se quedan las que coinciden con más palabras.
 */
async function findRelatedNotes(actor: AuthUser, workspaceId: string, keyTerms: string[]): Promise<RelatedNote[]> {
  const terms = [...new Set(keyTerms.map((t) => t.trim()).filter((t) => t.length >= 3))].slice(0, 6)
  const found = new Map<string, { note: RelatedNote; hits: number }>()
  for (const term of terms) {
    // Solo del espacio de destino: la nota creada no debe revelar notas de otros espacios.
    for (const r of await searchDocuments(actor, term, { limit: 5, workspaceId })) {
      const entry = found.get(r.id)
      if (entry) entry.hits++
      else found.set(r.id, { note: { id: r.id, title: r.title, snippet: r.snippet.slice(0, 240) }, hits: 1 })
    }
  }
  return [...found.values()]
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 5)
    .map((e) => e.note)
}

/** Quita un `# Título` inicial y las imágenes, añade las fuentes si el modelo no las listó y el pie. */
export function finishMarkdown(raw: string, sources: Source[], meta: { photos: number; model: string; date: Date }): string {
  // Ninguna imagen: el editor las carga solas al abrir la nota, y una URL puesta
  // por una inyección de instrucciones podría filtrar datos. Quedan como enlace.
  let markdown = splitTitleFromMarkdown(raw)
    .body.replace(/!\[([^\]]*)\]\(([^)]*)\)/g, (_, alt: string, url: string) => `[${alt.trim() || 'imagen'}](${url})`)
    .trim()
  const missing = sources.filter((s) => !markdown.includes(s.url))
  if (sources.length && missing.length === sources.length) {
    const list = sources.map((s, i) => `${i + 1}. [${(s.title || s.url).replace(/[[\]]/g, '')}](${s.url})`).join('\n')
    markdown += `\n\n## Fuentes\n\n${list}`
  }
  const date = meta.date.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })
  const photos = meta.photos === 1 ? 'una foto' : `${meta.photos} fotos`
  return `${markdown}\n\n---\n\n*Generada a partir de ${photos} con ${meta.model} el ${date}. Revisa el contenido antes de darlo por bueno.*\n`
}

/**
 * Carpeta del usuario en el espacio: en su raíz, con el nombre del usuario. wick
 * recuerda cuál es (AiUserFolder), así que sigue valiendo aunque la renombren o
 * la muevan; si la borran, se crea otra. La primera vez se aprovecha una carpeta
 * de la raíz con ese nombre que no sea ya de otro usuario.
 */
export async function userFolder(actor: AuthUser, workspaceId: string): Promise<string> {
  const prisma = getPrisma()
  const key = { userId_workspaceId: { userId: actor.id, workspaceId } }
  const known = await prisma.aiUserFolder.findUnique({ where: key, select: { folderId: true } })
  if (known) return known.folderId

  const name = (actor.name.trim() || actor.username).slice(0, 120)
  const existing = await prisma.folder.findFirst({
    where: { workspaceId, parentId: null, name, aiOwners: { none: {} } },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  })
  const folderId = existing?.id ?? (await prisma.folder.create({ data: { workspaceId, name }, select: { id: true } })).id
  try {
    await prisma.aiUserFolder.create({ data: { userId: actor.id, workspaceId, folderId } })
    return folderId
  } catch (err) {
    // Otra petición del mismo usuario la creó a la vez: se usa esa.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      if (!existing) await prisma.folder.delete({ where: { id: folderId } }).catch(() => {})
      const winner = await prisma.aiUserFolder.findUnique({ where: key, select: { folderId: true } })
      if (winner) return winner.folderId
    }
    throw err
  }
}

