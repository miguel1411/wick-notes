export interface CollabIdentity {
  /** Id de la cuenta: permite agrupar varias pestañas de la misma persona. */
  userId: string
  name: string
  color: string
}

/** Otro colaborador conectado al mismo documento. */
export interface Peer {
  clientId: number
  userId: string
  name: string
  color: string
}

export type SyncStatus = 'connecting' | 'syncing' | 'synced' | 'offline' | 'unavailable'

const COLORS = ['#e11d48', '#d97706', '#16a34a', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#ea580c', '#0d9488', '#65a30d']

/** Color estable para cada usuario (el mismo en avatares y cursores, en todas las pestañas). */
export function userColor(userId: string): string {
  let h = 0
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]!
}

export function collabIdentity(user: { id: string; name: string }): CollabIdentity {
  return { userId: user.id, name: user.name, color: userColor(user.id) }
}

/** URL del servidor de colaboración vista desde el navegador. */
export function resolveCollabUrl(configured: string, port: number | string): string {
  if (configured) return configured
  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${protocol}://${window.location.hostname}:${port}`
}

/**
 * Contenido de una nota en Yjs: texto Markdown en un Y.Text con este nombre.
 * Igual que CONTENT_KEY y CONTENT_FORMAT de @wick/core (content.ts).
 */
export const COLLAB_CONTENT_KEY = 'markdown'
/** Formato que el editor anuncia al conectarse; el servidor rechaza otros. */
export const COLLAB_CONTENT_FORMAT = 'markdown-v1'
