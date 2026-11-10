<script setup lang="ts">
const sourceUrl = useSourceUrl()
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-elevated/40 px-4 py-10">
    <div class="w-full max-w-sm">
      <div class="mb-6 flex items-center justify-center gap-2 text-lg font-semibold text-highlighted">
        <img src="/favicon.svg" alt="" class="size-7" />
        wick notes
      </div>
      <UCard>
        <slot />
      </UCard>
      <p class="mt-6 text-center text-xs text-dimmed">Your notes. Your server. Your knowledge.</p>
      <p class="mt-2 text-center text-xs">
        <ULink :to="sourceUrl" target="_blank" class="text-dimmed hover:text-muted">Código fuente (AGPL-3.0)</ULink>
      </p>
    </div>
  </div>
</template>
