/** Evento de ventana que abre el visor de diagramas (DiagramViewer.vue) desde el editor. */
export const OPEN_DIAGRAM_EVENT = 'wick:open-diagram'

export interface OpenDiagramDetail {
  /** SVG ya dibujado por Mermaid (modo 'strict', limpio). */
  svg: string
  /** id del <svg>: el visor lo cambia para no duplicar ids en la página. */
  id: string
}
