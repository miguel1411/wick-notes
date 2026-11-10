import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { NoteSummary } from '../api'
import { colors, pad, relativeTime, truncate } from '../format'
import { CliError, UsageError } from '../io'
import type { Context } from '../main'
import { resolveNote } from '../resolve'

const H1 = /^#[ \t]+(.+?)[ \t#]*$/

/** Igual que en el servidor: un `# Título` inicial se separa del contenido. */
function splitTitle(markdown: string): { title: string | null; body: string } {
  const lines = markdown.replace(/^﻿/, '').split(/\r?\n/)
  let i = 0
  while (i < lines.length && lines[i]!.trim() === '') i++
  const match = lines[i]?.match(H1)
  if (!match) return { title: null, body: markdown }
  return { title: match[1]!.trim(), body: lines.slice(i + 1).join('\n').replace(/^\s*\n/, '') }
}

const normalize = (md: string) => md.replace(/\r\n/g, '\n').trim()

// ---------------------------------------------------------------- list / search

function printList(ctx: Context, notes: NoteSummary[], json: boolean) {
  const { io } = ctx
  if (json) return io.stdout(JSON.stringify(notes, null, 2) + '\n')
  if (!notes.length) return io.stderr('No hay notas.\n')
  const c = colors(io)
  const width = Math.max(40, io.columns)
  const titleWidth = Math.max(16, width - 25 - 2 - 18 - 2)
  for (const n of notes) {
    const when = relativeTime(n.updatedAt)
    io.stdout(`${c.dim(n.id)}  ${pad(truncate(n.title, titleWidth), titleWidth)}  ${c.dim(when)}\n`)
  }
}

export async function list(ctx: Context, flags: { json?: boolean; limit?: string }) {
  let notes = await ctx.api().list()
  const limit = Number(flags.limit)
  if (flags.limit && (!Number.isInteger(limit) || limit < 1)) throw new UsageError('--limit debe ser un número positivo')
  if (limit) notes = notes.slice(0, limit)
  printList(ctx, notes, !!flags.json)
}

/** Busca en título y contenido; muestra un fragmento de cada resultado. */
export async function search(ctx: Context, query: string | undefined, flags: { json?: boolean; limit?: string }) {
  if (!query?.trim()) throw new UsageError('Uso: wick notes search <texto>')
  const { io } = ctx
  const results = await ctx.api().search(query, Number(flags.limit) || 20)
  if (flags.json) return io.stdout(JSON.stringify(results, null, 2) + '\n')
  if (!results.length) return io.stderr(`Ninguna nota contiene «${query}».\n`)
  const c = colors(io)
  const width = Math.max(40, io.columns)
  for (const r of results) {
    io.stdout(`${c.dim(r.id)}  ${c.bold(truncate(r.title, width - 27))}  ${c.dim(relativeTime(r.updatedAt))}\n`)
    if (r.snippet) io.stdout(`  ${c.dim(truncate(r.snippet, width - 2))}\n`)
  }
}

// ---------------------------------------------------------------- get / export

export async function get(ctx: Context, ref: string | undefined, flags: { json?: boolean; body?: boolean }) {
  if (!ref) throw new UsageError('Uso: wick notes get <id|título>')
  const api = ctx.api()
  const note = await resolveNote(api, ref)
  if (flags.json) {
    const { text } = await api.markdown(note.id)
    return ctx.io.stdout(JSON.stringify({ ...note, markdown: text }, null, 2) + '\n')
  }
  const { text } = await api.markdown(note.id, !flags.body)
  ctx.io.stdout(text.endsWith('\n') ? text : text + '\n')
}

async function isDirectory(path: string) {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Fichero de destino que no pise otro ya escrito en esta exportación. */
function uniqueName(name: string, used: Set<string>): string {
  let candidate = name
  for (let i = 2; used.has(candidate.toLowerCase()); i++) candidate = name.replace(/\.md$/, ` (${i}).md`)
  used.add(candidate.toLowerCase())
  return candidate
}

export async function exportNotes(ctx: Context, ref: string | undefined, flags: { output?: string; all?: boolean }) {
  const { io } = ctx
  const api = ctx.api()

  if (flags.all) {
    if (ref) throw new UsageError('Usa --all sin indicar ninguna nota')
    const dir = resolve(io.cwd, flags.output ?? '.')
    if (!(await isDirectory(dir))) throw new CliError(`${dir} no es una carpeta`)
    const notes = await api.list()
    const used = new Set<string>()
    for (const n of notes) {
      const { text, filename } = await api.markdown(n.id, true)
      const file = join(dir, uniqueName(filename ?? `${n.id}.md`, used))
      await writeFile(file, text)
      io.stderr(`${file}\n`)
    }
    io.stdout(`${notes.length} notas exportadas a ${dir}\n`)
    return
  }

  if (!ref) throw new UsageError('Uso: wick notes export <id|título> [-o fichero|carpeta|-]  ·  wick notes export --all [-o carpeta]')
  const note = await resolveNote(api, ref)
  const { text, filename } = await api.markdown(note.id, true)
  if (flags.output === '-') return io.stdout(text)

  let target = resolve(io.cwd, flags.output ?? '.')
  if (await isDirectory(target)) target = join(target, filename ?? `${note.id}.md`)
  await writeFile(target, text)
  io.stdout(`${target}\n`)
}

// ---------------------------------------------------------------- create / import / append

/**
 * Contenido de: --file <ruta>, --file - (entrada estándar) o el resto de argumentos.
 * La entrada estándar solo se lee si se pide con `-f -`: leerla por defecto deja
 * colgados scripts y cron, donde stdin está abierto pero nunca llega nada.
 */
async function readContent(ctx: Context, flags: { file?: string }, positional: string[]): Promise<string | null> {
  if (flags.file === '-') return ctx.io.readStdin()
  if (flags.file) return readFile(resolve(ctx.io.cwd, flags.file), 'utf8')
  if (positional.length) return positional.join(' ')
  return null
}

export async function create(ctx: Context, args: string[], flags: { file?: string; json?: boolean }) {
  const [title, ...rest] = args
  if (!title?.trim()) throw new UsageError('Uso: wick notes create "Título" [contenido…] [-f nota.md | -f -]')
  const api = ctx.api()
  const content = await readContent(ctx, flags, rest)
  const note = content?.trim() ? await api.importMarkdown({ title, markdown: content }) : await api.create(title)
  if (flags.json) return ctx.io.stdout(JSON.stringify(note, null, 2) + '\n')
  ctx.io.stdout(`${note.id}\n`)
  ctx.io.stderr(`${colors(ctx.io).green('✔')} Creada «${note.title}» · ${ctx.server()}/d/${note.id}\n`)
}

export async function importFiles(ctx: Context, files: string[]) {
  if (!files.length) throw new UsageError('Uso: wick notes import <fichero.md>…')
  const api = ctx.api()
  for (const file of files) {
    const path = resolve(ctx.io.cwd, file)
    const note = await api.importMarkdown({ markdown: await readFile(path, 'utf8'), filename: basename(path) })
    ctx.io.stdout(`${note.id}  ${note.title}\n`)
  }
}

export async function append(ctx: Context, args: string[], flags: { file?: string }) {
  const [ref, ...rest] = args
  if (!ref) throw new UsageError('Uso: wick notes append <id|título> [texto…] [-f f.md | -f -]')
  const api = ctx.api()
  const note = await resolveNote(api, ref)
  const content = await readContent(ctx, flags, rest)
  if (!content?.trim()) throw new UsageError('No hay nada que añadir')
  await api.writeMarkdown(note.id, content, 'append')
  ctx.io.stderr(`${colors(ctx.io).green('✔')} Añadido a «${note.title}»\n`)
}

// ---------------------------------------------------------------- edit

function editorCommand(env: NodeJS.ProcessEnv): string {
  return env.WICK_EDITOR || env.VISUAL || env.EDITOR || (process.platform === 'win32' ? 'notepad' : 'vi')
}

/**
 * Abre la nota en tu editor. Al guardar y cerrar, se aplican los cambios
 * (título y contenido). Si la nota cambió en el servidor mientras editabas, avisa
 * antes de sobrescribir y conserva tu versión para que no se pierda.
 */
export async function edit(ctx: Context, ref: string | undefined, flags: { force?: boolean }) {
  if (!ref) throw new UsageError('Uso: wick notes edit <id|título>')
  const { io } = ctx
  const api = ctx.api()
  const c = colors(io)
  const note = await resolveNote(api, ref)
  const base = await api.markdown(note.id, true)

  const dir = await mkdtemp(join(tmpdir(), 'wick-'))
  const file = join(dir, base.filename ?? `${note.id}.md`)
  await writeFile(file, base.text)
  let keepFile = false
  try {
    const editor = editorCommand(io.env)
    const result = spawnSync(`${editor} "${file}"`, { stdio: 'inherit', shell: true })
    if (result.error || result.status !== 0) {
      throw new CliError(`El editor «${editor}» terminó con error. Define VISUAL, EDITOR o WICK_EDITOR.`)
    }

    const edited = await readFile(file, 'utf8')
    if (normalize(edited) === normalize(base.text)) {
      io.stderr('Sin cambios.\n')
      return
    }

    // ¿Cambió la nota en el servidor mientras se editaba?
    const current = await api.markdown(note.id, true)
    if (normalize(current.text) !== normalize(base.text) && !flags.force) {
      io.stderr(`${c.yellow('!')} «${note.title}» cambió en el servidor mientras la editabas.\n`)
      const answer = io.stdinIsTTY ? (await io.prompt('¿Sobrescribir esos cambios con tu versión? [s/N] ')).trim().toLowerCase() : ''
      if (answer !== 's' && answer !== 'si' && answer !== 'sí') {
        keepFile = true
        throw new CliError(`No se guardó nada. Tu versión está en ${file}\n(revísala y repite con --force, o usa \`wick notes edit\` de nuevo)`)
      }
    }

    const { title, body } = splitTitle(edited)
    const bodyBefore = splitTitle(current.text).body
    if (title && title !== note.title) await api.rename(note.id, title)
    if (normalize(body) !== normalize(bodyBefore)) await api.writeMarkdown(note.id, body, 'replace')
    io.stderr(`${c.green('✔')} Guardada «${title ?? note.title}»\n`)
  } finally {
    if (!keepFile) await rm(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------- rename / delete

export async function rename(ctx: Context, args: string[]) {
  const [ref, ...rest] = args
  const title = rest.join(' ').trim()
  if (!ref || !title) throw new UsageError('Uso: wick notes rename <id|título> "Nuevo título"')
  const api = ctx.api()
  const note = await resolveNote(api, ref)
  const updated = await api.rename(note.id, title)
  ctx.io.stderr(`${colors(ctx.io).green('✔')} «${note.title}» → «${updated.title}»\n`)
}

export async function remove(ctx: Context, ref: string | undefined, flags: { yes?: boolean }) {
  if (!ref) throw new UsageError('Uso: wick notes delete <id|título> [--yes]')
  const api = ctx.api()
  const note = await resolveNote(api, ref)
  if (!flags.yes) {
    if (!ctx.io.stdinIsTTY) throw new CliError('Para borrar sin preguntar usa --yes')
    const answer = (await ctx.io.prompt(`¿Eliminar «${note.title}» para todos? No se puede deshacer. [s/N] `)).trim().toLowerCase()
    if (answer !== 's' && answer !== 'si' && answer !== 'sí') return ctx.io.stderr('Cancelado.\n')
  }
  await api.delete(note.id)
  ctx.io.stderr(`${colors(ctx.io).green('✔')} Eliminada «${note.title}»\n`)
}

// ---------------------------------------------------------------- history / restore

const REASON: Record<string, string> = {
  auto: 'edición',
  manual: 'guardada a mano',
  before_replace: 'antes de un reemplazo',
  before_restore: 'antes de restaurar',
}

/** Encuentra una versión por id o principio del id (4+ caracteres). */
async function resolveVersion(ctx: Context, noteId: string, ref: string) {
  const versions = await ctx.api().versions(noteId)
  const matches = versions.filter((v) => v.id === ref || (ref.length >= 4 && v.id.startsWith(ref)))
  if (matches.length === 1) return matches[0]!
  throw new CliError(matches.length ? `«${ref}» coincide con varias versiones; usa más caracteres del id` : `No hay ninguna versión «${ref}» (mira \`wick notes history\`)`)
}

/** Lista el historial de una nota, o muestra una versión en Markdown. */
export async function history(ctx: Context, args: string[], flags: { json?: boolean }) {
  const [ref, versionRef] = args
  if (!ref) throw new UsageError('Uso: wick notes history <nota> [versión]')
  const { io } = ctx
  const api = ctx.api()
  const note = await resolveNote(api, ref)
  if (versionRef) {
    const v = await resolveVersion(ctx, note.id, versionRef)
    const text = await api.versionMarkdown(note.id, v.id)
    return io.stdout(text.endsWith('\n') ? text : text + '\n')
  }
  const versions = await api.versions(note.id)
  if (flags.json) return io.stdout(JSON.stringify(versions, null, 2) + '\n')
  if (!versions.length) return io.stderr(`«${note.title}» todavía no tiene versiones.\n`)
  const c = colors(io)
  for (const v of versions) {
    const who = v.author ? ` · ${v.author.name}` : ''
    io.stdout(`${c.dim(v.id)}  ${pad(relativeTime(v.createdAt), 16)} ${REASON[v.reason] ?? v.reason}${who}\n`)
    if (v.preview) io.stdout(`  ${c.dim(truncate(v.preview, Math.max(40, io.columns) - 2))}\n`)
  }
}

/** Restaura una versión (contenido y título). Antes se guarda la versión actual. */
export async function restore(ctx: Context, args: string[], flags: { yes?: boolean }) {
  const [ref, versionRef] = args
  if (!ref || !versionRef) throw new UsageError('Uso: wick notes restore <nota> <versión> [--yes]')
  const api = ctx.api()
  const note = await resolveNote(api, ref)
  const v = await resolveVersion(ctx, note.id, versionRef)
  if (!flags.yes) {
    if (!ctx.io.stdinIsTTY) throw new CliError('Para restaurar sin preguntar usa --yes')
    const answer = (await ctx.io.prompt(`¿Restaurar «${note.title}» a la versión de ${relativeTime(v.createdAt)}? (lo actual queda en el historial) [s/N] `)).trim().toLowerCase()
    if (answer !== 's' && answer !== 'si' && answer !== 'sí') return ctx.io.stderr('Cancelado.\n')
  }
  await api.restoreVersion(note.id, v.id)
  ctx.io.stderr(`${colors(ctx.io).green('✔')} Restaurada «${v.title}» a la versión de ${relativeTime(v.createdAt)}\n`)
}
