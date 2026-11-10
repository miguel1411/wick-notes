import { createHash } from 'node:crypto'

/** Cuánto vale una revisión: suficiente para que un agente piense o alguien edite en la terminal. */
const TTL_MS = 24 * 60 * 60 * 1000
/** Memoria máxima para las lecturas guardadas; se descartan primero las más antiguas. */
const MAX_BYTES = 64 * 1024 * 1024

/**
 * Lecturas recientes de las notas, para fusionar después.
 *
 * Quien lee una nota para reescribirla (un agente, `wick notes edit`) recibe una
 * revisión. Al escribir la devuelve, y el cambio se calcula sobre lo que leyó:
 * así no borra lo que otras personas escribieron mientras tanto.
 *
 * Viven en memoria: tras reiniciar el servidor de colaboración, o pasado un día,
 * la revisión deja de valer y hay que volver a leer la nota (nunca se pisa nada).
 */
export class RevisionStore {
  private entries = new Map<string, { documentId: string; state: Uint8Array; at: number }>()
  private bytes = 0

  constructor(private readonly limits = { ttlMs: TTL_MS, maxBytes: MAX_BYTES }) {}

  /** Guarda el estado leído y devuelve su revisión (la misma si la nota no ha cambiado). */
  remember(documentId: string, state: Uint8Array): string {
    const id = createHash('sha256').update(documentId).update('\0').update(state).digest('base64url').slice(0, 24)
    this.drop(id)
    // Al final del Map: el orden de inserción es el de antigüedad.
    this.entries.set(id, { documentId, state, at: Date.now() })
    this.bytes += state.length
    this.prune()
    return id
  }

  /** Estado de esa revisión, o null si no existe, es de otra nota o ha caducado. */
  get(documentId: string, id: string): Uint8Array | null {
    const entry = this.entries.get(id)
    if (!entry || entry.documentId !== documentId) return null
    if (Date.now() - entry.at > this.limits.ttlMs) {
      this.drop(id)
      return null
    }
    return entry.state
  }

  private drop(id: string) {
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    this.bytes -= entry.state.length
  }

  private prune() {
    const now = Date.now()
    for (const [id, entry] of this.entries) {
      if (this.bytes <= this.limits.maxBytes && now - entry.at <= this.limits.ttlMs) break
      this.drop(id)
    }
  }
}
