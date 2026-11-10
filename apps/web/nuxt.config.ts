// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  devtools: { enabled: false },
  telemetry: false,
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],

  // Instancia autoalojada: los iconos van empaquetados, nunca se piden a la API de Iconify.
  icon: { provider: 'server', serverBundle: 'local', fallbackToApi: false, clientBundle: { scan: true } },

  runtimeConfig: {
    // true si hay un proxy inverso delante: se usan sus cabeceras X-Forwarded-* (IP, host, https).
    trustProxy: false,
    // URL interna del servidor de colaboración (Docker: http://collab:1234).
    // Vacía en desarrollo: se usa DEV_HOST/127.0.0.1 y COLLAB_PORT.
    collabInternalUrl: '',
    public: {
      // URL del WebSocket de colaboración. Vacía = mismo host que la web en collabPort.
      collabUrl: '',
      collabPort: 3121,
      // Código fuente de esta instalación (enlace «Código fuente»). Vacía = el
      // repositorio oficial. Si modificas wick notes, pon aquí tu copia (AGPL-3.0).
      sourceUrl: '',
    },
  },

  // En desarrollo solo se escucha en esta máquina, salvo que
  // DEV_HOST (en .env) indique otra interfaz concreta, p. ej. la IP de Tailscale.
  devServer: { port: 3120, host: process.env.DEV_HOST || '127.0.0.1' },

  typescript: { strict: true },
})
