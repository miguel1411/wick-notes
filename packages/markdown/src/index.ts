import { Worker } from 'node:worker_threads'

/** Tamaño máximo de un documento Markdown que se acepta convertir (2 MB). */
export const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024

const CALL_TIMEOUT_MS = 30_000

interface Pending {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Conversión Markdown ↔ estado Yjs con el mismo esquema que el editor web.
 *
 * Todo el trabajo ocurre en un hilo aparte (ver worker.ts). Las peticiones se
 * encolan; si el hilo falla, se rechazan las pendientes y se arranca uno nuevo.
 */
export class MarkdownConverter {
  #worker: Worker | undefined
  #ready: Promise<void> | undefined
  #pending = new Map<number, Pending>()
  #seq = 0

  #start(): Promise<void> {
    if (this.#ready) return this.#ready
    const worker = new Worker(new URL('./worker.ts', import.meta.url))
    this.#worker = worker
    this.#ready = new Promise<void>((resolve, reject) => {
      const onReady = (msg: { ready?: boolean }) => {
        if (msg.ready) {
          worker.off('message', onReady)
          resolve()
        }
      }
      worker.on('message', onReady)
      worker.once('error', reject)
    })

    worker.on('message', (msg: { id?: number; ok?: boolean; result?: unknown; error?: string }) => {
      if (msg.id === undefined) return
      const pending = this.#pending.get(msg.id)
      if (!pending) return
      this.#pending.delete(msg.id)
      clearTimeout(pending.timer)
      if (msg.ok) pending.resolve(msg.result)
      else pending.reject(new Error(`Conversión Markdown fallida: ${msg.error}`))
    })
    const fail = (err: Error) => {
      for (const p of this.#pending.values()) {
        clearTimeout(p.timer)
        p.reject(err)
      }
      this.#pending.clear()
      this.#worker = undefined
      this.#ready = undefined
    }
    worker.on('error', (err) => fail(err))
    worker.on('exit', (code) => fail(new Error(`El hilo de conversión terminó (código ${code})`)))
    // No mantener vivo el proceso solo por este hilo.
    worker.unref()
    return this.#ready
  }

  async #call<T>(message: Record<string, unknown>): Promise<T> {
    await this.#start()
    const id = ++this.#seq
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new Error('La conversión Markdown tardó demasiado'))
      }, CALL_TIMEOUT_MS)
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.#worker!.postMessage({ id, ...message })
    })
  }

  /** Markdown del documento con este estado Yjs ('' si está vacío). */
  toMarkdown(state: Uint8Array | null): Promise<string> {
    return this.#call({ op: 'toMarkdown', state })
  }

  /** Estado Yjs completo de un documento nuevo con este Markdown. */
  fromMarkdown(markdown: string): Promise<Uint8Array> {
    return this.#call({ op: 'fromMarkdown', markdown })
  }

  /** Cambios Yjs que convierten el estado dado en `markdown` (aplicables a un documento vivo). */
  replaceUpdate(state: Uint8Array | null, markdown: string): Promise<Uint8Array> {
    return this.#call({ op: 'replaceUpdate', state, markdown })
  }

  /** Cambios Yjs que añaden `markdown` al final del estado dado. */
  appendUpdate(state: Uint8Array | null, markdown: string): Promise<Uint8Array> {
    return this.#call({ op: 'appendUpdate', state, markdown })
  }

  /** Cambios Yjs que llevan el estado actual al contenido de otra versión (`target`). */
  restoreUpdate(state: Uint8Array | null, target: Uint8Array): Promise<Uint8Array> {
    return this.#call({ op: 'restoreUpdate', state, target })
  }

  /** Para el hilo (tests y cierre ordenado). */
  async close(): Promise<void> {
    const worker = this.#worker
    this.#worker = undefined
    this.#ready = undefined
    if (worker) await worker.terminate()
  }
}

let shared: MarkdownConverter | undefined

/** Conversor compartido por todo el proceso. */
export function getMarkdownConverter(): MarkdownConverter {
  shared ??= new MarkdownConverter()
  return shared
}
