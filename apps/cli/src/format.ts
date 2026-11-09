import type { IO } from './io'

export function colors(io: IO) {
  const on = io.stdoutIsTTY && !io.env.NO_COLOR && io.env.TERM !== 'dumb'
  const wrap = (code: number) => (s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s)
  return { dim: wrap(2), bold: wrap(1), red: wrap(31), green: wrap(32), yellow: wrap(33), cyan: wrap(36) }
}

const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' })

/** «hace 5 minutos», «ayer», «hace 3 meses»… */
export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return 'ahora'
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['minute', 60],
    ['hour', 3600],
    ['day', 86400],
    ['month', 2_592_000],
    ['year', 31_536_000],
  ]
  let [unit, size] = units[0]!
  for (const [u, s] of units) if (abs >= s) [unit, size] = [u, s]
  return rtf.format(Math.round(seconds / size), unit)
}

/** Recorta a `width` columnas con «…». */
export function truncate(text: string, width: number): string {
  const chars = [...text]
  return chars.length <= width ? text : chars.slice(0, Math.max(1, width - 1)).join('') + '…'
}

export function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - [...text].length))
}
