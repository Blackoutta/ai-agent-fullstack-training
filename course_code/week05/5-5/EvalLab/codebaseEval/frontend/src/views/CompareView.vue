<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ArrowRight, Download, GitCompareArrows } from 'lucide-vue-next'
import { api, downloadReport } from '../api'
import type { Comparison, CompareQuery } from '../types'
import { pretty, useWorkspace } from '../workspace'
import StatusBadge from '../components/StatusBadge.vue'
import EmptyState from '../components/EmptyState.vue'
const { state, pending, action, error } = useWorkspace()
const query = ref<CompareQuery>({ baseline: '', candidate: '', experiment: '' })
const result = ref<Comparison | null>(null)
const comparedQuery = ref<CompareQuery | null>(null)
const experiment = computed(() => state.value!.experiments.find(e => e.id === query.value.experiment))
const options = computed(() => {
  const ids = experiment.value?.strategy_ids ?? []
  const strategies = new Map(state.value!.strategies.map(s => [s.id!, s.name]))
  for (const run of state.value!.runs.filter(r => r.experiment_id === query.value.experiment)) {
    if (!strategies.has(run.strategy_id)) strategies.set(run.strategy_id, run.strategy?.name ?? run.strategy_name ?? run.strategy_id)
  }
  return ids.map(id => ({ id, name: strategies.get(id) ?? `${id}（历史快照）` }))
})
const valid = computed(() => query.value.experiment && query.value.baseline && query.value.candidate
  && query.value.baseline !== query.value.candidate)
const gate = computed(() => {
  if (!result.value?.rows.length || experiment.value?.mode === 'offline') return 'hold'
  const value = result.value.gate
  return typeof value === 'string' ? value : String(value.status ?? value.decision ?? 'hold')
})
watch(() => query.value.experiment, () => { query.value.baseline = ''; query.value.candidate = '' })
watch(query, () => { result.value = null; comparedQuery.value = null }, { deep: true })
let generation = 0
async function compare() {
  if (!valid.value) return
  const snapshot = { ...query.value }
  const version = ++generation
  const comparison = await action(() => api.compare(snapshot))
  if (comparison && version === generation && JSON.stringify(snapshot) === JSON.stringify(query.value)) {
    result.value = comparison
    comparedQuery.value = snapshot
  }
}
async function exportReport(format: 'md' | 'json') {
  if (comparedQuery.value) await action(() => downloadReport(comparedQuery.value!, format), '回归报告已导出')
}
function outcome(value: unknown) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'outcome' in value) return String(value.outcome)
  return 'unknown'
}
</script>

<template>
  <section class="panel compare-controls">
    <form @submit.prevent="compare">
      <label>同条件实验<select v-model="query.experiment" required><option value="" disabled>选择实验</option><option v-for="e in state!.experiments" :key="e.id" :value="e.id">{{ e.name }} · {{ e.mode === 'offline' ? '离线' : '真实模型' }}</option></select></label>
      <label>基线策略<select v-model="query.baseline" required :disabled="!query.experiment"><option value="" disabled>选择 Baseline</option><option v-for="s in options" :key="s.id" :value="s.id">{{ s.name }}</option></select></label>
      <ArrowRight class="compare-arrow" :size="20" />
      <label>候选策略<select v-model="query.candidate" required :disabled="!query.experiment"><option value="" disabled>选择 Candidate</option><option v-for="s in options" :key="s.id" :value="s.id" :disabled="s.id === query.baseline">{{ s.name }}</option></select></label>
      <button class="button primary" :disabled="!valid || pending"><GitCompareArrows :size="16" />开始对比</button>
    </form>
    <p class="subtle">仅匹配同一实验、同任务快照、同源码与重复序号。必须完成全部配对，核心失败或未知将暂缓采用。</p>
  </section>
  <section v-if="!result" class="panel"><EmptyState title="选择基线与候选策略" description="比较逐题改善、退化与持平，并导出有证据约束的回归报告。" /></section>
  <template v-else>
    <section class="panel">
      <header class="panel-heading"><div><h2>回归门禁 <StatusBadge :value="gate" /></h2><p>{{ result.note || '以服务端匹配条件与门禁结果为依据' }}</p></div><div class="toolbar"><button class="button secondary" :disabled="pending" @click="exportReport('md')"><Download :size="15" />Markdown</button><button class="button secondary" :disabled="pending" @click="exportReport('json')"><Download :size="15" />JSON</button></div></header>
      <div v-if="experiment?.mode === 'offline'" class="note">离线实验不具备真实模型成绩，无论结果如何都暂缓采用。</div>
      <div v-if="!result.rows.length" class="note">没有同条件配对，不给出改善或发布结论。</div>
      <div class="comparison-summary"><div v-for="(value, key) in result.summary" :key="key"><small>{{ key }}</small><strong>{{ typeof value === 'object' ? pretty(value) : value }}</strong></div></div>
      <details class="snapshot"><summary>门禁原始依据</summary><pre class="evidence">{{ pretty(result.gate) }}</pre></details>
    </section>
    <section class="panel"><header class="panel-heading"><h2>逐题对比 <span class="count">{{ result.rows.length }}</span></h2><span class="subtle">同条件配对</span></header>
      <div class="table-scroll"><table><thead><tr><th>任务</th><th>重复序号</th><th>基线</th><th>候选</th><th>变化</th><th>证据</th></tr></thead><tbody>
        <tr v-for="row in result.rows" :key="`${row.task_id}-${row.trial}`"><td><strong>{{ row.task_name }}</strong><small class="mono">{{ row.task_id }}</small></td><td>#{{ row.trial }}</td><td><StatusBadge :value="outcome(row.before)" /></td><td><StatusBadge :value="outcome(row.after)" /></td><td><StatusBadge :value="row.change" /></td><td><details><summary>配对详情</summary><pre class="evidence">{{ pretty({ before: row.before, after: row.after }) }}</pre></details></td></tr>
      </tbody></table></div>
    </section>
  </template>
  <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
</template>
