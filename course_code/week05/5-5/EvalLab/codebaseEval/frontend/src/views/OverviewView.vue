<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, CheckCheck, Coins, FlaskConical, Timer } from 'lucide-vue-next'
import { percent, useWorkspace } from '../workspace'
import RunTable from '../components/RunTable.vue'
import EmptyState from '../components/EmptyState.vue'
import StatusBadge from '../components/StatusBadge.vue'
const { state, navigate } = useWorkspace()
const summary = computed(() => state.value!.summary)
const stats = computed(() => [
  { title: '总运行次数', value: summary.value.runs.toLocaleString(), hint: `${state.value!.experiments.length} 个实验 · ${state.value!.tasks.length} 个任务`, icon: FlaskConical },
  { title: '成功率', value: summary.value.runs ? percent(summary.value.success_rate) : '暂无', hint: `${summary.value.passed} 通过 · ${summary.value.failed} 失败 · ${summary.value.unknown} 未知`, icon: CheckCheck },
  { title: '已知成本', value: `$${summary.value.known_cost_usd.toFixed(4)}`, hint: `${summary.value.unknown_cost_runs} 次成本缺失，非零成本`, icon: Coins },
  { title: '平均耗时', value: summary.value.mean_seconds == null ? '暂无' : `${summary.value.mean_seconds.toFixed(1)}s`, hint: '以实际运行计时为依据', icon: Timer },
])
const segments = computed(() => [
  { name: '通过', value: summary.value.passed, tone: 'good-fill' },
  { name: '失败', value: summary.value.failed, tone: 'bad-fill' },
  { name: '未知', value: summary.value.unknown, tone: 'neutral-fill' },
])
</script>

<template>
  <section class="stats-grid" aria-label="评测核心指标">
    <article v-for="stat in stats" :key="stat.title" class="stat-card">
      <div class="stat-label">{{ stat.title }}<component :is="stat.icon" :size="19" /></div>
      <strong class="stat-number">{{ stat.value }}</strong><small>{{ stat.hint }}</small>
    </article>
  </section>
  <div class="overview-grid">
    <section class="panel">
      <header class="panel-heading"><div><h2>结果分布</h2><p>程序检查与语义评审的综合判定</p></div><span class="subtle">全部运行</span></header>
      <EmptyState v-if="!summary.runs" title="还没有可统计的结果" />
      <div v-else class="distribution">
        <div class="distribution-total"><strong>{{ summary.runs }}</strong><span>次运行</span></div>
        <div class="stacked-bar" role="img" :aria-label="segments.map(s => `${s.name} ${s.value}`).join('，')">
          <span v-for="s in segments" :key="s.name" :class="s.tone" :style="{ width: `${s.value / summary.runs * 100}%` }"></span>
        </div>
        <div class="legend"><div v-for="s in segments" :key="s.name"><i :class="s.tone"></i>{{ s.name }}<strong>{{ s.value }}</strong></div></div>
      </div>
      <div class="metric-strip"><div><small>总 Token</small><strong>{{ summary.total_tokens.toLocaleString() }}</strong><small>{{ summary.unknown_token_runs }} 次用量缺失</small></div>
        <div><small>工具调用</small><strong>{{ summary.tool_calls }}</strong><small>{{ summary.tool_errors }} 次错误 · {{ summary.tool_calls ? percent(summary.tool_errors / summary.tool_calls) : '暂无错误率' }}</small></div></div>
    </section>
    <section class="panel">
      <header class="panel-heading"><div><h2>策略表现</h2><p>成功率仅依据实际记录</p></div><button class="text-button" @click="navigate('compare')">对比 <ArrowRight :size="14" /></button></header>
      <EmptyState v-if="!summary.by_strategy.length" title="等待策略运行" />
      <div v-else class="strategy-bars">
        <div v-for="item in summary.by_strategy" :key="item.strategy_id">
          <div class="bar-label"><strong>{{ item.name ?? state!.strategies.find(s => s.id === item.strategy_id)?.name ?? item.strategy_id }}</strong><span>{{ percent(item.success_rate ?? (item.runs ? item.passed / item.runs : null)) }}</span></div>
          <div class="bar-track"><span :style="{ width: `${item.runs ? item.passed / item.runs * 100 : 0}%` }"></span></div>
          <small>{{ item.runs }} 次运行 · 未知 {{ item.unknown ?? 0 }}</small>
        </div>
      </div>
    </section>
  </div>
  <section class="panel">
    <header class="panel-heading"><div><h2>最近运行</h2><p>从结果进入完整执行证据</p></div><button class="text-button" @click="navigate('trace')">查看全部 <ArrowRight :size="14" /></button></header>
    <RunTable :runs="state!.runs.slice(-5).reverse()" />
  </section>
  <section class="environment panel"><div><h2>运行环境</h2><p class="mono">{{ state!.health.codebase_path }}</p></div>
    <StatusBadge :value="state!.health.node_ready ? 'completed' : 'error'" />
    <span v-for="credential in state!.health.credentials" :key="credential.env" class="subtle">{{ credential.env }}：{{ credential.configured ? '已配置' : '未配置' }}</span>
  </section>
</template>
