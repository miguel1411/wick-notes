import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { disconnectPrisma, getPrisma } from '@wick/db'
import {
  AiDailyLimitError,
  AiProviderError,
  createDocument,
  createFolder,
  createNoteFromPhotos,
  createWorkspace,
  decryptSecret,
  deleteFolder,
  encryptSecret,
  finishMarkdown,
  ForbiddenError,
  getAiSettings,
  getAiStatus,
  getDocument,
  NotHandwrittenError,
  readMarkdown,
  renameFolder,
  setWorkspaceMember,
  testAiConnection,
  UnavailableError,
  updateAiSettings,
  ValidationError,
  type AiProvider,
  type AiProviderConfig,
  type AuthUser,
  type ComposeInput,
  type PhotoReading,
} from '../src'
import { makeUser, resetDatabase } from './helpers'

const KEY = 'sk-ant-api03-clave-de-prueba-1234'
/** Bytes que empiezan como un JPEG: basta para la validación de tipo. */
const jpeg = (n = 1) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(32).fill(n)])

/** Proveedor simulado: registra las llamadas y responde lo que se le diga. */
function fakeProvider(opts: { reading?: Partial<PhotoReading>; markdown?: string; failWith?: AiProviderError; delayMs?: number } = {}) {
  const calls = { read: 0, compose: [] as ComposeInput[], configs: [] as AiProviderConfig[], instructions: [] as (string | undefined)[] }
  const factory = (config: AiProviderConfig): AiProvider => {
    calls.configs.push(config)
    return {
      id: 'fake',
      model: config.model,
      capabilities: { webSearch: true },
      async check() {
        if (opts.failWith) throw opts.failWith
      },
      async readPhotos(images, instructions) {
        calls.read++
        calls.instructions.push(instructions)
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
        if (opts.failWith) throw opts.failWith
        return {
          reading: {
            photos: images.map(() => ({ handwritten: true, reason: 'Letra manuscrita' })),
            hasContent: true,
            title: 'Fotosíntesis',
            language: 'es',
            transcription: '- Luz + agua + CO2 → glucosa',
            keyTerms: ['fotosíntesis', 'clorofila'],
            ...opts.reading,
          },
          usage: { inputTokens: 100, outputTokens: 50, webSearches: 0 },
        }
      },
      async composeNote(input) {
        calls.compose.push(input)
        return {
          markdown: opts.markdown ?? 'Resumen breve.\n\n## Fase luminosa\n\nTexto.',
          sources: [],
          usage: { inputTokens: 200, outputTokens: 80, webSearches: input.research ? 2 : 0 },
        }
      },
    }
  }
  return { factory, calls }
}

let admin: AuthUser
let ana: AuthUser
beforeEach(async () => {
  await resetDatabase()
  admin = await makeUser('ADMIN')
  ana = await makeUser()
})
afterAll(async () => {
  await disconnectPrisma()
})

async function enableAi(extra: Parameters<typeof updateAiSettings>[1] = {}) {
  await updateAiSettings(admin, { apiKey: KEY, enabled: true, ...extra })
}

describe('cifrado de secretos', () => {
  it('cifra y descifra; un dato alterado o con otra clave maestra no se lee', () => {
    const enc = encryptSecret(KEY)
    expect(enc).not.toContain(KEY)
    expect(decryptSecret(enc)).toBe(KEY)
    expect(encryptSecret(KEY)).not.toBe(enc) // IV aleatorio
    const parts = enc.split(':')
    parts[3] = parts[3]!.slice(0, -2) + (parts[3]!.endsWith('A') ? 'BB' : 'AA')
    expect(decryptSecret(parts.join(':'))).toBeNull()

    const before = process.env.WICK_SECRET_KEY
    process.env.WICK_SECRET_KEY = 'otra-clave-maestra'
    try {
      expect(decryptSecret(enc)).toBeNull()
    } finally {
      if (before === undefined) delete process.env.WICK_SECRET_KEY
      else process.env.WICK_SECRET_KEY = before
    }
  })
})

describe('ajustes de IA', () => {
  it('solo los administradores los ven y cambian', async () => {
    await expect(getAiSettings(ana)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(updateAiSettings(ana, { enabled: true })).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('guarda la clave cifrada y solo muestra sus últimos caracteres', async () => {
    const s = await updateAiSettings(admin, { apiKey: KEY, dailyLimit: 3, webSearch: false })
    expect(s).toMatchObject({ hasApiKey: true, apiKeyHint: '1234', enabled: false, dailyLimit: 3, webSearch: false })
    expect(JSON.stringify(s)).not.toContain(KEY)
    const row = await getPrisma().aiSettings.findUniqueOrThrow({ where: { id: 'instance' } })
    expect(row.apiKeyEncrypted).not.toContain(KEY)
  })

  it('no se activa sin clave, ni se borra la clave estando activa', async () => {
    await expect(updateAiSettings(admin, { enabled: true })).rejects.toBeInstanceOf(ValidationError)
    await enableAi()
    await expect(updateAiSettings(admin, { apiKey: null })).rejects.toThrow(/Desactiva/)
    const off = await updateAiSettings(admin, { enabled: false, apiKey: null })
    expect(off).toMatchObject({ enabled: false, hasApiKey: false })
  })

  it('si la clave ya no se puede leer, la función queda apagada', async () => {
    await enableAi()
    await getPrisma().aiSettings.update({ where: { id: 'instance' }, data: { apiKeyEncrypted: 'v1:roto:roto:roto' } })
    const s = await getAiSettings(admin)
    expect(s).toMatchObject({ enabled: false, apiKeyUnreadable: true })
    expect((await getAiStatus(ana)).enabled).toBe(false)
  })

  it('prueba la conexión con la clave guardada o con una nueva', async () => {
    const ok = fakeProvider()
    await expect(testAiConnection(admin, {}, ok.factory)).rejects.toBeInstanceOf(ValidationError)
    await expect(testAiConnection(admin, { apiKey: 'sk-nueva-0000000' }, ok.factory)).resolves.toMatchObject({ ok: true })
    expect(ok.calls.configs[0]).toMatchObject({ apiKey: 'sk-nueva-0000000' })

    await updateAiSettings(admin, { apiKey: KEY })
    const bad = fakeProvider({ failWith: new AiProviderError('La clave de API de Anthropic no es válida o no tiene permiso.', 'auth') })
    await expect(testAiConnection(admin, {}, bad.factory)).rejects.toThrow(/no es válida/)
    expect(bad.calls.configs[0]).toMatchObject({ apiKey: KEY })
    await expect(testAiConnection(ana, {}, ok.factory)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('el estado dice cuántas notas quedan hoy', async () => {
    expect(await getAiStatus(ana)).toMatchObject({ enabled: false })
    await enableAi({ dailyLimit: 2 })
    expect(await getAiStatus(ana)).toMatchObject({ enabled: true, dailyLimit: 2, usedToday: 0, remainingToday: 2, maxPhotos: 4 })
    await createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: fakeProvider().factory })
    expect(await getAiStatus(ana)).toMatchObject({ usedToday: 1, remainingToday: 1 })
  })
})

describe('nota desde foto', () => {
  it('no hace nada si la función está apagada', async () => {
    const p = fakeProvider()
    await expect(createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })).rejects.toBeInstanceOf(UnavailableError)
    expect(p.calls.read).toBe(0)
  })

  it('valida número, tamaño y tipo de las fotos antes de enviar nada', async () => {
    await enableAi()
    const p = fakeProvider()
    const run = (images: Uint8Array[]) => createNoteFromPhotos(ana, { images }, { createProvider: p.factory })
    await expect(run([])).rejects.toThrow(/al menos una foto/)
    await expect(run([jpeg(), jpeg(), jpeg(), jpeg(), jpeg()])).rejects.toThrow(/máximo 4/)
    await expect(run([jpeg(), new TextEncoder().encode('no soy una imagen')])).rejects.toThrow(/La foto 2 no es una imagen/)
    const big = new Uint8Array(6 * 1024 * 1024)
    big.set([0xff, 0xd8, 0xff])
    await expect(run([big])).rejects.toThrow(/La foto 1 supera los 5 MB/)
    expect(p.calls.read).toBe(0)
  })

  it('crea la nota en la carpeta del usuario, con el pie y el registro de uso', async () => {
    await enableAi()
    await createDocument(admin, { title: 'Clorofila y pigmentos' })
    const p = fakeProvider()
    const stages: string[] = []
    const result = await createNoteFromPhotos(
      ana,
      { images: [jpeg(1), jpeg(2)], instructions: '  para el examen  ' },
      { createProvider: p.factory, onStage: (s) => stages.push(s) },
    )

    expect(stages).toEqual(['reading', 'context', 'writing', 'saving'])
    expect(p.calls.instructions).toEqual(['para el examen'])
    expect(p.calls.configs[0]).toMatchObject({ provider: 'anthropic', apiKey: KEY, model: 'claude-opus-5-5' })
    expect(p.calls.compose[0]).toMatchObject({ research: true, maxSearches: 5, instructions: 'para el examen' })
    expect(p.calls.compose[0]!.related.map((n) => n.title)).toEqual(['Clorofila y pigmentos'])

    const folder = await getPrisma().folder.findUniqueOrThrow({ where: { id: result.folderId } })
    expect(folder).toMatchObject({ name: ana.name, parentId: null, workspaceId: 'general' })
    expect(result.document).toMatchObject({ title: 'Fotosíntesis', folderId: folder.id, workspaceId: 'general' })

    const doc = await getPrisma().document.findUniqueOrThrow({ where: { id: result.document.id } })
    const md = readMarkdown(doc.yjsState)
    expect(md).toContain('## Fase luminosa')
    expect(md).toMatch(/Generada a partir de 2 fotos con claude-opus-5-5 el .+\. Revisa el contenido/)

    const runs = await getPrisma().aiRun.findMany({ where: { userId: ana.id } })
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'CREATED', documentId: doc.id, images: 2, inputTokens: 300, outputTokens: 130, webSearches: 2 })
  })

  it('no investiga si el usuario lo desactiva o el administrador no lo permite', async () => {
    await enableAi()
    const p = fakeProvider()
    await createNoteFromPhotos(ana, { images: [jpeg()], research: false }, { createProvider: p.factory })
    await updateAiSettings(admin, { webSearch: false })
    await createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })
    expect(p.calls.compose.map((c) => c.research)).toEqual([false, false])
  })

  it('rechaza las fotos que no están escritas a mano, sin redactar ni contar para el límite', async () => {
    await enableAi({ dailyLimit: 1 })
    const p = fakeProvider({
      reading: {
        photos: [
          { handwritten: true, reason: 'Manuscrita' },
          { handwritten: false, reason: 'Es una página impresa' },
          { handwritten: false, reason: 'Es una captura de pantalla' },
        ],
      },
    })
    const err = await createNoteFromPhotos(ana, { images: [jpeg(), jpeg(), jpeg()] }, { createProvider: p.factory }).catch((e) => e)
    expect(err).toBeInstanceOf(NotHandwrittenError)
    expect(err.message).toBe('No es posible transcribir: las fotos 2 y 3 no son documentos escritos a mano.')
    expect(err.details).toMatchObject({ reason: 'not_handwritten', photos: [{ photo: 2 }, { photo: 3 }] })
    expect(p.calls.compose).toHaveLength(0)
    expect(await getPrisma().document.count()).toBe(0)
    expect(await getPrisma().folder.count()).toBe(0)
    expect((await getPrisma().aiRun.findFirstOrThrow()).status).toBe('REJECTED')
    // El rechazo no gasta el cupo del día.
    expect((await getAiStatus(ana)).remainingToday).toBe(1)

    const one = fakeProvider({ reading: { photos: [{ handwritten: false, reason: 'Impresa' }] } })
    await expect(createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: one.factory })).rejects.toThrow(
      'No es posible transcribir: la foto 1 no es un documento escrito a mano.',
    )
  })

  it('reutiliza la carpeta aunque la renombren y crea otra si la borran', async () => {
    await enableAi()
    const p = fakeProvider()
    const first = await createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })
    await renameFolder(ana, first.folderId, 'Mis apuntes')
    const second = await createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })
    expect(second.folderId).toBe(first.folderId)

    await deleteFolder(ana, first.folderId)
    const third = await createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })
    expect(third.folderId).not.toBe(first.folderId)
    expect((await getPrisma().folder.findUniqueOrThrow({ where: { id: third.folderId } })).name).toBe(ana.name)
  })

  it('aprovecha una carpeta de la raíz con su nombre; dos usuarios con el mismo nombre no la comparten', async () => {
    await enableAi()
    const p = fakeProvider()
    const mine = await createFolder(ana, 'general', { name: ana.name })
    const result = await createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })
    expect(result.folderId).toBe(mine.id)

    const twin = await makeUser()
    await getPrisma().user.update({ where: { id: twin.id }, data: { name: ana.name } })
    const other = await createNoteFromPhotos({ ...twin, name: ana.name }, { images: [jpeg()] }, { createProvider: p.factory })
    expect(other.folderId).not.toBe(mine.id)
  })

  it('cada espacio tiene su propia carpeta del usuario', async () => {
    await enableAi()
    const p = fakeProvider()
    const ws = await createWorkspace(ana, { name: 'Escuela' })
    const a = await createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })
    const b = await createNoteFromPhotos(ana, { images: [jpeg()], workspaceId: ws.id }, { createProvider: p.factory })
    expect(a.folderId).not.toBe(b.folderId)
    expect((await getDocument(ana, b.document.id)).workspaceId).toBe(ws.id)
  })

  it('respeta el límite diario sin llamar al proveedor', async () => {
    await enableAi({ dailyLimit: 1 })
    const p = fakeProvider()
    await createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })
    const err = await createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory }).catch((e) => e)
    expect(err).toBeInstanceOf(AiDailyLimitError)
    expect(err.message).toMatch(/Ya creaste 1 nota con IA hoy/)
    expect(p.calls.read).toBe(1)
    // Otro usuario tiene su propio cupo; y al día siguiente se reinicia.
    await expect(createNoteFromPhotos(admin, { images: [jpeg()] }, { createProvider: p.factory })).resolves.toBeTruthy()
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await expect(createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory, now: () => tomorrow })).resolves.toBeTruthy()
  })

  it('varias peticiones a la vez no se saltan el límite diario', async () => {
    await enableAi({ dailyLimit: 1 })
    const p = fakeProvider({ delayMs: 50 })
    const results = await Promise.allSettled([1, 2, 3].map(() => createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(failed.every((r) => r.reason instanceof AiDailyLimitError)).toBe(true)
    expect(p.calls.read).toBe(1)
  })

  it('topa los intentos rechazados para no gastar sin límite', async () => {
    await enableAi({ dailyLimit: 1 })
    const p = fakeProvider({ reading: { photos: [{ handwritten: false, reason: 'Impresa' }] } })
    for (let i = 0; i < 3; i++) {
      await expect(createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })).rejects.toBeInstanceOf(NotHandwrittenError)
    }
    await expect(createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })).rejects.toThrow(/Demasiados intentos/)
    expect(p.calls.read).toBe(3)
  })

  it('solo da como relacionadas notas del espacio de destino', async () => {
    await enableAi()
    const privado = await createWorkspace(ana, { name: 'Privado' })
    await createDocument(ana, { title: 'Fotosíntesis secreta', workspaceId: privado.id })
    await createDocument(ana, { title: 'Fotosíntesis en General' })
    const p = fakeProvider()
    await createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })
    expect(p.calls.compose[0]!.related.map((n) => n.title)).toEqual(['Fotosíntesis en General'])
  })

  it('si el modelo no da un veredicto por foto, no sigue', async () => {
    await enableAi()
    const p = fakeProvider({ reading: { photos: [{ handwritten: true, reason: 'Manuscrita' }] } })
    await expect(createNoteFromPhotos(ana, { images: [jpeg(), jpeg()] }, { createProvider: p.factory })).rejects.toBeInstanceOf(UnavailableError)
    expect(p.calls.compose).toHaveLength(0)
    expect(await getPrisma().aiRun.findFirstOrThrow()).toMatchObject({ status: 'FAILED' })
  })

  it('exige permiso de escritura en el espacio', async () => {
    await enableAi()
    const ws = await createWorkspace(admin, { name: 'Solo lectura' })
    await setWorkspaceMember(admin, ws.id, ana.id, 'viewer')
    const p = fakeProvider()
    await expect(createNoteFromPhotos(ana, { images: [jpeg()], workspaceId: ws.id }, { createProvider: p.factory })).rejects.toBeInstanceOf(
      ForbiddenError,
    )
    expect(p.calls.read).toBe(0)
  })

  it('si falla el proveedor, lo registra y da un mensaje claro', async () => {
    await enableAi()
    const p = fakeProvider({ failWith: new AiProviderError('Anthropic no está disponible en este momento.', 'unavailable') })
    await expect(createNoteFromPhotos(ana, { images: [jpeg()] }, { createProvider: p.factory })).rejects.toThrow(UnavailableError)
    const run = await getPrisma().aiRun.findFirstOrThrow()
    expect(run).toMatchObject({ status: 'FAILED' })
    expect(run.error).toMatch(/^unavailable:/)
    expect(await getPrisma().document.count()).toBe(0)
  })
})

describe('finishMarkdown', () => {
  const meta = { photos: 1, model: 'claude-opus-5-5', date: new Date(2026, 10, 11) }

  it('quita un # Título inicial y añade el pie', () => {
    const md = finishMarkdown('# Fotosíntesis\n\nResumen.', [], meta)
    expect(md).toBe('Resumen.\n\n---\n\n*Generada a partir de una foto con claude-opus-5-5 el 11 de noviembre de 2026. Revisa el contenido antes de darlo por bueno.*\n')
  })

  it('convierte las imágenes en enlaces (el editor las cargaría solas)', () => {
    const md = finishMarkdown('Mira ![diagrama](https://evil.example/x?d=secreto) y ![](https://a.b/c.png).', [], meta)
    expect(md).toContain('Mira [diagrama](https://evil.example/x?d=secreto) y [imagen](https://a.b/c.png).')
    expect(md).not.toContain('![')
  })

  it('añade las fuentes citadas si el modelo no las listó', () => {
    const sources = [{ url: 'https://es.wikipedia.org/wiki/Fotosíntesis', title: 'Fotosíntesis [Wikipedia]' }]
    expect(finishMarkdown('Texto.', sources, meta)).toContain('## Fuentes\n\n1. [Fotosíntesis Wikipedia](https://es.wikipedia.org/wiki/Fotosíntesis)')
    expect(finishMarkdown('Ver [esto](https://es.wikipedia.org/wiki/Fotosíntesis).', sources, meta)).not.toContain('## Fuentes')
  })
})
