<script setup lang="ts">
defineProps<{ peers: Peer[] }>()
</script>

<template>
  <UAvatarGroup v-if="peers.length" size="sm" :max="4">
    <UTooltip v-for="peer in peers" :key="peer.userId" :text="`${peer.name} está editando`">
      <UserAvatar :user="{ id: peer.userId, name: peer.name }" />
    </UTooltip>
  </UAvatarGroup>
</template>
