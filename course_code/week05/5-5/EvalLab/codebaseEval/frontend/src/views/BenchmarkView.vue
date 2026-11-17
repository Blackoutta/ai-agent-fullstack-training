<script setup lang="ts">
import { computed, ref, toRaw } from 'vue'
import { Download, Plus, Search, Upload } from 'lucide-vue-next'
import { api, downloadJson } from '../api'
import type { Check, Task } from '../types'
import { useWorkspace } from '../workspace'
import ModalPanel from '../components/ModalPanel.vue'
import EmptyState from '../components/EmptyState.vue'
const { state, pending, action, error } = useWorkspace()
const search = ref('')
const editor = ref<Task | null>(null)
const tags = ref('')
const deleting = ref<Task | null>(null)
const importOpen = ref(false)
const importText = ref('')
const importError = ref('')
const fileInput = ref<HTMLInputElement>()
const filtered = computed(() => state.value!.tasks.filter(task =>
  `${task.name} ${task.prompt} ${task.tags.join(' ')}`.toLowerCase().includes(search.value.toLowerCase())))
function edit(task?: Task) {
  editor.value = task ? structuredClone(toRaw(task)) : { name: '', prompt: '', tags: [], required: true, checks: [], rubric: '' }
  tags.value = editor.value.tags.join(', ')
}
function addCheck() {
  editor.value?.checks.push({ id: `check-${Date.now()}`, type: 'contains', value: '' })
}
async function save() {
  if (!editor.value) return
  const task = { ...editor.value, tags: tags.value.split(/[,，]/).map(s => s.trim()).filter(Boolean) }
  if (await action(() => api.saveTask(task), 'Benchmark 已保存，历史运行快照保持不变')) editor.value = null
}
async function remove() {
  const id = deleting.value?.id
  if (!id) return
  const success = await action(async () => { await api.deleteTask(id); return true }, '任务已删除')
  if (success) deleting.value = null
}
async function loadFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('请使用小于 5 MB 的 JSON 文件')
    importText.value = await file.text()
    importOpen.value = true
    importError.value = ''
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '文件读取失败' }
  input.value = ''
}
function parseTasks(text: string): Task[] {
  const data: unknown = JSON.parse(text)
  const tasks: unknown = Array.isArray(data) ? data : data && typeof data === 'object' && 'tasks' in data ? data.tasks : null
  if (!Array.isArray(tasks) || !tasks.length) throw new Error('需要非空任务数组或 {"tasks": [...]}')
  for (const task of tasks) {
    if (!task || typeof task !== 'object' || typeof task.name !== 'string' || !task.name.trim()
      || typeof task.prompt !== 'string' || !task.prompt.trim()
      || !Array.isArray(task.checks) || !Array.isArray(task.tags) || typeof task.required !== 'boolean'
      || typeof task.rubric !== 'string') throw new Error('每个任务需要 name、prompt、tags[]、required、checks[] 和 rubric')
    for (const check of task.checks as Check[]) {
      if (!check || !['contains', 'regex', 'tool_called', 'no_tool_errors'].includes(check.type)
        || typeof check.id !== 'string' || typeof check.value !== 'string') throw new Error('检查项格式不正确')
    }
  }
  return tasks as Task[]
}
async function importTasks() {
  importError.value = ''
  try {
    const tasks = parseTasks(importText.value)
    const done = await action(async () => { await api.importTasks(tasks); return true }, '任务已导入')
    if (done) { importOpen.value = false; importText.value = '' }
  } catch (cause) { importError.value = cause instanceof Error ? cause.message : 'JSON 格式错误' }
}
async function exportTasks() {
  await action(async () => { downloadJson(await api.exportTasks(), 'benchmark.json'); return true }, 'Benchmark 已导出')
}
</script>

<template>
  <section class="panel">
    <header class="panel-heading"><div><h2>任务集 <span class="count">{{ state!.tasks.length }}</span></h2><p>核心任务失败将阻止策略采用</p></div>
      <div class="toolbar"><button class="button secondary" :disabled="pending" @click="exportTasks"><Download :size="15" />导出</button>
        <button class="button secondary" @click="importOpen = true"><Upload :size="15" />导入 JSON</button>
        <button class="button primary" @click="edit()"><Plus :size="16" />新建任务</button></div></header>
    <div class="filter-row"><label class="search-box"><Search :size="17" /><input v-model="search" aria-label="搜索任务" placeholder="搜索任务名称、提示词或标签" /></label><span class="subtle">{{ filtered.length }} 个任务</span></div>
    <EmptyState v-if="!filtered.length" :title="search ? '没有匹配的任务' : '建立你的第一组 Benchmark'" description="用真实问题、程序检查和语义评分标准定义成功。"><button class="button primary" @click="edit()">创建任务</button></EmptyState>
    <div v-else class="table-scroll"><table><thead><tr><th>任务</th><th>标签</th><th>验收检查</th><th>等级</th><th>版本</th><th>操作</th></tr></thead><tbody>
      <tr v-for="task in filtered" :key="task.id"><td><strong>{{ task.name }}</strong><small class="truncate">{{ task.prompt }}</small></td>
        <td><span v-for="tag in task.tags" :key="tag" class="tag">{{ tag }}</span><span v-if="!task.tags.length" class="subtle">无标签</span></td>
        <td>{{ task.checks.length }} 项</td><td><span class="badge" :class="task.required ? 'blue' : 'neutral'">{{ task.required ? '核心' : '普通' }}</span></td>
        <td class="mono">v{{ task.version ?? 1 }}</td><td><button class="text-button" @click="edit(task)">编辑</button><button class="text-button danger" @click="deleting = task">删除</button></td></tr>
    </tbody></table></div>
  </section>
  <ModalPanel v-if="editor" :title="editor.id ? '编辑 Benchmark 任务' : '新建 Benchmark 任务'" @close="!pending && (editor = null)">
    <form class="form-body" @submit.prevent="save">
      <label>任务名称<input v-model="editor.name" required maxlength="120" placeholder="例如：解释工具审批的完整链路" /></label>
      <label>任务 Prompt<textarea v-model="editor.prompt" required rows="4" placeholder="描述模型需要解决的真实问题" /></label>
      <div class="form-grid"><label>标签（逗号分隔）<input v-model="tags" placeholder="架构, 工具, 安全" /></label><label class="checkbox-label"><input v-model="editor.required" type="checkbox" />核心任务，回归门禁必须通过</label></div>
      <label>语义评分标准 Rubric<textarea v-model="editor.rubric" rows="3" placeholder="描述准确性、引用证据与完整性的评分依据" /></label>
      <div class="section-heading"><h3>程序检查</h3><button type="button" class="text-button" @click="addCheck"><Plus :size="14" />添加检查</button></div>
      <div v-for="(check, index) in editor.checks" :key="check.id" class="check-row">
        <label>类型<select v-model="check.type"><option value="contains">包含文本</option><option value="regex">正则匹配</option><option value="tool_called">工具被调用</option><option value="no_tool_errors">无工具错误</option></select></label>
        <label>匹配值<input v-model="check.value" :required="check.type !== 'no_tool_errors'" :disabled="check.type === 'no_tool_errors'" /></label>
        <button type="button" class="text-button danger" :aria-label="`删除检查 ${index + 1}`" @click="editor.checks.splice(index, 1)">移除</button>
      </div>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <footer class="form-footer"><button type="button" class="button secondary" :disabled="pending" @click="editor = null">取消</button><button class="button primary" :disabled="pending">{{ pending ? '保存中…' : '保存任务' }}</button></footer>
    </form>
  </ModalPanel>
  <ModalPanel v-if="importOpen" title="导入 Benchmark" @close="!pending && (importOpen = false)">
    <form class="form-body" @submit.prevent="importTasks"><p class="subtle">支持导出的 {"tasks": [...]} 或任务数组。有 id 的任务将更新，请先导出备份。</p>
      <input ref="fileInput" type="file" accept=".json,application/json" aria-label="选择任务 JSON 文件" @change="loadFile" />
      <button type="button" class="button secondary" @click="fileInput?.click()">选择 JSON 文件</button>
      <label>JSON 内容<textarea v-model="importText" required rows="12" class="mono" placeholder='{"tasks": []}' /></label>
      <p v-if="importError || error" class="inline-error" role="alert">{{ importError || error }}</p>
      <footer class="form-footer"><button type="button" class="button secondary" :disabled="pending" @click="importOpen = false">取消</button><button class="button primary" :disabled="pending">确认导入</button></footer>
    </form>
  </ModalPanel>
  <ModalPanel v-if="deleting" title="删除任务？" @close="!pending && (deleting = null)"><div class="form-body"><p>将删除「{{ deleting.name }}」。已完成运行的任务快照不受影响。</p><p v-if="error" class="inline-error">{{ error }}</p><footer class="form-footer"><button class="button secondary" :disabled="pending" @click="deleting = null">保留</button><button class="button destructive" :disabled="pending" @click="remove">确认删除</button></footer></div></ModalPanel>
</template>
