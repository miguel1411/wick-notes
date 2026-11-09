import { parseArgs } from 'node:util'
import { VERSION, WickApi } from './api'
import * as auth from './commands/auth'
import { mcpBridge } from './commands/mcp'
import * as notes from './commands/notes'
import { loadConfig, normalizeServer, type Config } from './config'
import { colors } from './format'
import { CliError, UsageError, type IO } from './io'

export interface Context {
  io: IO
  /** Cliente autenticado (falla con un mensaje claro si no hay credenciales). */
  api: () => WickApi
  server: () => string
}

const HELP = `wick — tus notas de wick notes desde la terminal

Uso:
  wick login [--server URL] [--token TOKEN]   Conecta con tu servidor (crea el token en Mi cuenta)
  wick logout                                 Olvida el servidor y el token guardados
  wick whoami                                 Muestra con qué cuenta estás conectado
  wick mcp                                    Servidor MCP por stdio para agentes de IA
                                              (claude mcp add wick -- wick mcp)

  wick notes list [--limit N]                 Notas, de la más reciente a la más antigua
  wick notes search <texto>                   Busca notas por título
  wick notes get <nota> [--body]              Muestra una nota en Markdown
  wick notes create "Título" [texto…]         Crea una nota (contenido opcional: texto, -f fichero, -f - stdin)
  wick notes edit <nota> [--force]            Edita una nota con tu editor ($VISUAL / $EDITOR)
  wick notes append <nota> [texto…]           Añade al final (texto, -f fichero, -f - stdin)
  wick notes rename <nota> "Nuevo título"     Cambia el título
  wick notes export <nota> [-o destino|-]     Guarda la nota como .md (o la imprime con -o -)
  wick notes export --all [-o carpeta]        Exporta todas las notas
  wick notes import <fichero.md>…             Crea notas a partir de ficheros Markdown
  wick notes delete <nota> [--yes]            Elimina una nota

<nota> puede ser el id, el principio del id o el título (o parte de él).
Ejemplo con tubería:  journalctl -n 50 | wick notes append "Incidencias" -f -
Los subcomandos de notes también funcionan sin «notes»: wick list, wick get…

Opciones generales:
  --json            Salida en JSON (list, search, get, create, whoami)
  --server URL      Servidor (o WICK_SERVER)
  --token TOKEN     Token de API (o WICK_TOKEN)
  -h, --help        Esta ayuda
  -v, --version     Versión
`


export async function run(argv: string[], io: IO): Promise<number> {
  const c = colors(io)
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
        json: { type: 'boolean' },
        server: { type: 'string' },
        token: { type: 'string' },
        limit: { type: 'string', short: 'n' },
        body: { type: 'boolean' },
        file: { type: 'string', short: 'f' },
        output: { type: 'string', short: 'o' },
        all: { type: 'boolean' },
        yes: { type: 'boolean', short: 'y' },
        force: { type: 'boolean' },
      },
    })
  } catch (err) {
    io.stderr(`${c.red('error:')} ${(err as Error).message}\nUsa \`wick --help\`.\n`)
    return 2
  }
  const { values: flags, positionals } = parsed

  if (flags.version) {
    io.stdout(`wick ${VERSION}\n`)
    return 0
  }

  let [command, ...rest] = positionals
  if (command === 'notes' || command === 'note') [command, ...rest] = rest
  if (flags.help || !command || command === 'help') {
    io.stdout(HELP)
    return 0
  }

  let config: Config | undefined
  const credentials = async () => {
    config ??= await loadConfig(io.env)
    const server = flags.server ?? io.env.WICK_SERVER ?? config.server
    const token = flags.token ?? io.env.WICK_TOKEN ?? config.token
    if (!server || !token) throw new CliError('No hay servidor configurado. Ejecuta `wick login`.')
    return { server: normalizeServer(server), token }
  }
  let api: WickApi | undefined
  await credentials().then((cr) => (api = new WickApi(cr.server, cr.token))).catch(() => {})
  const ctx: Context = {
    io,
    api: () => {
      if (!api) throw new CliError('No hay servidor configurado. Ejecuta `wick login`.')
      return api
    },
    server: () => api?.server ?? '',
  }

  try {
    switch (command) {
      case 'login':
        await auth.login(ctx, flags)
        break
      case 'logout':
        await auth.logout(io)
        break
      case 'mcp':
        await mcpBridge(ctx)
        break
      case 'whoami':
        await auth.whoami(ctx, !!flags.json)
        break
      case 'list':
      case 'ls':
        await notes.list(ctx, flags)
        break
      case 'search':
        await notes.search(ctx, rest.join(' '), flags)
        break
      case 'get':
      case 'show':
        await notes.get(ctx, rest.join(' '), flags)
        break
      case 'create':
      case 'new':
        await notes.create(ctx, rest, flags)
        break
      case 'edit':
        await notes.edit(ctx, rest.join(' '), flags)
        break
      case 'append':
        await notes.append(ctx, rest, flags)
        break
      case 'rename':
        await notes.rename(ctx, rest)
        break
      case 'export':
        await notes.exportNotes(ctx, rest.join(' ') || undefined, flags)
        break
      case 'import':
        await notes.importFiles(ctx, rest)
        break
      case 'delete':
      case 'rm':
        await notes.remove(ctx, rest.join(' '), flags)
        break
      default:
        throw new UsageError(`Comando desconocido: ${command}`)
    }
    return 0
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr(`${c.red('error:')} ${err.message}\nUsa \`wick --help\`.\n`)
      return 2
    }
    if (err instanceof CliError) {
      io.stderr(`${c.red('error:')} ${err.message}\n`)
      return 1
    }
    io.stderr(`${c.red('error inesperado:')} ${(err as Error).stack ?? err}\n`)
    return 1
  }
}
