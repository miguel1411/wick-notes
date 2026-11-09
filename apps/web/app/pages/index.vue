<script setup lang="ts">
const { documents, createDocument } = useDocuments()
</script>

<template>
  <UDashboardPanel id="home">
    <template #header>
      <UDashboardNavbar title="Notas">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UEmpty
        class="my-auto"
        icon="i-lucide-notebook-pen"
        :title="documents.length ? 'Elige una nota de la barra lateral' : 'Tu primera nota'"
        description="Las notas se guardan en tu servidor y se pueden editar entre varias personas a la vez."
        :actions="[{ label: 'Nueva nota', icon: 'i-lucide-plus', onClick: () => createDocument() }]"
      />
    </template>
  </UDashboardPanel>
</template>
