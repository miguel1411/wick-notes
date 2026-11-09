/** Entrada/salida inyectable, para poder probar los comandos sin tocar el proceso real. */
export interface IO {
  stdout: (text: string) => void
  stderr: (text: string) => void
  env: NodeJS.ProcessEnv
  cwd: string
  /** true si stdin es una terminal (no hay nada canalizado). */
  stdinIsTTY: boolean
  /** true si stdout es una terminal (para colores y anchos). */
  stdoutIsTTY: boolean
  columns: number
  readStdin: () => Promise<string>
  /** Líneas de stdin según llegan (para el puente MCP). */
  stdinLines: () => AsyncIterable<string>
  /** Pregunta en la terminal. `hidden` no muestra lo que se escribe. */
  prompt: (question: string, options?: { hidden?: boolean }) => Promise<string>
}

export class UsageError extends Error {}
export class CliError extends Error {}
