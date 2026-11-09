/** Documento tal como lo devuelve la API (fechas serializadas). */
export interface DocumentSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

function errorMessage(err: unknown): string {
  const e = err as { data?: { statusMessage?: string; message?: string }; statusMessage?: string; message?: string }
  return e?.data?.statusMessage ?? e?.statusMessage ?? e?.data?.message ?? e?.message ?? 'Error inesperado'
}

/** Lista de documentos compartida por toda la app y operaciones sobre ella. */
export function useDocuments() {
  const toast = useToast()
  const { data, refresh, status } = useFetch<DocumentSummary[]>('/api/documents', {
    key: 'documents',
    default: () => [],
  })

  async function run<T>(action: () => Promise<T>, failTitle: string): Promise<T | undefined> {
    try {
      return await action()
    } catch (err) {
      toast.add({ title: failTitle, description: errorMessage(err), color: 'error', icon: 'i-lucide-circle-alert' })
      return undefined
    }
  }

  async function createDocument(title?: string) {
    const doc = await run(
      () => $fetch<DocumentSummary>('/api/documents', { method: 'POST', body: { title } }),
      'No se pudo crear la nota',
    )
    if (!doc) return
    await refresh()
    await navigateTo(`/d/${doc.id}`)
  }

  async function renameDocument(id: string, title: string) {
    const doc = await run(
      () => $fetch<DocumentSummary>(`/api/documents/${id}`, { method: 'PATCH', body: { title } }),
      'No se pudo renombrar la nota',
    )
    if (doc) await refresh()
    return doc
  }

  async function deleteDocument(id: string) {
    const ok = await run(
      () => $fetch(`/api/documents/${id}`, { method: 'DELETE' }).then(() => true),
      'No se pudo eliminar la nota',
    )
    if (!ok) return false
    await refresh()
    return true
  }

  return { documents: data, status, refresh, createDocument, renameDocument, deleteDocument }
}
