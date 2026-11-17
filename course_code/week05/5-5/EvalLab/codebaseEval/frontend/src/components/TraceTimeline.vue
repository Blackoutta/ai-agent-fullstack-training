<script setup lang="ts">
import { computed, ref } from 'vue'
import { Code2, MessageSquare, Search, ShieldCheck, Wrench } from 'lucide-vue-next'
import type { Run } from '../types'
import { pretty } from '../workspace'
import EmptyState from './EmptyState.vue'
import TraceHierarchy from './TraceHierarchy.vue'
const props = defineProps<{ run: Run }>()
const tab = ref<'trace' | 'audit' | 'retrieval'>('trace')
const showEvents = ref(false)
const hasTurns = computed(() => (props.run.trace ?? []).some(event => event.event_type === 'pi.turn_start'))
const expanded = ref(new Set<number>())
const tabs = [{ id: 'trace', title: '模型与工具', icon: MessageSquare },
  { id: 'audit', title: '治理审计', icon: ShieldCheck }, { id: 'retrieval', title: '召回证据', icon: Search }] as const
const events = computed(() => {
  const groups: { event: Record<string, unknown>; records: Record<string, unknown>[]; index: number }[] = []
  let updates: typeof groups[number] | undefined
  for (const [index, event] of (props.run[tab.value] ?? []).entries()) {
    if (tab.value === 'trace' && isUpdate(event)) {
      if (!updates) {
        updates = { event, records: [], index }
        groups.unshift(updates)
      }
      updates.records.push(event)
    } else {
      groups.push({ event, records: [event], index })
    }
  }
  return groups
})
function title(event: Record<string, unknown>) {
  return String(event.event_type ?? event.type ?? event.event ?? event.kind ?? event.role ?? '执行事件')
}
function isUpdate(event: Record<string, unknown>) {
  return /^(pi\.)?message_update$/.test(title(event))
}
function messageText(event: Record<string, unknown>): string {
  if (typeof event.text === 'string') return event.text
  const payload = event.payload as Record<string, unknown> | undefined
  const message = (event.message ?? payload?.message) as Record<string, unknown> | undefined
  if (typeof message?.content === 'string') return message.content
  if (Array.isArray(message?.content)) {
    return message.content.filter(part => part?.type === 'text' && typeof part.text === 'string')
      .map(part => part.text).join('\n')
  }
  return ''
}
const messages = computed(() => (props.run.trace ?? []).filter(event => event.type === 'message'))
function toggle(index: number, event: Event) {
  if ((event.target as HTMLDetailsElement).open) expanded.value.add(index)
  else expanded.value.delete(index)
}
function time(event: Record<string, unknown>, index: number) {
  return String(event.timestamp ?? event.created_at ?? event.time ?? event.at ?? `步骤 ${index + 1}`)
}
</script>

<template>
  <div class="tabs" role="tablist" aria-label="执行证据">
    <button v-for="item in tabs" :id="`tab-${item.id}`" :key="item.id" role="tab"
      :aria-selected="tab === item.id" :aria-controls="`evidence-${item.id}`" :class="{ active: tab === item.id }"
      @click="tab = item.id; expanded.clear()"><component :is="item.icon" :size="16" />{{ item.title }}<span class="count">{{ run[item.id]?.length ?? 0 }}</span></button>
  </div>
  <div :id="`evidence-${tab}`" role="tabpanel" :aria-labelledby="`tab-${tab}`">
    <EmptyState v-if="!events.length" title="没有记录此类事件" description="仅展示 Worker 实际回传的执行证据，不生成模拟 Trace。" />
    <template v-if="tab === 'trace' && hasTurns">
      <TraceHierarchy :run="run" />
      <button class="button trace-events-toggle" :aria-expanded="showEvents" @click="showEvents = !showEvents">
        {{ showEvents ? '收起事件总览与消息汇总' : '展开事件总览与消息汇总' }}
      </button>
    </template>
    <ol v-if="events.length && (tab !== 'trace' || !hasTurns || showEvents)" class="timeline">
      <li v-for="group in events" :key="`${tab}-${group.index}`">
        <span class="timeline-icon"><component :is="tab === 'audit' ? ShieldCheck : tab === 'retrieval' ? Search : /tool/i.test(title(group.event)) ? Wrench : Code2" :size="15" /></span>
        <div class="timeline-content"><div class="section-heading"><strong>{{ title(group.event) }}<span v-if="tab === 'trace' && isUpdate(group.event)" class="count">合并 {{ group.records.length }} 次</span></strong><small class="mono">{{ time(group.event, group.index) }}</small></div>
          <template v-if="tab === 'trace' && isUpdate(group.event)">
            <p class="muted">全部流式更新汇总；以下按完成消息顺序显示正文，不代表单次连续更新。</p>
            <div v-for="(message, index) in messages" :key="index">
              <strong>message {{ index + 1 }}</strong>
              <pre v-if="messageText(message)" class="evidence">{{ messageText(message) }}</pre>
              <p v-else class="muted">本条消息无文本正文（可能仅有工具调用）。</p>
            </div>
            <p v-if="!messages.length" class="muted">未记录完成消息正文，原始更新中可能仅有事件元数据。</p>
          </template>
          <pre v-else-if="messageText(group.event)" class="evidence">{{ messageText(group.event) }}</pre>
          <details @toggle="toggle(group.index, $event)"><summary>{{ tab === 'trace' && isUpdate(group.event) ? `查看 ${group.records.length} 条原始事件` : '查看事件详情' }}</summary><pre v-if="expanded.has(group.index)" class="evidence">{{ pretty(group.records.length > 1 ? group.records : group.event) }}</pre></details></div>
      </li>
    </ol>
  </div>
</template>
