<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { ArrowLeft, RefreshCw, Search } from 'lucide-vue-next'
import type { Run } from '../types'
import { api } from '../api'
import { pretty, runName, useWorkspace } from '../workspace'
import StatusBadge from './StatusBadge.vue'
import RunTable from './RunTable.vue'
import TraceTimeline from './TraceTimeline.vue'
import ReviewPanel from './ReviewPanel.vue'
import EmptyState from './EmptyState.vue'
const props = defineProps<{ review?: boolean }>()
const { state, runId, navigate } = useWorkspace()
const run = ref<Run | null>(null)
const loading = ref(false)
const error = ref('')
const search = ref('')
const outcome = ref('')
const experiment = ref('')
const mode = ref('')
const offline = computed(() => run.value?.mode === 'offline'
  || state.value!.experiments.find(item => item.id === run.value?.experiment_id)?.mode === 'offline')
const filtered = computed(() => state.value!.runs.filter(item => {
  const itemMode = item.mode ?? state.value!.experiments.find(e => e.id === item.experiment_id)?.mode
  return (!outcome.value || item.outcome === outcome.value)
    && (!experiment.value || item.experiment_id === experiment.value)
    && (!mode.value || itemMode === mode.value)
    && `${runName(item, 'task')} ${runName(item, 'strategy')} ${item.id}`.toLowerCase().includes(search.value.toLowerCase())
}).slice().reverse())
let generation = 0
async function load(id: string) {
  const version = ++generation
  run.value = null
  error.value = ''
  if (!id) { loading.value = false; return }
  loading.value = true
  try {
    const result = await api.run(id)
    if (version === generation) run.value = result
  } catch (cause) {
    if (version === generation) error.value = cause instanceof Error ? cause.message : '加载失败'
  } finally { if (version === generation) loading.value = false }
}
watch(runId, id => void load(id), { immediate: true })
onUnmounted(() => { generation++ })
</script>

<template>
  <section v-if="!runId" class="panel">
    <header class="panel-heading"><div><h2>{{ review ? '选择待评审运行' : '运行记录' }} <span class="count">{{ filtered.length }}</span></h2><p>离线与真实运行明确区分</p></div></header>
    <div class="filter-row wrap"><label class="search-box"><Search :size="16" /><input v-model="search" placeholder="搜索任务、策略、运行 ID" aria-label="搜索运行" /></label>
      <label class="filter-select"><span class="sr-only">结果筛选</span><select v-model="outcome"><option value="">全部结果</option><option value="pass">通过</option><option value="fail">失败</option><option value="unknown">未知</option></select></label>
      <label class="filter-select"><span class="sr-only">模式筛选</span><select v-model="mode"><option value="">全部模式</option><option value="live">真实模型</option><option value="offline">离线验证</option></select></label>
      <label class="filter-select"><span class="sr-only">实验筛选</span><select v-model="experiment"><option value="">全部实验</option><option v-for="e in state!.experiments" :key="e.id" :value="e.id">{{ e.name }}</option></select></label></div>
    <RunTable :runs="filtered" />
  </section>
  <section v-else class="panel">
    <header class="panel-heading"><button class="text-button" @click="navigate(props.review ? 'reviews' : 'trace')"><ArrowLeft :size="15" />返回运行列表</button><button class="button secondary" :disabled="loading" @click="load(runId)"><RefreshCw :size="15" />刷新详情</button></header>
    <div v-if="error" class="alert error" role="alert">{{ error }}</div>
    <EmptyState v-if="loading" title="正在加载运行证据" description="读取完整答案、工具记录与审计事件。" />
    <div v-if="run" class="run-detail">
      <div class="detail-heading"><div><p class="eyebrow mono">{{ run.id }}</p><h2>{{ runName(run, 'task') }}</h2><p>{{ runName(run, 'strategy') }} · 重复序号 #{{ run.trial }}</p></div><div class="toolbar"><StatusBadge :value="run.outcome" /><StatusBadge :value="offline ? 'offline' : 'live'" /><StatusBadge :value="run.execution_status" /></div></div>
      <p v-if="offline" class="note">离线链路验证记录：答案和结果不代表真实模型能力，回归报告暂缓采用。</p>
      <div v-if="run.error" class="alert error" role="alert">{{ run.error }}</div>
      <div class="run-metrics"><div><small>Token</small><strong>{{ run.metrics.total_tokens ?? '未知' }}</strong></div><div><small>成本 USD</small><strong>{{ run.metrics.cost_usd == null ? '未知' : `$${run.metrics.cost_usd.toFixed(5)}` }}</strong></div><div><small>耗时</small><strong>{{ run.metrics.seconds == null ? '未知' : `${run.metrics.seconds.toFixed(2)}s` }}</strong></div><div><small>源码快照</small><strong class="mono source-hash">{{ run.source_hash ?? '未记录' }}</strong></div></div>
      <details class="snapshot"><summary>任务 / 策略 / 指标快照</summary><pre class="evidence">{{ pretty({ task: run.task, strategy: run.strategy, metrics: run.metrics }) }}</pre></details>
      <h3>最终答案</h3><pre class="answer plain-text">{{ run.answer || '未记录最终答案' }}</pre>
      <ReviewPanel v-if="review" :key="run.id" :run="run" :offline="offline" @updated="run = $event" />
      <template v-else><TraceTimeline :key="run.id" :run="run" /><footer class="form-footer"><button class="button primary" @click="navigate('reviews', run.id)">进入评审中心</button></footer></template>
    </div>
  </section>
</template>
