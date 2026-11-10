import { createServer, type Server } from 'node:http'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { run } from '../src/main'
import type { IO } from '../src/io'

// ---------------------------------------------------------------- servidor falso

interface Note {
  id: string
  title: string
  body: string
  createdAt: string
  updatedAt: string
}

const TOKEN = 'wick_' + 'a'.repeat(43)
let notes: Note[] = []
let seq = 0
let server: Server
let base: string
/** Para simular que alguien cambia la nota mientras se edita. */
let onNextMarkdownRead: ((n: Note) => void) | null = null

const newId = () => `c${String(++seq).padStart(24, '0')}`
const summary = (n: Note) => ({ id: n.id, title: n.title, createdAt: n.createdAt, updatedAt: n.updatedAt, createdBy: { id: 'u1', name: 'Ana' } })
function addNote(title: string, body = '') {
  const now = new Date(Date.now() - (100 - seq) * 60_000).toISOString()
  const n = { id: newId(), title, body, createdAt: now, updatedAt: now }
  notes.unshift(n)
  return n
}

function startServer() {
  server = createServer(async (req, res) => {
    const send = (status: number, body?: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/markdown' : 'application/json', ...headers })
      res.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body))
    }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { message: 'Token de API no válido' })
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const json = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}
    const url = new URL(req.url!, 'http://x')
    const p = url.pathname
    const find = (id: string) => notes.find((n) => n.id === id)
    let m: RegExpMatchArray | null

    if (p === '/api/auth/state') return send(200, { setupRequired: false, user: { id: 'u1', username: 'ana', name: 'Ana', role: 'ADMIN' } })
    if (p === '/api/documents' && req.method === 'GET') {
      const q = url.searchParams.get('q')?.toLowerCase()
      return send(200, notes.filter((n) => !q || n.title.toLowerCase().includes(q)).map(summary))
    }
    if (p === '/api/documents/search') {
      const terms = url.searchParams.get('q')!.toLowerCase().split(/\s+/)
      const hits = notes.filter((n) => terms.every((t) => `${n.title} ${n.body}`.toLowerCase().includes(t)))
      return send(200, hits.map((n) => ({ ...summary(n), snippet: n.body.slice(0, 40), titleMatch: false })))
    }
    if (p === '/api/documents' && req.method === 'POST') return send(201, summary(addNote(json.title)))
    if (p === '/api/documents/import') {
      const lines = String(json.markdown).split('\n')
      const h1 = lines[0]?.startsWith('# ') ? lines[0].slice(2) : null
      const title = json.title || h1 || String(json.filename ?? '').replace(/\.md$/, '') || 'Sin título'
      return send(201, summary(addNote(title, h1 && !json.title ? lines.slice(2).join('\n') : json.markdown)))
    }
    if ((m = p.match(/^\/api\/documents\/([^/]+)\/versions$/))) {
      return send(200, [
        { id: 'cv00000000000000000000002', createdAt: new Date().toISOString(), title: 'Diario', reason: 'manual', author: { id: 'u1', name: 'Ana' }, preview: 'segunda' },
        { id: 'cv00000000000000000000001', createdAt: new Date(Date.now() - 3600_000).toISOString(), title: 'Diario', reason: 'auto', author: null, preview: 'primera' },
      ])
    }
    if ((m = p.match(/^\/api\/documents\/([^/]+)\/versions\/([^/]+)\/(markdown|restore)$/))) {
      const n = find(m[1]!)!
      if (m[3] === 'markdown') return send(200, `contenido de ${m[2]}`)
      n.body = `restaurada ${m[2]}`
      return send(204)
    }
    if ((m = p.match(/^\/api\/documents\/([^/]+)\/markdown$/))) {
      const n = find(m[1]!)
      if (!n) return send(404, { message: 'Documento no encontrado' })
      if (req.method === 'PUT') {
        n.body = json.mode === 'append' ? `${n.body.trimEnd()}\n\n${json.markdown}`.trimStart() : json.markdown
        n.updatedAt = new Date().toISOString()
        return send(204)
      }
      if (onNextMarkdownRead) {
        const fn = onNextMarkdownRead
        onNextMarkdownRead = null
        fn(n)
      }
      if (url.searchParams.get('download')) {
        return send(200, `# ${n.title}\n\n${n.body}`, { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(n.title)}.md` })
      }
      return send(200, n.body)
    }
    if ((m = p.match(/^\/api\/documents\/([^/]+)$/))) {
      const n = find(m[1]!)
      if (!n) return send(404, { message: 'Documento no encontrado' })
      if (req.method === 'GET') return send(200, summary(n))
      if (req.method === 'PATCH') return (n.title = json.title), send(200, summary(n))
      if (req.method === 'DELETE') return (notes = notes.filter((x) => x !== n)), send(204)
    }
    send(404, { message: 'no existe' })
  })
  return new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
}

// ---------------------------------------------------------------- utilidades

let dir: string

async function wick(argv: string[], opts: { env?: Record<string, string>; stdin?: string; answers?: string[] } = {}) {
  let out = ''
  let err = ''
  const answers = [...(opts.answers ?? [])]
  const io: IO = {
    stdout: (t) => void (out += t),
    stderr: (t) => void (err += t),
    env: { WICK_CONFIG: join(dir, 'config.json'), NO_COLOR: '1', ...opts.env },
    cwd: dir,
    stdinIsTTY: opts.stdin === undefined,
    stdoutIsTTY: false,
    columns: 100,
    readStdin: async () => opts.stdin ?? '',
    stdinLines: async function* () {
      for (const l of (opts.stdin ?? '').split('\n')) yield l
    },
    prompt: async () => answers.shift() ?? '',
  }
  const code = await run(argv, io)
  return { code, out, err }
}

const loggedIn = { WICK_SERVER: '', WICK_TOKEN: TOKEN }

beforeAll(async () => {
  await startServer()
  const addr = server.address() as { port: number }
  base = `http://127.0.0.1:${addr.port}`
  loggedIn.WICK_SERVER = base
})
afterAll(() => new Promise<void>((r) => server.close(() => r())))

beforeEach(async () => {
  notes = []
  seq = 0
  onNextMarkdownRead = null
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = await mkdtemp(join(tmpdir(), 'wick-cli-test-'))
})

// ---------------------------------------------------------------- tests

describe('wick login / whoami', () => {
  it('guarda servidor y token con permisos 600, y whoami los usa', async () => {
    const login = await wick(['login', '--server', base.replace('http://', ''), '--token', TOKEN])
    expect(login.code).toBe(0)
    expect(login.out).toContain('como Ana (@ana)')
    const cfg = JSON.parse(await readFile(join(dir, 'config.json'), 'utf8'))
    expect(cfg).toEqual({ server: base, token: TOKEN })
    if (process.platform !== 'win32') expect((await stat(join(dir, 'config.json'))).mode & 0o777).toBe(0o600)

    const me = await wick(['whoami'])
    expect(me.out).toContain('Ana (@ana) · administrador')

    await wick(['logout'])
    expect((await wick(['whoami'])).err).toContain('wick login')
  })

  it('rechaza un token incorrecto sin guardar nada', async () => {
    const r = await wick(['login', '--server', base, '--token', 'wick_' + 'b'.repeat(43)])
    expect(r.code).toBe(1)
    expect(r.err).toContain('Token de API no válido')
    await expect(stat(join(dir, 'config.json'))).rejects.toThrow()
  })

  it('pide el token de forma interactiva', async () => {
    const r = await wick(['login', '--server', base], { answers: [TOKEN] })
    expect(r.code).toBe(0)
  })

  it('explica cuando no puede conectar', async () => {
    const r = await wick(['list'], { env: { WICK_SERVER: 'http://127.0.0.1:1', WICK_TOKEN: TOKEN } })
    expect(r.code).toBe(1)
    expect(r.err).toContain('No se pudo conectar con http://127.0.0.1:1')
  })
})

describe('wick notes', () => {
  it('lista y busca', async () => {
    addNote('Red de casa')
    addNote('Backups de PostgreSQL')
    const list = await wick(['notes', 'list'], { env: loggedIn })
    expect(list.out.split('\n').filter(Boolean)).toHaveLength(2)
    expect(list.out).toContain('Backups de PostgreSQL')

    const found = await wick(['search', 'postgres'], { env: loggedIn })
    expect(found.out).toContain('Backups de PostgreSQL')
    expect(found.out).not.toContain('Red de casa')

    notes[1]!.body = 'El router está en la entrada'
    const inBody = await wick(['search', 'router entrada'], { env: loggedIn })
    expect(inBody.out).toContain('Red de casa')
    expect(inBody.out).toContain('El router está en la entrada')

    const json = JSON.parse((await wick(['list', '--json', '-n', '1'], { env: loggedIn })).out)
    expect(json).toHaveLength(1)
  })

  it('encuentra notas por id, principio del id o título, y avisa si es ambiguo', async () => {
    const red = addNote('Red de casa', 'Router en .1')
    addNote('Red de la oficina', 'x')
    expect((await wick(['get', red.id], { env: loggedIn })).out).toBe('# Red de casa\n\nRouter en .1\n')
    expect((await wick(['get', 'red de casa', '--body'], { env: loggedIn })).out).toBe('Router en .1\n')
    expect((await wick(['get', 'casa', '--body'], { env: loggedIn })).out).toBe('Router en .1\n')

    const ambiguous = await wick(['get', 'Red'], { env: loggedIn })
    expect(ambiguous.code).toBe(1)
    expect(ambiguous.err).toContain('coincide con 2 notas')
    expect(ambiguous.err).toContain(red.id)

    expect((await wick(['get', 'nada'], { env: loggedIn })).err).toContain('No hay ninguna nota')
  })

  it('crea notas con contenido por argumento, fichero o stdin', async () => {
    const a = await wick(['create', 'Vacía'], { env: loggedIn })
    expect(a.out.trim()).toMatch(/^c\d{24}$/)

    await writeFile(join(dir, 'c.md'), 'Desde fichero')
    await wick(['create', 'Con fichero', '--file', 'c.md'], { env: loggedIn })
    await wick(['create', 'Por stdin', '-f', '-'], { env: loggedIn, stdin: 'Desde stdin' })
    // Sin `-f -` no se lee stdin aunque no sea una terminal (no se cuelga en scripts).
    await wick(['create', 'Sin leer stdin'], { env: loggedIn, stdin: 'ignorado' })
    expect(notes.find((n) => n.title === 'Sin leer stdin')?.body).toBe('')
    await wick(['new', 'Inline', 'texto', 'suelto'], { env: loggedIn })

    expect(notes.find((n) => n.title === 'Con fichero')?.body).toBe('Desde fichero')
    expect(notes.find((n) => n.title === 'Por stdin')?.body).toBe('Desde stdin')
    expect(notes.find((n) => n.title === 'Inline')?.body).toBe('texto suelto')
  })

  it('añade al final', async () => {
    const n = addNote('Diario', 'Lunes')
    await wick(['append', 'Diario', 'Martes'], { env: loggedIn })
    await wick(['append', n.id, '-f', '-'], { env: loggedIn, stdin: 'Miércoles' })
    expect(n.body).toBe('Lunes\n\nMartes\n\nMiércoles')
  })

  it('exporta una nota o todas', async () => {
    addNote('Red de casa', 'Router')
    addNote('Red de casa', 'Duplicada')
    addNote('Otra', 'x')
    const one = await wick(['export', 'Otra'], { env: loggedIn })
    expect(one.out.trim()).toBe(join(dir, 'Otra.md'))
    expect(await readFile(join(dir, 'Otra.md'), 'utf8')).toBe('# Otra\n\nx')

    expect((await wick(['export', 'Otra', '-o', '-'], { env: loggedIn })).out).toBe('# Otra\n\nx')

    const all = await wick(['export', '--all', '-o', '.'], { env: loggedIn })
    expect(all.out).toContain('3 notas exportadas')
    const files = (await readdir(dir)).filter((f) => f.endsWith('.md')).sort()
    expect(files).toEqual(['Otra.md', 'Red de casa (2).md', 'Red de casa.md'])
  })

  it('importa ficheros', async () => {
    await writeFile(join(dir, 'notas-red.md'), '# Red\n\ncontenido')
    await writeFile(join(dir, 'suelta.md'), 'sin título')
    const r = await wick(['import', 'notas-red.md', 'suelta.md'], { env: loggedIn })
    expect(r.code).toBe(0)
    expect(notes.map((n) => n.title).sort()).toEqual(['Red', 'suelta'])
  })

  it('renombra y borra (pidiendo confirmación)', async () => {
    const n = addNote('Vieja')
    await wick(['rename', 'Vieja', 'Nueva', 'versión'], { env: loggedIn })
    expect(n.title).toBe('Nueva versión')

    await wick(['delete', n.id], { env: loggedIn, answers: ['n'] })
    expect(notes).toHaveLength(1)
    const noTty = await wick(['delete', n.id], { env: loggedIn, stdin: '' })
    expect(noTty.err).toContain('--yes')
    await wick(['rm', n.id, '--yes'], { env: loggedIn })
    expect(notes).toHaveLength(0)
  })

  it('edita con el editor del usuario: cambia título y contenido', async () => {
    const n = addNote('Borrador', 'texto viejo')
    const editor = join(dir, 'editor.mjs')
    await writeFile(editor, `import fs from 'node:fs'; const f = process.argv[2]; fs.writeFileSync(f, '# Definitivo\\n\\ntexto nuevo\\n')`)
    const r = await wick(['edit', 'Borrador'], { env: { ...loggedIn, WICK_EDITOR: `node "${editor}"` } })
    expect(r.code).toBe(0)
    expect(n.title).toBe('Definitivo')
    expect(n.body).toBe('texto nuevo\n')
  })

  it('edit sin cambios no escribe nada', async () => {
    const n = addNote('Igual', 'x')
    const before = n.updatedAt
    const r = await wick(['edit', n.id], { env: { ...loggedIn, WICK_EDITOR: 'node -e ""' } })
    expect(r.err).toContain('Sin cambios')
    expect(n.updatedAt).toBe(before)
  })

  it('edit avisa si la nota cambió mientras se editaba y no pisa nada sin permiso', async () => {
    const n = addNote('Compartida', 'original')
    const editor = join(dir, 'editor.mjs')
    await writeFile(editor, `import fs from 'node:fs'; fs.writeFileSync(process.argv[2], '# Compartida\\n\\nmi versión\\n')`)
    // La segunda lectura (tras cerrar el editor) verá el cambio de otra persona.
    let reads = 0
    onNextMarkdownRead = () => {
      reads++
      onNextMarkdownRead = (note) => {
        note.body = 'cambio de otra persona'
      }
    }
    const r = await wick(['edit', n.id], { env: { ...loggedIn, WICK_EDITOR: `node "${editor}"` }, answers: ['n'] })
    expect(reads).toBe(1)
    expect(r.code).toBe(1)
    expect(r.err).toContain('cambió en el servidor')
    expect(r.err).toContain('Tu versión está en')
    expect(n.body).toBe('cambio de otra persona')

    // Con --force sí se sobrescribe.
    onNextMarkdownRead = null
    await wick(['edit', n.id, '--force'], { env: { ...loggedIn, WICK_EDITOR: `node "${editor}"` } })
    expect(n.body).toBe('mi versión\n')
  })

  it('historial y restaurar', async () => {
    const n = addNote('Diario', 'actual')
    const list = await wick(['history', 'Diario'], { env: loggedIn })
    expect(list.out).toContain('guardada a mano · Ana')
    expect(list.out).toContain('primera')
    expect((await wick(['history', 'Diario', 'cv00000000000000000000001'], { env: loggedIn })).out).toBe('contenido de cv00000000000000000000001\n')
    expect((await wick(['history', 'Diario', 'cv0000'], { env: loggedIn })).err).toContain('varias versiones')

    await wick(['restore', 'Diario', 'cv00000000000000000000001'], { env: loggedIn, answers: ['n'] })
    expect(n.body).toBe('actual')
    await wick(['restore', 'Diario', 'cv00000000000000000000001', '--yes'], { env: loggedIn })
    expect(n.body).toBe('restaurada cv00000000000000000000001')
  })

  it('ayuda, versión y errores de uso', async () => {
    expect((await wick(['--help'])).out).toContain('wick notes list')
    expect((await wick(['-v'])).out).toMatch(/^wick /)
    const unknown = await wick(['vuela'], { env: loggedIn })
    expect(unknown.code).toBe(2)
    expect(unknown.err).toContain('Comando desconocido')
    expect((await wick(['get'], { env: loggedIn })).code).toBe(2)
    expect((await wick(['--nope'])).code).toBe(2)
  })
})
