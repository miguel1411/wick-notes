import { ApiError, type NoteSummary, type WickApi } from './api'
import { CliError } from './io'

const CUID = /^c[a-z0-9]{24}$/

/**
 * Encuentra una nota a partir de lo que escribe el usuario:
 * id completo, principio del id (4+ caracteres) o título (exacto o parcial).
 * Si hay varias candidatas, pide concretar.
 */
export async function resolveNote(api: WickApi, ref: string): Promise<NoteSummary> {
  const needle = ref.trim()
  if (!needle) throw new CliError('Indica una nota (id o título)')

  if (CUID.test(needle)) {
    try {
      return await api.get(needle)
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 404)) throw err
    }
  }

  const notes = await api.list()
  const lower = needle.toLowerCase()
  const byPrefix = needle.length >= 4 ? notes.filter((n) => n.id.startsWith(needle)) : []
  if (byPrefix.length === 1) return byPrefix[0]!

  const exact = notes.filter((n) => n.title.toLowerCase() === lower)
  if (exact.length === 1) return exact[0]!

  const partial = exact.length ? exact : notes.filter((n) => n.title.toLowerCase().includes(lower))
  const candidates = byPrefix.length > 1 ? byPrefix : partial
  if (candidates.length === 1) return candidates[0]!
  if (candidates.length === 0) throw new CliError(`No hay ninguna nota que coincida con «${needle}»`)

  const list = candidates
    .slice(0, 10)
    .map((n) => `  ${n.id}  ${n.title}`)
    .join('\n')
  const more = candidates.length > 10 ? `\n  … y ${candidates.length - 10} más` : ''
  throw new CliError(`«${needle}» coincide con ${candidates.length} notas; usa el id:\n${list}${more}`)
}
