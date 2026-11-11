/**
 * Capa de proveedores de IA. El resto de wick solo conoce esta interfaz, así que
 * añadir otro proveedor (por ejemplo, un modelo local compatible con OpenAI) es
 * escribir otra implementación, sin tocar el proceso de «Nota desde foto».
 */

export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/webp'

export interface AiImage {
  data: Uint8Array
  mediaType: ImageMediaType
}

/** Resultado de leer las fotos (primera llamada al modelo). */
export interface PhotoReading {
  /** Una entrada por foto, en el mismo orden en que se enviaron. */
  photos: { handwritten: boolean; reason: string }[]
  /** false si no hay nada legible que transcribir. */
  hasContent: boolean
  title: string
  /** Idioma del contenido (código ISO 639-1, p. ej. «es»). */
  language: string
  /** Transcripción fiel en Markdown; lo ilegible, como [ilegible]. */
  transcription: string
  keyTerms: string[]
}

/** Nota de wick relacionada que se da como contexto (solo título y fragmento). */
export interface RelatedNote {
  id: string
  title: string
  snippet: string
}

export interface ComposeInput {
  reading: PhotoReading
  related: RelatedNote[]
  instructions?: string
  /** ¿Puede buscar en internet? */
  research: boolean
  maxSearches: number
}

export interface Source {
  url: string
  title: string | null
}

export interface AiUsage {
  inputTokens: number
  outputTokens: number
  webSearches: number
}

export interface AiProvider {
  /** Identificador del proveedor («anthropic»). */
  readonly id: string
  readonly model: string
  readonly capabilities: { webSearch: boolean }
  /** Comprueba que la clave y el modelo funcionan (sin gastar en una respuesta). */
  check(): Promise<void>
  readPhotos(images: AiImage[], instructions?: string): Promise<{ reading: PhotoReading; usage: AiUsage }>
  composeNote(input: ComposeInput): Promise<{ markdown: string; sources: Source[]; usage: AiUsage }>
}

export interface AiProviderConfig {
  provider: string
  apiKey: string
  model: string
}

export type AiProviderFactory = (config: AiProviderConfig) => AiProvider

/**
 * Error del proveedor, con un mensaje para el usuario. `kind` distingue lo que
 * debe arreglar el administrador (auth, model) de lo pasajero (unavailable) o un
 * rechazo de seguridad del modelo (refused).
 */
export class AiProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'model' | 'unavailable' | 'refused' | 'invalid_response',
  ) {
    super(message)
    this.name = 'AiProviderError'
  }
}
