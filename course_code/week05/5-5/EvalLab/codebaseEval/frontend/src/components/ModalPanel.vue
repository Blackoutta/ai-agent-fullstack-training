<script setup lang="ts">
import { onMounted, onUnmounted, ref, useId } from 'vue'
import { X } from 'lucide-vue-next'
defineProps<{ title: string }>()
const emit = defineEmits<{ close: [] }>()
const panel = ref<HTMLElement>()
const id = useId()
let previous: HTMLElement | null = null
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
  if (event.key !== 'Tab') return
  const nodes = panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href]')
  if (!nodes?.length) return
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onMounted(() => {
  previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  panel.value?.focus()
  document.addEventListener('keydown', keydown)
})
onUnmounted(() => { document.removeEventListener('keydown', keydown); previous?.focus() })
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop">
      <section ref="panel" role="dialog" aria-modal="true" :aria-labelledby="id" tabindex="-1" class="modal">
        <header class="panel-heading"><h2 :id="id">{{ title }}</h2>
          <button type="button" class="icon-button" aria-label="关闭弹窗" @click="emit('close')"><X :size="20" /></button>
        </header>
        <slot />
      </section>
    </div>
  </Teleport>
</template>
