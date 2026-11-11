import sharp from 'sharp'
import { ValidationError } from '../errors'
import type { AiImage, ImageMediaType } from './types'

export const MAX_PHOTOS = 4
/** Lo que se acepta subir por foto (una foto de celular a tamaño completo). */
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024
/** Tamaño máximo de toda la petición con las fotos. */
export const MAX_PHOTOS_TOTAL_BYTES = MAX_PHOTOS * MAX_PHOTO_BYTES

/** Lado largo máximo que aprovecha el modelo; más resolución solo pesa más. */
const MAX_SIDE = 2576
/** Máximo por imagen que acepta Anthropic. */
const PROVIDER_MAX_BYTES = 5 * 1024 * 1024

/** Tipo real de la imagen por sus primeros bytes (no por lo que diga el navegador). */
export function detectImageType(data: Uint8Array): ImageMediaType | null {
  const b = data
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to))
  if (b.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

/**
 * Comprueba las fotos y las prepara para el proveedor: las endereza según su
 * EXIF, las reduce a 2576 px de lado largo y las vuelve a codificar como JPEG.
 * Así cualquier foto (de la web, la CLI o la API) cabe en los límites del
 * proveedor, y se pierden sus metadatos (por ejemplo, la ubicación GPS).
 * Los errores dicen qué foto falla (1, 2…).
 */
export async function preparePhotos(images: Uint8Array[]): Promise<AiImage[]> {
  if (!images.length) throw new ValidationError('Añade al menos una foto')
  if (images.length > MAX_PHOTOS) throw new ValidationError(`Como máximo ${MAX_PHOTOS} fotos por nota`)
  images.forEach((data, i) => {
    if (data.length > MAX_PHOTO_BYTES) throw new ValidationError(`La foto ${i + 1} supera los 25 MB`)
    if (!detectImageType(data)) throw new ValidationError(`La foto ${i + 1} no es una imagen JPEG, PNG o WebP`)
  })
  return Promise.all(images.map((data, i) => toJpeg(data, i + 1)))
}

async function toJpeg(data: Uint8Array, photo: number): Promise<AiImage> {
  const encode = (quality: number) =>
    sharp(data, { failOn: 'error', limitInputPixels: 100_000_000 })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality })
      .toBuffer()
  try {
    let out = await encode(85)
    if (out.length > PROVIDER_MAX_BYTES) out = await encode(70)
    return { data: new Uint8Array(out), mediaType: 'image/jpeg' }
  } catch {
    throw new ValidationError(`No se pudo leer la foto ${photo}: puede que esté dañada`)
  }
}
