<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import Settings from './Settings.vue'
import Bench from './Bench.vue'

const currentHash = ref(window.location.hash)

const isBenchView = computed(() => currentHash.value === '#bench')

const handleHashChange = () => {
  currentHash.value = window.location.hash
}

onMounted(() => {
  window.addEventListener('hashchange', handleHashChange)
})

onUnmounted(() => {
  window.removeEventListener('hashchange', handleHashChange)
})
</script>

<template>
  <main>
    <nav class="top-nav">
      <a href="#" class="nav-brand">vite-plugin-herdr</a>
      <div class="nav-links">
        <a href="#" :class="{ active: !isBenchView }">Settings</a>
        <a href="#bench" :class="{ active: isBenchView }">Bench</a>
      </div>
    </nav>

    <Settings v-if="!isBenchView" />
    <Bench v-else />
  </main>
</template>

<style scoped>
.top-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 2rem;
  margin-bottom: 2rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--border-color);
}

.nav-brand {
  font-weight: 600;
  color: var(--text-primary);
  text-decoration: none;
  font-size: 1rem;
}

.nav-links {
  display: flex;
  gap: 1rem;
}

.nav-links a {
  color: var(--text-secondary);
  text-decoration: none;
  padding: 0.5rem 0;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
}

.nav-links a:hover {
  color: var(--accent);
}

.nav-links a.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}
</style>
