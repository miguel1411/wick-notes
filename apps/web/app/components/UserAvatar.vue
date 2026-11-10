<script setup lang="ts">
withDefaults(defineProps<{ user: { id: string; name: string }; size?: 'xs' | 'sm' | 'md' | 'lg' }>(), { size: 'sm' })
</script>

<template>
  <UAvatar v-bind="userAvatar(user)" :size="size" />
</template>
