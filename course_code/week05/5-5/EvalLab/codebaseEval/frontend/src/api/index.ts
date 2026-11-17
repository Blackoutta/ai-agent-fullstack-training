import type { CompareQuery, Comparison, Experiment, ExperimentInput, PlatformState, Review, Run, Strategy, Task } from '../types'

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message)
    this.name = 'ApiError'
  }
}
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  })
  if (!response.ok) {
    const text = await response.text()
    let message = text || `请求失败 (${response.status})`
    try {
      const body: unknown = JSON.parse(text)
      if (body && typeof body === 'object' && 'error' in body) {
        message = typeof body.error === 'string' ? body.error : JSON.stringify(body.error)
      }
    } catch { /* Non-JSON failures still surface the server response. */ }
    throw new ApiError(message, response.status)
  }
  if (response.status === 204) return undefined as T
  return await response.json() as T
}
const post = <T>(path: string, data?: unknown) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) })
const idPath = (id: string) => encodeURIComponent(id)
const query = (value: CompareQuery) => new URLSearchParams({ ...value }).toString()

export const api = {
  state: () => request<PlatformState>('/state'),
  saveTask: (task: Task) => post<Task>('/tasks', task),
  deleteTask: (id: string) => request<void>(`/tasks/${idPath(id)}`, { method: 'DELETE' }),
  importTasks: (tasks: Task[]) => post<unknown>('/tasks/import', { tasks }),
  exportTasks: () => request<{ tasks: Task[] }>('/tasks/export'),
  saveStrategy: (strategy: Strategy) => post<Strategy>('/strategies', strategy),
  deleteStrategy: (id: string) => request<void>(`/strategies/${idPath(id)}`, { method: 'DELETE' }),
  experiment: (input: ExperimentInput) => post<Experiment>('/experiments', input),
  cancel: (id: string) => post<Experiment>(`/experiments/${idPath(id)}/cancel`),
  run: (id: string) => request<Run>(`/runs/${idPath(id)}`),
  judge: (id: string) => post<Run>(`/runs/${idPath(id)}/judge`),
  review: (id: string, value: Review) => post<Run>(`/runs/${idPath(id)}/reviews`, value),
  compare: (value: CompareQuery) => request<Comparison>(`/compare?${query(value)}`),
  reportUrl: (value: CompareQuery, format: 'md' | 'json') => `/api/reports?${query(value)}&format=${format}`,
}

export async function downloadReport(value: CompareQuery, format: 'md' | 'json') {
  const response = await fetch(api.reportUrl(value, format))
  if (!response.ok) throw new ApiError(await response.text() || '报告导出失败', response.status)
  downloadBlob(await response.blob(), `regression.${format}`)
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
export function downloadJson(data: unknown, filename: string) {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), filename)
}
