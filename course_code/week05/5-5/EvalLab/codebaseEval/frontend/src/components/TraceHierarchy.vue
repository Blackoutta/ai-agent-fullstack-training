<script setup lang="ts">
import { computed, ref } from 'vue'
import { pretty } from '../workspace'
import type { Run } from '../types'
const props = defineProps<{ run: Run }>()
type Evidence = Record<string, unknown>
type Tool = { id: string; name: string; records: Evidence[]; ended: boolean; failed: boolean }
type Turn = { number: number; records: Evidence[]; messages: Evidence[]; updates: number; tools: Tool[]; ended: boolean }
const expanded = ref(new Set<string>())
function kind(event: Evidence) { return String(event.event_type ?? event.type ?? '') }
function payload(event: Evidence): Evidence { return (event.payload as Evidence | undefined) ?? event }
const hierarchy = computed(() => {
  const trace = props.run.trace ?? []
  const messages = trace.filter(event => event.type === 'message')
  const ends = trace.filter(event => kind(event) === 'pi.message_end' && payload(event).role === 'assistant')
  // Completed worker messages and assistant message_end share observation order.
  // If records are incomplete, do not assign text to a potentially wrong turn.
  const aligned = messages.length === ends.length
  const turns: Turn[] = []
  let turn: Turn | undefined
  let messageIndex = 0
  for (const event of trace) {
    const type = kind(event)
    if (type === 'pi.turn_start') {
      turn = { number: turns.length + 1, records: [], messages: [], updates: 0, tools: [], ended: false }
      turns.push(turn)
    }
    if (type === 'pi.message_end' && payload(event).role === 'assistant') {
      const message = messages[messageIndex++]
      if (turn && aligned && message) turn.messages.push(message)
    }
    if (!turn) continue
    // Worker observations are separate from the stored pi event stream.
    if (!event.event_type) continue
    turn.records.push(event)
    if (type === 'pi.message_update') turn.updates++
    const data = payload(event)
    if (type === 'pi.tool_execution_start' || type === 'pi.tool_execution_end') {
      const id = String(data.tool_call_id ?? '')
      if (id) {
        let tool = turn.tools.find(item => item.id === id)
        if (!tool) {
          tool = { id, name: String(data.tool_name ?? '未知工具'), records: [], ended: false, failed: false }
          turn.tools.push(tool)
        }
        tool.records.push(event)
        if (type === 'pi.tool_execution_end') {
          tool.ended = true
          tool.failed = data.is_error === true
        }
      }
    }
    if (type === 'pi.turn_end') { turn.ended = true; turn = undefined }
  }
  for (const item of turns) {
    for (const tool of item.tools) {
      tool.records.push(...(props.run.audit ?? []).filter(event => event.tool_call_id === tool.id))
    }
  }
  return { turns, aligned, updates: trace.filter(event => kind(event) === 'pi.message_update').length }
})
function toggle(key: string, event: Event) {
  if ((event.target as HTMLDetailsElement).open) expanded.value.add(key)
  else expanded.value.delete(key)
}
</script>

<template>
  <section class="trace-tree" aria-label="运行层级">
    <header class="trace-root">
      <strong>运行 {{ run.id }}</strong>
      <span>{{ hierarchy.turns.length }} 个轮次 · pi.message_update 合并 {{ hierarchy.updates }} 次</span>
      <p class="muted">运行 → 轮次 → 模型消息 / 工具调用 → 原始事件与审计。按轮次边界与调用 ID 组织，不表示原始父子 Span。</p>
    </header>
    <p v-if="!hierarchy.aligned" class="muted">消息记录尚未完整对齐，正文保留在下方消息汇总，不推断轮次归属。</p>
    <ol class="trace-turns">
      <li v-for="turn in hierarchy.turns" :key="turn.number" class="trace-turn">
        <details open>
          <summary><strong>第 {{ turn.number }} 轮</strong> · {{ turn.ended ? '轮次已结束' : '未记录轮次结束' }} · {{ turn.tools.length }} 个工具 · {{ turn.updates }} 次流式更新</summary>
          <div class="trace-children">
            <section class="trace-message" aria-label="模型消息">
              <strong>模型消息</strong>
              <div v-for="(message, index) in turn.messages" :key="index">
                <pre v-if="message.text" class="evidence">{{ message.text }}</pre>
                <p v-else class="muted">本条消息无文本正文（可能仅有工具调用）。</p>
              </div>
              <p v-if="!turn.messages.length" class="muted">未记录可对齐的完成消息正文。</p>
            </section>
            <section v-if="turn.tools.length" class="trace-tools" aria-label="工具调用">
              <strong>工具调用</strong>
              <ol>
                <li v-for="tool in turn.tools" :key="tool.id" class="trace-tool">
                  <strong>{{ tool.name }}</strong>
                  <span :class="{ 'trace-tool-error': tool.failed }">{{ !tool.ended ? '未记录完成' : tool.failed ? '执行失败' : '执行成功' }}</span>
                  <small class="mono">{{ tool.id }}</small>
                  <details @toggle="toggle(tool.id, $event)">
                    <summary>调用事件与治理审计 · {{ tool.records.length }} 条</summary>
                    <pre v-if="expanded.has(tool.id)" class="evidence">{{ pretty(tool.records) }}</pre>
                  </details>
                </li>
              </ol>
            </section>
            <details @toggle="toggle(`turn-${turn.number}`, $event)">
              <summary>本轮原始事件 · {{ turn.records.length }} 条（含流式更新）</summary>
              <pre v-if="expanded.has(`turn-${turn.number}`)" class="evidence">{{ pretty(turn.records) }}</pre>
            </details>
          </div>
        </details>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.trace-root { padding: 16px; border: 1px solid #dce4f6; border-radius: 8px; background: #f3f6ff; }
.trace-root > strong, .trace-root > span { display: block; overflow-wrap: anywhere; }
.trace-root > span { margin-top: 8px; font-size: 12px; color: #62718a; }
.trace-root p { margin-bottom: 0; }
.trace-turns { list-style: none; margin: 0 0 0 16px; padding: 16px 0 0 20px; border-left: 2px solid #dce4f6; }
.trace-turn { margin-bottom: 16px; border: 1px solid #e3e9f4; border-radius: 8px; padding: 14px; background: #fff; }
.trace-turn > details > summary { font-size: 12px; line-height: 1.8; color: #445775; }
.trace-children { margin: 14px 0 0 8px; padding-left: 16px; border-left: 2px solid #e7ecf4; }
.trace-message, .trace-tools { margin-bottom: 18px; }
.trace-tools > ol { list-style: none; margin: 10px 0 0 8px; padding-left: 14px; border-left: 1px solid #dce4f6; }
.trace-tool { padding: 12px; margin-bottom: 10px; background: #f8fafd; border-radius: 6px; }
.trace-tool > span { margin-left: 12px; color: #347761; font-size: 11px; }
.trace-tool > span.trace-tool-error { color: #b24b58; }
.trace-tool > small { display: block; margin: 8px 0; overflow-wrap: anywhere; color: #62718a; }
@media (max-width: 600px) {
  .trace-turns { margin-left: 6px; padding-left: 10px; }
  .trace-turn { padding: 10px; }
  .trace-children { margin-left: 0; padding-left: 10px; }
}
</style>
