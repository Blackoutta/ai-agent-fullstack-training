<script setup lang="ts">
import { Layers3 } from 'lucide-vue-next'
defineProps<{ title: string; description?: string }>()
</script>

<template>
  <div class="empty">
    <div class="empty-icon"><Layers3 :size="26" aria-hidden="true" /></div>
    <h3>{{ title }}</h3>
    <p>{{ description ?? '创建并运行实验后，真实结果将出现在这里。' }}</p>
    <slot />
  </div>
</template>
