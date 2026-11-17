<script setup lang="ts">
import { computed, ref } from 'vue'
import { FlaskConical, Play, Square } from 'lucide-vue-next'
import { api } from '../api'
import type { Experiment, ExperimentInput } from '../types'
import { date, isActive, useWorkspace } from '../workspace'
import EmptyState from '../components/EmptyState.vue'
import StatusBadge from '../components/StatusBadge.vue'
import ModalPanel from '../components/ModalPanel.vue'
import RunTable from '../components/RunTable.vue'
const { state, pending, action, error, navigate } = useWorkspace()
const form = ref<ExperimentInput>({ name: '', mode: 'offline', task_ids: [], strategy_ids: [], trials: 1, timeout: 120, max_tokens: 4096 })
const selected = ref('')
const cancelling = ref<Experiment | null>(null)
const total = computed(() => form.value.task_ids.length * form.value.strategy_ids.length * form.value.trials)
const runs = computed(() => state.value!.runs.filter(run => run.experiment_id === selected.value))
async function launch() {
  const snapshot = { ...form.value, task_ids: [...form.value.task_ids], strategy_ids: [...form.value.strategy_ids] }
  const experiment = await action(() => api.experiment(snapshot), '实验已启动，可在下方查看实时进度')
  if (experiment) { selected.value = experiment.id; form.value.name = '' }
}
async function cancel() {
  if (cancelling.value && await action(() => api.cancel(cancelling.value!.id), '已提交取消请求')) cancelling.value = null
}
const progress = (experiment: Experiment) => experiment.total ? Math.min(100, experiment.completed / experiment.total * 100) : 0
</script>

<template>
  <div class="experiment-layout">
    <section class="panel launch-panel">
      <header class="panel-heading"><div><h2>启动新实验</h2><p>同题、同源、独立会话</p></div><FlaskConical :size="22" class="accent" /></header>
      <form class="form-body" @submit.prevent="launch">
        <label>实验名称<input v-model="form.name" required placeholder="例如：检索策略回归 · 第 1 轮" /></label>
        <fieldset><legend>执行模式</legend><div class="mode-options"><label :class="{ selected: form.mode === 'offline' }"><input v-model="form.mode" type="radio" value="offline" /><strong>离线验证</strong><small>仅验证平台链路</small></label><label :class="{ selected: form.mode === 'live' }"><input v-model="form.mode" type="radio" value="live" /><strong>真实模型</strong><small>使用服务端凭据</small></label></div></fieldset>
        <p v-if="form.mode === 'live'" class="note">真实模型可能产生费用；工具保持只读且不自动批准。请确认环境与预算。</p>
        <fieldset><legend>Benchmark 任务 <span class="count">{{ form.task_ids.length }}</span></legend>
          <div v-if="state!.tasks.length" class="selection-list"><label v-for="task in state!.tasks" :key="task.id"><input v-model="form.task_ids" type="checkbox" :value="task.id" /><span>{{ task.name }}</span><small v-if="task.required">核心</small></label></div>
          <button v-else type="button" class="text-button" @click="navigate('benchmark')">先创建 Benchmark 任务</button></fieldset>
        <fieldset><legend>对比策略 <span class="count">{{ form.strategy_ids.length }}</span></legend>
          <div v-if="state!.strategies.length" class="selection-list"><label v-for="strategy in state!.strategies" :key="strategy.id"><input v-model="form.strategy_ids" type="checkbox" :value="strategy.id" /><span>{{ strategy.name }}</span><small>{{ strategy.rag_mode }}</small></label></div>
          <button v-else type="button" class="text-button" @click="navigate('strategies')">先创建策略配置</button></fieldset>
        <div class="form-grid prices"><label>重复次数<input v-model.number="form.trials" required type="number" min="1" max="20" step="1" /></label><label>超时（秒）<input v-model.number="form.timeout" required type="number" min="10" max="3600" step="1" /></label><label>Token 上限<input v-model.number="form.max_tokens" required type="number" min="128" max="1000000" step="1" /></label></div>
        <div class="run-estimate"><span>预计运行</span><strong>{{ total }} <small>次</small></strong></div>
        <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
        <button class="button primary full" :disabled="pending || !total || (form.mode === 'live' && !state!.health.node_ready)"><Play :size="16" />{{ pending ? '启动中…' : '启动实验' }}</button>
        <small v-if="form.mode === 'live' && !state!.health.node_ready" class="inline-error">Node Worker 未就绪，不能启动真实运行。</small>
      </form>
    </section>
    <section class="panel">
      <header class="panel-heading"><div><h2>实验记录 <span class="count">{{ state!.experiments.length }}</span></h2><p>每 5 秒自动同步进度</p></div><span class="live-indicator">实时</span></header>
      <EmptyState v-if="!state!.experiments.length" title="实验从这里开始" description="选择任务和策略，启动一次可复现的评测。" />
      <div v-else class="experiment-list">
        <article v-for="experiment in [...state!.experiments].reverse()" :key="experiment.id" class="experiment-card" :class="{ selected: selected === experiment.id }">
          <div class="section-heading"><button class="experiment-title" @click="selected = experiment.id">{{ experiment.name }}</button><StatusBadge :value="experiment.status" /></div>
          <div class="experiment-meta"><StatusBadge :value="experiment.mode" /><span>{{ date(experiment.created_at) }}</span></div>
          <div class="progress-label"><span>{{ experiment.task_ids.length }} 任务 × {{ experiment.strategy_ids.length }} 策略 × {{ experiment.trials }} 次</span><strong>{{ experiment.completed }} / {{ experiment.total }}</strong></div>
          <progress :value="progress(experiment)" max="100" :aria-label="`${experiment.name} 进度`"></progress>
          <div class="card-footer"><button class="text-button" @click="selected = experiment.id">查看运行记录</button><button v-if="isActive(experiment.status)" class="text-button danger" :disabled="pending" @click="cancelling = experiment"><Square :size="13" />取消实验</button></div>
        </article>
      </div>
    </section>
  </div>
  <section v-if="selected" class="panel"><header class="panel-heading"><div><h2>实验运行明细</h2><p class="mono">{{ selected }}</p></div><button class="text-button" @click="selected = ''">收起</button></header><RunTable :runs="runs" /></section>
  <ModalPanel v-if="cancelling" title="取消实验？" @close="!pending && (cancelling = null)"><div class="form-body"><p>取消「{{ cancelling.name }}」后，已完成运行的证据会保留。正在执行的运行可能需要短暂时间停止。</p><p v-if="error" class="inline-error">{{ error }}</p><footer class="form-footer"><button class="button secondary" :disabled="pending" @click="cancelling = null">继续运行</button><button class="button destructive" :disabled="pending" @click="cancel">确认取消</button></footer></div></ModalPanel>
</template>
