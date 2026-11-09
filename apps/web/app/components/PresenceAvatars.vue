<script setup lang="ts">
defineProps<{ peers: Peer[] }>()

const initials = (name: string) => name.slice(0, 2).toUpperCase()
</script>

<template>
  <UAvatarGroup v-if="peers.length" size="sm" :max="4">
    <UTooltip v-for="peer in peers" :key="peer.clientId" :text="`${peer.name} está editando`">
      <UAvatar
        :alt="peer.name"
        :text="initials(peer.name)"
        :style="{ backgroundColor: peer.color }"
        :ui="{ fallback: 'text-white font-medium' }"
      />
    </UTooltip>
  </UAvatarGroup>
</template>
