<script setup lang="ts">
const props = withDefaults(defineProps<{ user: { id: string; name: string }; size?: 'xs' | 'sm' | 'md' | 'lg' }>(), {
  size: 'sm',
})
const initials = computed(() =>
  props.user.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join(''),
)
</script>

<template>
  <UAvatar
    :alt="user.name"
    :text="initials"
    :size="size"
    :style="{ backgroundColor: userColor(user.id) }"
    :ui="{ fallback: 'text-white font-medium' }"
  />
</template>
