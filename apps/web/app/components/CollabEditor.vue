<script setup lang="ts">
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HocuspocusProvider } from '@hocuspocus/provider'
import { yCollab } from 'y-codemirror.next'
import * as Y from 'yjs'
import { editorExtensions } from '~/editor/setup'

const props = defineProps<{ documentId: string; readonly?: boolean }>()
const emit = defineEmits<{
  status: [status: SyncStatus]
  peers: [peers: Peer[]]
}>()

const root = ref<HTMLElement>()
const ready = ref(false)

// Estado de la conexión, del que se deriva el indicador de sincronización.
const connected = ref(false)
const everConnected = ref(false)
const synced = ref(false)
const unsynced = ref(0)
const unavailable = ref(false)

const status = computed<SyncStatus>(() => {
  if (unavailable.value) return 'unavailable'
  if (!connected.value) return everConnected.value ? 'offline' : 'connecting'
  if (!synced.value || unsynced.value > 0) return 'syncing'
  return 'synced'
})
watch(status, (s) => emit('status', s), { immediate: true })

let ydoc: Y.Doc | undefined
let provider: HocuspocusProvider | undefined
let view: EditorView | undefined

onMounted(async () => {
  const config = useRuntimeConfig()
  const auth = useAuth()
  if (!auth.user.value) return
  const identity = collabIdentity(auth.user.value)

  ydoc = new Y.Doc()
  provider = new HocuspocusProvider({
    url: resolveCollabUrl(config.public.collabUrl, config.public.collabPort),
    name: props.documentId,
    document: ydoc,
    // El servidor rechaza editores que esperen otro formato de contenido.
    token: COLLAB_CONTENT_FORMAT,
  })
  provider.setAwarenessField('user', identity)

  provider.on('status', ({ status }: { status: string }) => {
    connected.value = status === 'connected'
    if (connected.value) everConnected.value = true
    else synced.value = false
  })
  provider.on('synced', ({ state }: { state: boolean }) => {
    synced.value = state
  })
  provider.on('unsyncedChanges', ({ number }: { number: number }) => {
    unsynced.value = number
  })
  // El servidor rechaza la conexión si la sesión ya no vale o si la nota no existe.
  provider.on('authenticationFailed', async () => {
    provider?.destroy()
    const state = await auth.refresh().catch(() => null)
    if (state && !state.user) await auth.handleUnauthorized()
    else unavailable.value = true
  })

  const awareness = provider.awareness
  const emitPeers = () => {
    if (!awareness) return
    // Una entrada por persona, aunque tenga la nota abierta en varias pestañas.
    const peers = new Map<string, Peer>()
    awareness.getStates().forEach((state, clientId) => {
      const user = state.user as Partial<CollabIdentity> | undefined
      if (clientId === awareness.clientID || !user?.name || !user.userId) return
      if (user.userId === identity.userId || peers.has(user.userId)) return
      peers.set(user.userId, { clientId, userId: user.userId, name: user.name, color: user.color ?? '#888' })
    })
    emit('peers', [...peers.values()])
  }
  awareness?.on('change', emitPeers)

  // El editor se crea cuando el servidor ya entregó el contenido: así nunca se
  // muestra (ni se reenvía) una nota vacía por encima de la real.
  if (!provider.isSynced) await new Promise<void>((resolve) => provider!.on('synced', () => resolve()))
  if (!ydoc || !provider) return // desmontado mientras cargaba

  // Sin contenedor, el editor no tendría dónde montarse: mejor fallar de forma visible.
  if (!root.value) throw new Error('CollabEditor: el contenedor del editor no está montado')

  const text = ydoc.getText(COLLAB_CONTENT_KEY)
  view = new EditorView({
    parent: root.value,
    state: EditorState.create({
      doc: text.toString(),
      extensions: [
        editorExtensions({ readonly: !!props.readonly }),
        // Sincronía con Yjs, cursores de los demás y deshacer solo lo propio.
        // Lectores: el servidor además descarta cualquier cambio que envíen.
        yCollab(text, awareness, { undoManager: new Y.UndoManager(text) }),
      ],
    }),
  })
  ready.value = true
  emitPeers()
})

onBeforeUnmount(() => {
  const v = view
  const p = provider
  const d = ydoc
  view = provider = ydoc = undefined
  // Primero el editor (deja de escuchar al documento), luego la conexión y el documento.
  v?.destroy()
  p?.destroy()
  d?.destroy()
})
</script>

<template>
  <div class="relative">
    <div v-if="!ready && !unavailable" class="space-y-3 py-6">
      <USkeleton class="h-5 w-2/3" />
      <USkeleton class="h-5 w-full" />
      <USkeleton class="h-5 w-5/6" />
    </div>
    <div ref="root" :class="{ invisible: !ready }" />
  </div>
</template>
