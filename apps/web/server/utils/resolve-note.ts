import { canAccessDocument, getDocument, listDocuments, ValidationError, type AuthUser, type DocumentSummary } from '@wick/core'

/**
 * Encuentra una nota por id o por título (exacto o parcial, sin distinguir
 * mayúsculas). Pensado para agentes y herramientas que no conocen los ids.
 */
export async function resolveNote(actor: AuthUser, ref: string): Promise<DocumentSummary> {
  const needle = ref.trim()
  if (!needle) throw new ValidationError('Indica una nota (id o título)')
  if (await canAccessDocument(actor, needle)) return getDocument(actor, needle)

  const all = await listDocuments(actor)
  const lower = needle.toLowerCase()
  const exact = all.filter((d) => d.title.toLowerCase() === lower)
  if (exact.length === 1) return exact[0]!
  const candidates = exact.length ? exact : all.filter((d) => d.title.toLowerCase().includes(lower))
  if (candidates.length === 1) return candidates[0]!
  if (!candidates.length) throw new ValidationError(`Ninguna nota coincide con «${needle}». Usa notes_search o notes_list para encontrarla.`)
  const list = candidates
    .slice(0, 10)
    .map((d) => `- ${d.title} (id: ${d.id})`)
    .join('\n')
  throw new ValidationError(`«${needle}» coincide con ${candidates.length} notas. Usa el id:\n${list}`)
}
