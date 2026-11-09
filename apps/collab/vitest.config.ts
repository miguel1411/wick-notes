import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 20000,
    // Los ficheros comparten la base de datos de pruebas.
    fileParallelism: false,
  },
})
