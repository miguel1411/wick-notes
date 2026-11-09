import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Todos los tests comparten la misma base de datos de pruebas.
    fileParallelism: false,
  },
})
