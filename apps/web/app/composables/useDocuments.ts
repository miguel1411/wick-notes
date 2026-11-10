/** Documento tal como lo devuelve la API (fechas serializadas). */
export interface DocumentSummary {
  id: string
  title: string
  workspaceId: string
  folderId: string | null
  createdAt: string
  updatedAt: string
  createdBy: { id: string; name: string } | null
}

export interface DocumentDetail extends DocumentSummary {
  role: WorkspaceRole
  canEdit: boolean
}

/** Notas del espacio actual y operaciones sobre ellas. */
export function useDocuments() {
  const toast = useToast()
  const { handleUnauthorized } = useAuth()
  const { current, refresh: refreshWorkspaces } = useWorkspaces()
  const requestFetch = useRequestFetch()

  const { data, refresh, status } = useAsyncData(
    'documents',
    () =>
      current.value
        ? requestFetch<DocumentSummary[]>('/api/documents', { query: { workspace: current.value.id } })
        : Promise.resolve([] as DocumentSummary[]),
    { default: () => [] as DocumentSummary[], watch: [() => current.value?.id] },
  )

  async function run<T>(action: () => Promise<T>, failTitle: string): Promise<T | undefined> {
    try {
      return await action()
    } catch (err) {
      if (apiErrorStatus(err) === 401) await handleUnauthorized()
      else toast.add({ title: failTitle, description: apiErrorMessage(err), color: 'error', icon: 'i-lucide-circle-alert' })
      return undefined
    }
  }

  /** Recarga la lista y los contadores de los espacios. */
  async function refreshAll() {
    await Promise.all([refresh(), refreshWorkspaces()])
  }

  async function createDocument(options: { title?: string; folderId?: string | null } = {}) {
    const doc = await run(
      () =>
        $fetch<DocumentSummary>('/api/documents', {
          method: 'POST',
          body: { title: options.title, workspaceId: current.value?.id, folderId: options.folderId ?? null },
        }),
      'No se pudo crear la nota',
    )
    if (!doc) return
    await refreshAll()
    await navigateTo(`/d/${doc.id}`)
  }

  async function renameDocument(id: string, title: string) {
    const url: string = `/api/documents/${id}`
    const doc = await run(() => $fetch<DocumentSummary>(url, { method: 'PATCH', body: { title } }), 'No se pudo renombrar la nota')
    if (doc) await refresh()
    return doc
  }

  async function moveDocument(id: string, target: { workspaceId: string; folderId: string | null }) {
    const url: string = `/api/documents/${id}`
    const doc = await run(() => $fetch<DocumentSummary>(url, { method: 'PATCH', body: target }), 'No se pudo mover la nota')
    if (doc) await refreshAll()
    return doc
  }

  async function deleteDocument(id: string) {
    const url: string = `/api/documents/${id}`
    const ok = await run(() => $fetch(url, { method: 'DELETE' }).then(() => true), 'No se pudo eliminar la nota')
    if (!ok) return false
    await refreshAll()
    return true
  }

  /** Importa ficheros .md como notas nuevas del espacio actual y abre la última. */
  async function importMarkdownFiles(files: File[], folderId: string | null = null) {
    const MAX = 2 * 1024 * 1024
    let last: DocumentSummary | undefined
    let imported = 0
    for (const file of files) {
      if (file.size > MAX) {
        toast.add({ title: `«${file.name}» es demasiado grande`, description: 'El máximo es 2 MB.', color: 'error', icon: 'i-lucide-circle-alert' })
        continue
      }
      const doc = await run(
        async () =>
          $fetch<DocumentSummary>('/api/documents/import', {
            method: 'POST',
            body: { markdown: await file.text(), filename: file.name, workspaceId: current.value?.id, folderId },
          }),
        `No se pudo importar «${file.name}»`,
      )
      if (doc) {
        last = doc
        imported++
      }
    }
    if (!last) return
    await refreshAll()
    toast.add({
      title: imported === 1 ? `«${last.title}» importada` : `${imported} notas importadas`,
      color: 'success',
      icon: 'i-lucide-file-down',
    })
    await navigateTo(`/d/${last.id}`)
  }

  return {
    documents: data,
    status,
    refresh,
    refreshAll,
    run,
    createDocument,
    renameDocument,
    moveDocument,
    deleteDocument,
    importMarkdownFiles,
  }
}
