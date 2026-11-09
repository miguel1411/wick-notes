import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

/**
 * Solo para tests. Crea (si hace falta) la base de datos `<nombre>_test` junto a la
 * de desarrollo, le aplica las migraciones y apunta DATABASE_URL a ella.
 * Se puede forzar otra con TEST_DATABASE_URL.
 */
export async function prepareTestDatabase(): Promise<string> {
  const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url))
  if (existsSync(rootEnv) && !process.env.DATABASE_URL) process.loadEnvFile(rootEnv)

  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL
  if (!base) throw new Error('Define DATABASE_URL (o TEST_DATABASE_URL) para ejecutar los tests')

  const url = new URL(base)
  if (!process.env.TEST_DATABASE_URL) url.pathname = `${url.pathname.replace(/^\//, '')}_test`
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''))

  const admin = new URL(url)
  admin.pathname = '/postgres'
  const client = new pg.Client({ connectionString: admin.toString() })
  await client.connect()
  try {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
    if (!rowCount) await client.query(`CREATE DATABASE "${dbName.replaceAll('"', '""')}"`)
  } finally {
    await client.end()
  }

  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: ['ignore', 'ignore', 'inherit'],
  })

  process.env.DATABASE_URL = url.toString()
  return url.toString()
}
