import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, env } from 'prisma/config'

// En desarrollo las variables viven en el .env de la raíz del monorepo.
// En Docker llegan como variables de entorno y este archivo no existe.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
})
