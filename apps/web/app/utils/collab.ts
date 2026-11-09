export interface CollabIdentity {
  name: string
  color: string
}

/** Otro colaborador conectado al mismo documento. */
export interface Peer {
  clientId: number
  name: string
  color: string
}

export type SyncStatus = 'connecting' | 'syncing' | 'synced' | 'offline' | 'unavailable'

const NAMES = ['Búho', 'Zorro', 'Lince', 'Nutria', 'Garza', 'Tejón', 'Halcón', 'Ciervo', 'Colibrí', 'Ardilla']
const COLORS = ['#e11d48', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#ea580c']
const STORAGE_KEY = 'wick:identity'

const pick = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)]!

/**
 * Nombre y color con los que este navegador aparece ante otros colaboradores.
 * Provisional hasta que existan usuarios: se recuerda en el navegador si se puede.
 */
export function getCollabIdentity(): CollabIdentity {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as CollabIdentity | null
    if (saved?.name && saved?.color) return saved
  } catch {
    // Almacenamiento no disponible: se usa una identidad nueva en cada visita.
  }
  const identity = { name: `${pick(NAMES)} anónimo`, color: pick(COLORS) }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(identity))
  } catch {
    // Ignorado a propósito.
  }
  return identity
}

/** URL del servidor de colaboración vista desde el navegador. */
export function resolveCollabUrl(configured: string, port: number | string): string {
  if (configured) return configured
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.hostname}:${port}`
}
