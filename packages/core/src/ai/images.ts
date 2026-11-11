import { ValidationError } from '../errors'
import type { AiImage, ImageMediaType } from './types'

export const MAX_PHOTOS = 4
/** El máximo por imagen que acepta Anthropic. La web ya las reduce antes de enviarlas. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024
/** Entre todas: en base64 deben caber en una petición al proveedor (32 MB en Anthropic). */
export const MAX_PHOTOS_TOTAL_BYTES = 20 * 1024 * 1024

/** Tipo real de la imagen por sus primeros bytes (no por lo que diga el navegador). */
export function detectImageType(data: Uint8Array): ImageMediaType | null {
  const b = data
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to))
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

/** Comprueba número, tamaño y tipo de las fotos. Los errores dicen qué foto falla (1, 2…). */
export function validatePhotos(images: Uint8Array[]): AiImage[] {
  if (!images.length) throw new ValidationError('Añade al menos una foto')
  if (images.length > MAX_PHOTOS) throw new ValidationError(`Como máximo ${MAX_PHOTOS} fotos por nota`)
  const photos = images.map((data, i): AiImage => {
    if (data.length > MAX_PHOTO_BYTES) {
      throw new ValidationError(`La foto ${i + 1} supera los 5 MB. Redúcela (por ejemplo, a 2576 px de lado largo).`)
    }
    const mediaType = detectImageType(data)
    if (!mediaType) throw new ValidationError(`La foto ${i + 1} no es una imagen JPEG, PNG o WebP`)
    return { data, mediaType }
  })
  const total = images.reduce((sum, d) => sum + d.length, 0)
  if (total > MAX_PHOTOS_TOTAL_BYTES) throw new ValidationError('Entre todas, las fotos superan los 20 MB')
  return photos
}
