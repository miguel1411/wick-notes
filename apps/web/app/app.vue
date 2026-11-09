<script setup lang="ts">
useHead({
  htmlAttrs: { lang: 'es' },
  titleTemplate: (title) => (title ? `${title} · wick notes` : 'wick notes'),
  link: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
})
</script>

<template>
  <UApp :toaster="{ position: 'bottom-right' }">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
