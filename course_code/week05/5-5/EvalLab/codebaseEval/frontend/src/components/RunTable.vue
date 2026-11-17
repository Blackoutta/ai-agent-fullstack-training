<script setup lang="ts">
import type { Run } from '../types'
import { runName, useWorkspace } from '../workspace'
import StatusBadge from './StatusBadge.vue'
import EmptyState from './EmptyState.vue'
defineProps<{ runs: Run[] }>()
const { navigate, state } = useWorkspace()
function mode(run: Run) {
  return run.mode ?? state.value?.experiments.find(item => item.id === run.experiment_id)?.mode ?? 'live'
}
</script>

<template>
  <EmptyState v-if="!runs.length" title="暂无运行记录" />
  <div v-else class="table-scroll">
    <table>
      <thead><tr><th>任务 / 运行</th><th>策略</th><th>结果</th><th>模式</th><th>重复序号</th><th>Token</th><th>详情</th></tr></thead>
      <tbody>
        <tr v-for="run in runs" :key="run.id">
          <td><strong>{{ runName(run, 'task') }}</strong><small class="mono">{{ run.id }}</small></td>
          <td>{{ runName(run, 'strategy') }}</td>
          <td><StatusBadge :value="run.outcome" /></td><td><StatusBadge :value="mode(run)" /></td>
          <td class="mono">#{{ run.trial }}</td>
          <td class="mono">{{ run.metrics.total_tokens ?? '未记录' }}</td>
          <td><button class="text-button" @click="navigate('trace', run.id)">Trace</button>
            <button class="text-button" @click="navigate('reviews', run.id)">评审</button></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
