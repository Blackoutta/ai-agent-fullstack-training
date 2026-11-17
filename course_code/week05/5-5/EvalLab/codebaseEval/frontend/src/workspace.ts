import { inject, ref, type InjectionKey } from 'vue'
import { api } from './api'
import type { Page, PlatformState, Run } from './types'

export const pages: { id: Page; title: string; subtitle: string }[] = [
  { id: 'overview', title: '评测概览', subtitle: '让每一次策略迭代，都有证据可循。' },
  { id: 'benchmark', title: 'Benchmark', subtitle: '定义真实任务与验收标准，建立可复用的评测基线。' },
  { id: 'strategies', title: '策略配置', subtitle: '管理 Prompt、模型与检索配置，运行时保留完整快照。' },
  { id: 'experiments', title: '实验工作台', subtitle: '在一致的源码基线上，运行任务 × 策略 × 重复次数。' },
  { id: 'trace', title: '运行 Trace', subtitle: '沿时间轴还原模型、工具与检索证据。' },
  { id: 'reviews', title: '评审中心', subtitle: '程序检查、独立 Judge 与人工评审，保留每一份判断。' },
  { id: 'clusters', title: '失败聚类', subtitle: '从可追溯的失败类别出发，找到下一次改进方向。' },
  { id: 'compare', title: '回归对比', subtitle: '只比较同条件样本，让改善与退化都清晰可见。' },
]
export function createWorkspace() {
  const state = ref<PlatformState | null>(null)
  const loading = ref(false)
  const pending = ref(false)
  const error = ref('')
  const notice = ref('')
  const refreshedAt = ref('')
  const page = ref<Page>('overview')
  const runId = ref('')
  let fetching = false
  let connectionFailure = ''
  function readHash() {
    const [name, id] = location.hash.slice(1).split('/')
    page.value = pages.find(item => item.id === name)?.id ?? 'overview'
    try { runId.value = id ? decodeURIComponent(id) : '' }
    catch { runId.value = ''; error.value = '运行链接格式不正确' }
  }
  function navigate(target: Page, id = '') {
    location.hash = `${target}${id ? `/${encodeURIComponent(id)}` : ''}`
    page.value = target
    runId.value = id
  }
  async function refresh() {
    if (fetching) return
    fetching = true
    loading.value = true
    try {
      state.value = await api.state()
      refreshedAt.value = new Date().toLocaleTimeString('zh-CN', { hour12: false })
      if (error.value === connectionFailure) error.value = ''
      connectionFailure = ''
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '无法连接评测服务'
      if (!error.value || error.value === connectionFailure) error.value = message
      connectionFailure = message
    } finally {
      fetching = false
      loading.value = false
    }
  }
  async function action<T>(operation: () => Promise<T>, message = ''): Promise<T | undefined> {
    if (pending.value) return
    pending.value = true
    error.value = ''
    connectionFailure = ''
    notice.value = ''
    try {
      const result = await operation()
      notice.value = message
      await refresh()
      return result
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '操作失败'
      return undefined
    } finally { pending.value = false }
  }
  return { state, loading, pending, error, notice, refreshedAt, page, runId, readHash, navigate, refresh, action }
}
export type Workspace = ReturnType<typeof createWorkspace>
export const workspaceKey: InjectionKey<Workspace> = Symbol('workspace')
export function useWorkspace() {
  const workspace = inject(workspaceKey)
  if (!workspace) throw new Error('Workspace provider missing')
  return workspace
}
export function runName(run: Run, kind: 'task' | 'strategy') {
  return kind === 'task' ? run.task?.name ?? run.task_name ?? run.task_id
    : run.strategy?.name ?? run.strategy_name ?? run.strategy_id
}
export function percent(value: number | null | undefined) {
  return value == null ? '暂无' : `${(value * 100).toFixed(1)}%`
}
export function evidence(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(evidence)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) =>
      !/^(thinking|reasoning|chain_of_thought|reasoning_content|api_key|authorization|password|secret)$/i.test(key))
      .map(([key, child]) => [key, evidence(child)]))
  }
  return value
}
export function pretty(value: unknown) { return JSON.stringify(evidence(value), null, 2) ?? '未记录' }
export function date(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
export function isActive(status: string) { return ['queued', 'pending', 'running', 'cancelling'].includes(status) }
