/**
 * Ajustes de la IA de la instancia. Los cambia un administrador desde la web y
 * se aplican al momento. La clave de API se guarda cifrada (secret.ts) y nunca
 * sale de aquí completa.
 */
import { getPrisma } from '@wick/db'
import { z } from 'zod'
import { requireActor, requireAdmin, type AuthUser } from '../auth/actor'
import { UnavailableError, ValidationError } from '../errors'
import { parse } from '../validation'
import { AnthropicProvider } from './anthropic'
import { MAX_PHOTOS } from './images'
import { decryptSecret, encryptSecret, secretHint } from './secret'
import { type AiProvider, type AiProviderConfig, AiProviderError, type AiProviderFactory } from './types'

const SETTINGS_ID = 'instance'

export const AI_PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', defaultModel: 'claude-opus-5-5' },
} as const
export type AiProviderId = keyof typeof AI_PROVIDERS

/** Crea el proveedor configurado. Los tests pasan su propia fábrica. */
export const createAiProvider: AiProviderFactory = (config: AiProviderConfig): AiProvider => {
  if (config.provider === 'anthropic') return new AnthropicProvider(config)
  throw new UnavailableError(`Proveedor de IA desconocido: ${config.provider}`)
}

const providerLabel = (id: string) => AI_PROVIDERS[id as AiProviderId]?.label ?? id

export interface AiSettingsSummary {
  enabled: boolean
  provider: AiProviderId
  providerLabel: string
  model: string
  webSearch: boolean
  maxSearches: number
  dailyLimit: number
  hasApiKey: boolean
  /** Últimos caracteres de la clave guardada (null si no hay o es corta). */
  apiKeyHint: string | null
  /** Hay una clave guardada, pero no se puede descifrar (cambió la clave maestra): hay que escribirla otra vez. */
  apiKeyUnreadable: boolean
  updatedAt: Date | null
}

interface AiRuntime {
  settings: AiSettingsSummary
  apiKey: string | null
  /** Lo que eligió el administrador (settings.enabled exige además una clave legible). */
  storedEnabled: boolean
}

const DEFAULTS = {
  enabled: false,
  provider: 'anthropic' as AiProviderId,
  model: AI_PROVIDERS.anthropic.defaultModel,
  webSearch: true,
  maxSearches: 5,
  dailyLimit: 10,
}

/** Ajustes y clave descifrada. Solo para uso interno de @wick/core. */
export async function loadAiRuntime(): Promise<AiRuntime> {
  const row = await getPrisma().aiSettings.findUnique({ where: { id: SETTINGS_ID } })
  const apiKey = row?.apiKeyEncrypted ? decryptSecret(row.apiKeyEncrypted) : null
  const provider = (row?.provider ?? DEFAULTS.provider) as AiProviderId
  const settings: AiSettingsSummary = {
    // Sin una clave legible la función no puede funcionar: se considera apagada.
    enabled: (row?.enabled ?? DEFAULTS.enabled) && !!apiKey,
    provider,
    providerLabel: providerLabel(provider),
    model: row?.model ?? DEFAULTS.model,
    webSearch: row?.webSearch ?? DEFAULTS.webSearch,
    maxSearches: row?.maxSearches ?? DEFAULTS.maxSearches,
    dailyLimit: row?.dailyLimit ?? DEFAULTS.dailyLimit,
    hasApiKey: !!row?.apiKeyEncrypted,
    apiKeyHint: row?.apiKeyHint || null,
    apiKeyUnreadable: !!row?.apiKeyEncrypted && !apiKey,
    updatedAt: row?.updatedAt ?? null,
  }
  return { settings, apiKey, storedEnabled: row?.enabled ?? DEFAULTS.enabled }
}

export async function getAiSettings(actor: AuthUser): Promise<AiSettingsSummary> {
  requireAdmin(actor)
  return (await loadAiRuntime()).settings
}

export const updateAiSettingsInput = z.object({
  enabled: z.boolean().optional(),
  provider: z.enum(['anthropic']).optional(),
  /** Nueva clave; null la borra; sin el campo, se conserva la guardada. */
  apiKey: z.string().trim().min(10, 'La clave de API parece demasiado corta').max(500).nullable().optional(),
  model: z.string().trim().min(1, 'Indica el modelo').max(100).optional(),
  webSearch: z.boolean().optional(),
  maxSearches: z.number().int().min(1, 'Al menos 1 búsqueda').max(20, 'Como máximo 20 búsquedas').optional(),
  dailyLimit: z.number().int().min(1, 'Al menos 1 nota al día').max(1000, 'Como máximo 1000 notas al día').optional(),
})
export type UpdateAiSettingsInput = z.input<typeof updateAiSettingsInput>

export async function updateAiSettings(actor: AuthUser, input: UpdateAiSettingsInput): Promise<AiSettingsSummary> {
  requireAdmin(actor)
  const data = parse(updateAiSettingsInput, input)
  const { settings, apiKey, storedEnabled } = await loadAiRuntime()

  const keyFields =
    data.apiKey === undefined
      ? {}
      : data.apiKey === null
        ? { apiKeyEncrypted: null, apiKeyHint: null }
        : { apiKeyEncrypted: encryptSecret(data.apiKey), apiKeyHint: secretHint(data.apiKey) }
  const willHaveKey = data.apiKey === undefined ? !!apiKey : data.apiKey !== null
  const enabled = data.enabled ?? storedEnabled
  if (enabled && data.apiKey === null) throw new ValidationError('Desactiva la función antes de borrar la clave de API')
  if (enabled && !willHaveKey) {
    throw new ValidationError(
      settings.apiKeyUnreadable
        ? 'La clave guardada ya no se puede leer (cambió la clave maestra del servidor). Escríbela otra vez.'
        : 'Para activar la función, primero guarda una clave de API',
    )
  }

  const values = {
    enabled,
    ...(data.provider ? { provider: data.provider } : {}),
    ...(data.model ? { model: data.model } : {}),
    ...(data.webSearch !== undefined ? { webSearch: data.webSearch } : {}),
    ...(data.maxSearches !== undefined ? { maxSearches: data.maxSearches } : {}),
    ...(data.dailyLimit !== undefined ? { dailyLimit: data.dailyLimit } : {}),
    ...keyFields,
    updatedById: actor.id,
  }
  await getPrisma().aiSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...values }, update: values })
  return (await loadAiRuntime()).settings
}

/**
 * Prueba la conexión con el proveedor: con la clave y el modelo indicados (para
 * probarlos antes de guardar) o con los guardados.
 */
export async function testAiConnection(
  actor: AuthUser,
  input: { apiKey?: string; model?: string; provider?: string } = {},
  factory: AiProviderFactory = createAiProvider,
): Promise<{ ok: true; model: string }> {
  requireAdmin(actor)
  const { settings, apiKey } = await loadAiRuntime()
  const key = input.apiKey?.trim() || apiKey
  if (!key) throw new ValidationError('Escribe una clave de API para probar la conexión')
  const model = input.model?.trim() || settings.model
  const provider = factory({ provider: input.provider ?? settings.provider, apiKey: key, model })
  try {
    await provider.check()
  } catch (err) {
    if (err instanceof AiProviderError) throw new UnavailableError(err.message, { reason: err.kind })
    throw err
  }
  return { ok: true, model }
}

// ------------------------------------------------------------ estado para el usuario

export interface AiStatus {
  /** ¿Puede usar «Nota desde foto»? */
  enabled: boolean
  providerLabel: string
  model: string
  /** ¿Se permite investigar en internet? */
  webSearch: boolean
  dailyLimit: number
  usedToday: number
  remainingToday: number
  maxPhotos: number
}

/** Inicio del día en la zona horaria del servidor: el límite diario se reinicia a medianoche. */
export function startOfDay(now: Date = new Date()): Date {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d
}

/** Una reserva (PENDING) más antigua que esto se da por perdida (el proceso se cortó). */
const PENDING_TTL_MS = 15 * 60 * 1000

/** Notas con IA que el usuario creó hoy, más las que se están creando ahora. */
export async function countAiNotesToday(
  userId: string,
  now: Date = new Date(),
  db: Pick<ReturnType<typeof getPrisma>, 'aiRun'> = getPrisma(),
): Promise<number> {
  return db.aiRun.count({
    where: {
      userId,
      createdAt: { gte: startOfDay(now) },
      OR: [{ status: 'CREATED' }, { status: 'PENDING', createdAt: { gte: new Date(now.getTime() - PENDING_TTL_MS) } }],
    },
  })
}

export async function getAiStatus(actor: AuthUser, now: Date = new Date()): Promise<AiStatus> {
  requireActor(actor)
  const { settings } = await loadAiRuntime()
  const usedToday = settings.enabled ? await countAiNotesToday(actor.id, now) : 0
  return {
    enabled: settings.enabled,
    providerLabel: settings.providerLabel,
    model: settings.model,
    webSearch: settings.webSearch,
    dailyLimit: settings.dailyLimit,
    usedToday,
    remainingToday: Math.max(0, settings.dailyLimit - usedToday),
    maxPhotos: MAX_PHOTOS,
  }
}
