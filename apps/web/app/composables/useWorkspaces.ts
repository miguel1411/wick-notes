export type WorkspaceRole = 'owner' | 'editor' | 'viewer'

export interface WorkspaceRow {
  id: string
  name: string
  everyone: boolean
  role: WorkspaceRole
  documentCount: number
  createdAt: string
}

export interface FolderRow {
  id: string
  workspaceId: string
  parentId: string | null
  name: string
}

export const canWriteIn = (role: WorkspaceRole | undefined | null) => role === 'owner' || role === 'editor'

/**
 * Espacios de trabajo del usuario y el espacio actual (recordado en una cookie
 * para que el servidor pinte la misma barra lateral), con sus carpetas.
 */
export function useWorkspaces() {
  const requestFetch = useRequestFetch()
  const currentId = useCookie<string | null>('wick_ws', { default: () => null, sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })

  const { data: workspaces, refresh } = useAsyncData('workspaces', () => requestFetch<WorkspaceRow[]>('/api/workspaces'), {
    default: () => [] as WorkspaceRow[],
  })

  const current = computed<WorkspaceRow | null>(
    () => workspaces.value.find((w) => w.id === currentId.value) ?? workspaces.value[0] ?? null,
  )
  const canWrite = computed(() => canWriteIn(current.value?.role))
  const canManage = computed(() => current.value?.role === 'owner')

  const { data: folders, refresh: refreshFolders } = useAsyncData(
    'folders',
    () => (current.value ? requestFetch<FolderRow[]>(`/api/workspaces/${current.value.id}/folders`) : Promise.resolve([])),
    { default: () => [] as FolderRow[], watch: [() => current.value?.id] },
  )

  function select(id: string) {
    currentId.value = id
  }

  return { workspaces, current, canWrite, canManage, folders, refresh, refreshFolders, select }
}
