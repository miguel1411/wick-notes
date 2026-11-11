/** Lado largo máximo que aprovecha el modelo; más resolución solo pesa más. */
const MAX_SIDE = 2576

/**
 * Prepara una foto para enviarla: la reduce a un máximo de 2576 px en el lado
 * largo y la vuelve a codificar como JPEG. Así la subida es ligera y las fotos
 * HEIC del iPhone (que Safari sabe abrir) llegan en un formato aceptado.
 * El navegador ya aplica la orientación EXIF al dibujarla.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.decoding = 'async'
    img.src = url
    await img.decode()
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const width = Math.max(1, Math.round(img.naturalWidth * scale))
    const height = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Sin canvas 2D')
    ctx.fillStyle = '#fff' // fondo blanco para PNG con transparencia
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('No se pudo codificar'))), 'image/jpeg', 0.85),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
