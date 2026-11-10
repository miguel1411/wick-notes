/** Número de movimientos propuestos por agentes que esperan aprobación. */
export function usePendingMoves() {
  const requestFetch = useRequestFetch()
  const { data, refresh } = useAsyncData('move-count', () => requestFetch<{ pending: number }>('/api/move-requests/count'), {
    default: () => ({ pending: 0 }),
  })
  return { pending: computed(() => data.value.pending), refresh }
}
