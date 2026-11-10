/**
 * Copia texto al portapapeles. Devuelve false si no se pudo.
 *
 * `navigator.clipboard` solo existe en contextos seguros (HTTPS o localhost). Si wick se
 * abre por http://IP:puerto (p. ej. por Tailscale), se usa el método clásico con execCommand.
 *
 * Acepta una promesa para llamarla en el mismo clic y descargar el texto después:
 * Safari solo deja escribir en el portapapeles durante el propio clic.
 */
export async function copyText(text: string | Promise<string>): Promise<boolean> {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      try {
        if (typeof text !== 'string' && typeof ClipboardItem !== 'undefined') {
          const blob = text.then((t) => new Blob([t], { type: 'text/plain' }))
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
        } else {
          await navigator.clipboard.writeText(await text)
        }
        return true
      } catch {
        // Permiso denegado u otro fallo: se prueba el método clásico.
      }
    }
    return legacyCopy(await text)
  } catch {
    return false
  }
}

function legacyCopy(text: string): boolean {
  const active = document.activeElement as HTMLElement | null
  const el = document.createElement('textarea')
  el.value = text
  el.setAttribute('readonly', '')
  el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0'
  // Dentro del diálogo abierto, si lo hay: su trampa de foco robaría el foco al textarea.
  ;(active?.closest('[role="dialog"]') ?? document.body).appendChild(el)
  el.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    el.remove()
    active?.focus({ preventScroll: true })
  }
}
