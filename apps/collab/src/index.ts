import { disconnectPrisma } from '@wick/db'
import { createCollabServer } from './server'

const port = Number(process.env.COLLAB_INTERNAL_PORT ?? process.env.COLLAB_PORT ?? 3121)
// Docker define COLLAB_HOST=0.0.0.0. En desarrollo: DEV_HOST (.env) o solo esta máquina.
const address = process.env.COLLAB_HOST || process.env.DEV_HOST || '127.0.0.1'

const server = createCollabServer({ port, address })

// Cierre ordenado: primero se guardan los documentos abiertos, luego se cierra la BD.
let stopping = false
async function shutdown(signal: string) {
  if (stopping) return
  stopping = true
  console.log(`[collab] ${signal} recibido; guardando documentos abiertos…`)
  try {
    await server.destroy()
  } finally {
    await disconnectPrisma()
    process.exit(0)
  }
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGQUIT'] as const) {
  process.once(signal, () => void shutdown(signal))
}

await server.listen()
console.log(`[collab] escuchando en ws://${address}:${port}`)
