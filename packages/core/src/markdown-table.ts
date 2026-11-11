/**
 * Fila separadora de una tabla Markdown (`|:---|:-:|------:|`): alineación y
 * ancho de cada columna. Sin dependencias: la usan el editor (en el navegador)
 * y el PDF.
 *
 * Anchos (convención de Pandoc): si las columnas tienen distinto número de
 * guiones, cada una ocupa una parte del ancho proporcional a sus guiones y la
 * tabla ocupa todo el ancho. Si tienen los mismos, como en `|---|:---:|---:|`
 * (los dos puntos de la alineación no cuentan), la tabla se ajusta al contenido.
 */

export type TableAlign = 'left' | 'center' | 'right' | null

export interface TableDelimiter {
  align: TableAlign[]
  /** Peso de cada columna (sus guiones), o null si la tabla se ajusta al contenido. */
  widths: number[] | null
}

export function parseTableDelimiter(row: string): TableDelimiter {
  const segments = row
    // Dentro de una cita o una lista, la línea empieza por `>` o por la sangría.
    .replace(/^[\s>]*/, '')
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((s) => s.trim())

  const align = segments.map((s): TableAlign => {
    const left = s.startsWith(':')
    const right = s.endsWith(':')
    return left && right ? 'center' : right ? 'right' : left ? 'left' : null
  })
  const lengths = segments.map((s) => Math.max(1, s.replace(/[^-]/g, '').length))
  const widths = lengths.length > 1 && lengths.some((n) => n !== lengths[0]) ? lengths : null
  return { align, widths }
}
