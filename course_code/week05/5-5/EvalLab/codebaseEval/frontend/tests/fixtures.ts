import { createWorkspace, workspaceKey } from '../src/workspace'
import type { PlatformState, Run, Strategy, Task } from '../src/types'

export const task: Task = { id: 't1', name: '解释工具审批', prompt: '定位审批链路', tags: ['安全'], required: true, checks: [{ id: 'c1', type: 'contains', value: 'approval' }], rubric: '必须引用文件', version: 1 }
export const strategy: Strategy = { id: 's1', name: '基线策略', system_prompt: '引用证据', model: 'test-model', base_url: 'https://example.test/v1', api_key_env: 'TEST_KEY', rag_mode: 'off', top_k: 5, input_price: null, output_price: null, cache_price: null }
export const run: Run = { id: 'r1', experiment_id: 'e1', task_id: 't1', strategy_id: 's1', task, strategy, trial: 1, mode: 'offline', outcome: 'unknown', execution_status: 'completed', answer: '<img src=x onerror=alert(1)>', metrics: { total_tokens: null, cost_usd: null }, checks: [], trace: [], audit: [], retrieval: [], reviews: [] }
export function fixture(): PlatformState {
  return {
    tasks: structuredClone([task]), strategies: structuredClone([strategy, { ...strategy, id: 's2', name: '候选策略' }]),
    experiments: [{ id: 'e1', name: '链路验证', mode: 'offline', task_ids: ['t1'], strategy_ids: ['s1', 's2'], trials: 1, timeout: 120, max_tokens: 4096, status: 'running', total: 2, completed: 1, created_at: '2026-10-30T10:00:00Z' }],
    runs: structuredClone([run]), clusters: [{ category: 'unknown', count: 1, run_ids: ['r1'] }],
    summary: { runs: 1, passed: 0, failed: 0, unknown: 1, success_rate: 0, known_cost_usd: 0, unknown_cost_runs: 1, total_tokens: 0, unknown_token_runs: 1, mean_seconds: null, tool_calls: 0, tool_errors: 0, by_strategy: [] },
    health: { node_ready: true, credentials: [{ env: 'TEST_KEY', configured: false }], codebase_path: '/trusted/codebase' },
  }
}
export function setup() {
  const workspace = createWorkspace()
  workspace.state.value = fixture()
  return { workspace, global: { provide: { [workspaceKey as symbol]: workspace }, stubs: { Teleport: true } } }
}
