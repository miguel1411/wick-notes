import { searchDocuments } from '@wick/core'

/** Búsqueda en título y contenido: ?q=texto&limit=20 */
export default defineEventHandler((event) => {
  const { q, limit } = getQuery(event)
  return runCore(
    () =>
      searchDocuments(requireUser(event), typeof q === 'string' ? q : '', {
        limit: typeof limit === 'string' ? Number(limit) || undefined : undefined,
      }),
    event,
  )
})
