<script setup lang="ts">
import { HocuspocusProvider } from '@hocuspocus/provider'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { collab, collabServiceCtx } from '@milkdown/plugin-collab'
import * as Y from 'yjs'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/frame.css'

const props = defineProps<{ documentId: string }>()
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
let crepe: Crepe | undefined

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

  // El editor se crea en paralelo a la primera sincronización, pero solo se enlaza
  // al documento Yjs cuando el servidor ya entregó su contenido: así nunca se
  // muestra (ni se reenvía) un documento vacío por encima del real.
  const firstSync = new Promise<void>((resolve) => {
    if (provider!.isSynced) return resolve()
    provider!.on('synced', () => resolve())
  })

  // Sin contenedor, Crepe se montaría en <body>: mejor fallar de forma visible.
  if (!root.value) throw new Error('CollabEditor: el contenedor del editor no está montado')

  crepe = new Crepe({
    root: root.value,
    defaultValue: '',
    features: {
      // La IA es opcional y no se activa sin configuración explícita (PRODUCT.md §5.6).
      [CrepeFeature.AI]: false,
      // La subida local crea URLs blob: que otros colaboradores no pueden ver.
      [CrepeFeature.ImageBlock]: false,
      [CrepeFeature.TopBar]: false,
    },
    featureConfigs: {
      [CrepeFeature.Placeholder]: { text: 'Escribe algo, o pulsa / para ver los bloques…', mode: 'doc' },
    },
  })
  crepe.editor.use(collab)

  await Promise.all([crepe.create(), firstSync])
  if (!crepe || !ydoc || !provider) return // desmontado mientras cargaba

  crepe.editor.action((ctx) => {
    ctx.get(collabServiceCtx).bindDoc(ydoc!).setAwareness(awareness!).connect()
  })
  ready.value = true
  emitPeers()
})

onBeforeUnmount(() => {
  const editor = crepe
  const p = provider
  const d = ydoc
  crepe = provider = ydoc = undefined

  // Orden importante: crepe.destroy() es asíncrono y, mientras termina, los plugins de
  // Yjs (sincronía y cursores) seguirían enviando cambios a un editor medio destruido.
  // 1) Desenganchar la colaboración del editor, 2) cerrar conexión y documento Yjs,
  // 3) destruir el editor.
  if (ready.value) {
    try {
      editor?.editor.action((ctx) => ctx.get(collabServiceCtx).disconnect())
    } catch {
      // El editor ya no está disponible: no hay nada que desenganchar.
    }
  }
  p?.destroy()
  d?.destroy()
  void editor?.destroy()
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
