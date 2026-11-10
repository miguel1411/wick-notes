import { LazyMarkdownGuide, LazyShortcutsModal } from '#components'

type Overlay = ReturnType<ReturnType<typeof useOverlay>['create']>

// Una sola instancia de cada panel para toda la app (se crean al abrirlos por
// primera vez, siempre en el navegador), aunque se abran desde varios sitios.
let shortcuts: Overlay | undefined
let guide: Overlay | undefined

/** Ayuda: atajos de teclado y guía de Markdown. */
export function useHelp() {
  const overlay = useOverlay()
  return {
    openShortcuts() {
      shortcuts ??= overlay.create(LazyShortcutsModal)
      shortcuts.open()
    },
    /** La guía no bloquea la página: el mismo botón la abre y la cierra. */
    toggleMarkdownGuide() {
      guide ??= overlay.create(LazyMarkdownGuide)
      if (overlay.isOpen(guide.id)) guide.close()
      else guide.open()
    },
  }
}
