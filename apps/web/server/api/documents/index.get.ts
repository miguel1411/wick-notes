import { listDocuments } from '@wick/core'

/** ?q= filtra por título; ?limit= limita el número de resultados. */
export default defineEventHandler((event) => {
  const { q, limit } = getQuery(event)
  return runCore(
    () =>
      listDocuments(requireUser(event), {
        query: typeof q === 'string' ? q : undefined,
        limit: typeof limit === 'string' ? Number(limit) || undefined : undefined,
      }),
    event,
  )
})
