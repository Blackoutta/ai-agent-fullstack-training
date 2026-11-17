<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, CircleAlert } from 'lucide-vue-next'
import { useWorkspace } from '../workspace'
import EmptyState from '../components/EmptyState.vue'
import RunTable from '../components/RunTable.vue'
const { state, navigate } = useWorkspace()
const selected = ref('')
const categories: Record<string, string> = {
  execution_error: '执行错误', tool_error: '工具调用失败', program_check: '程序检查未通过',
  check_failed: '程序检查未通过', judge_failed: '语义评审未通过', timeout: '运行超时',
  unknown: '证据不足', cancelled: '运行被取消', semantic_failure: '语义判定失败',
}
const clusters = computed(() => [...state.value!.clusters].sort((a, b) => b.count - a.count))
const max = computed(() => Math.max(1, ...clusters.value.map(item => item.count)))
const cluster = computed(() => clusters.value.find(item => item.category === selected.value))
const samples = computed(() => state.value!.runs.filter(run => cluster.value?.run_ids.includes(run.id)))
</script>

<template>
  <div class="note"><CircleAlert :size="17" /><span>这里是基于记录的失败分类，不是已确认根因。请进入 Trace 核查具体证据，再制定修复方案。</span></div>
  <section class="panel">
    <header class="panel-heading"><div><h2>失败类别分布</h2><p>{{ clusters.length }} 类可追溯问题</p></div></header>
    <EmptyState v-if="!clusters.length" title="暂无失败分类" description="有失败或未知记录后，将按后端可追溯类别展示。没有记录不等于全部通过。" />
    <div v-else class="cluster-list"><button v-for="item in clusters" :key="item.category" class="cluster-row" :class="{ selected: selected === item.category }" @click="selected = item.category">
      <span class="cluster-icon"><CircleAlert :size="19" /></span><span class="cluster-label"><strong>{{ categories[item.category] ?? item.category }}</strong><small class="mono">{{ item.category }}</small></span>
      <span class="cluster-track"><span :style="{ width: `${item.count / max * 100}%` }"></span></span><strong class="cluster-count">{{ item.count }}</strong><ArrowRight :size="16" />
    </button></div>
  </section>
  <section v-if="cluster" class="panel"><header class="panel-heading"><div><h2>{{ categories[cluster.category] ?? cluster.category }} · 样本</h2><p>保留原始运行 ID，支持追溯</p></div><button class="text-button" @click="selected = ''">收起</button></header>
    <RunTable :runs="samples" /><div class="sample-links"><button v-for="id in cluster.run_ids.filter(id => !samples.some(run => run.id === id))" :key="id" class="text-button mono" @click="navigate('trace', id)">{{ id }}</button></div>
  </section>
</template>
