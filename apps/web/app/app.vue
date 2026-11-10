<script setup lang="ts">
import { es } from '@nuxt/ui/locale'

useHead({
  htmlAttrs: { lang: 'es' },
  titleTemplate: (title) => (title ? `${title} · wick notes` : 'wick notes'),
  link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
})
</script>

<template>
  <!-- Textos propios de Nuxt UI (cerrar, sin resultados, plegar barra…) en español. -->
  <UApp :locale="es" :toaster="{ position: 'bottom-right' }">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
