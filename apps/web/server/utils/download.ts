import type { H3Event } from 'h3'

/** Marca la respuesta como fichero adjunto, con nombre ASCII de respaldo y el original en UTF-8. */
export function setAttachment(event: H3Event, filename: string) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`)
}
