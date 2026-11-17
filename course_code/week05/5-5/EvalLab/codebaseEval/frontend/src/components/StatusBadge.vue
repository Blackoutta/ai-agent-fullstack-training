<script setup lang="ts">
import { computed } from 'vue'
const props = defineProps<{ value: string }>()
const labels: Record<string, string> = {
  pass: '通过', fail: '失败', unknown: '待判定', running: '运行中', queued: '排队中',
  pending: '等待中', completed: '已完成', cancelled: '已取消', cancelling: '取消中',
  error: '执行错误', timeout: '超时', live: '真实模型', offline: '离线验证',
  hold: '暂缓采用', adopt: '可采用', improved: '改善', regressed: '退化', unchanged: '持平',
}
const tone = computed(() => {
  if (['pass', 'adopt', 'improved', 'completed'].includes(props.value)) return 'good'
  if (['fail', 'error', 'timeout', 'regressed'].includes(props.value)) return 'bad'
  if (['running', 'live'].includes(props.value)) return 'blue'
  return 'neutral'
})
</script>

<template>
  <span class="badge" :class="tone"><span class="status-dot"></span>{{ labels[value] ?? value }}</span>
</template>
