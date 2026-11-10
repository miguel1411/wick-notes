import { LazyConfirmDialog } from '#components'

export interface ConfirmDialogOptions {
  title: string
  description?: string
  confirmLabel: string
  confirmIcon?: string
  color?: 'primary' | 'error'
  /**
   * Lo que se hace al confirmar. Mientras corre, el botón muestra que está
   * cargando; si devuelve `false` (falló y ya se avisó), el diálogo sigue abierto.
   */
  action?: () => unknown
}

/**
 * Pide confirmación en un diálogo y devuelve si la persona confirmó
 * (y la acción, si la hay, terminó bien). Patrón de useOverlay de Nuxt UI.
 */
export function useConfirmDialog() {
  const overlay = useOverlay()
  return (options: ConfirmDialogOptions): Promise<boolean> =>
    overlay
      .create(LazyConfirmDialog, { destroyOnClose: true, props: options })
      .open()
      .then((confirmed) => confirmed === true)
}
