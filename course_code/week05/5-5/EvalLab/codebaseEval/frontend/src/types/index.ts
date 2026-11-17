export type Outcome = 'pass' | 'fail' | 'unknown'
export type Mode = 'live' | 'offline'
export interface Check {
  id: string
  type: 'contains' | 'regex' | 'tool_called' | 'no_tool_errors'
  value: string
}
export interface Task {
  id?: string
  name: string
  prompt: string
  tags: string[]
  required: boolean
  checks: Check[]
  rubric: string
  version?: number
}
export interface Strategy {
  id?: string
  name: string
  system_prompt: string
  model: string
  base_url: string
  api_key_env: string
  rag_mode: 'off' | 'keyword' | 'bm25'
  top_k: number
  input_price: number | null
  output_price: number | null
  cache_price: number | null
}
export interface ExperimentInput {
  name: string
  mode: Mode
  task_ids: string[]
  strategy_ids: string[]
  trials: number
  timeout: number
  max_tokens: number
}
export interface Experiment extends ExperimentInput {
  id: string
  status: string
  created_at: string
  total: number
  completed: number
}
export interface Review {
  id?: string
  reviewer: string
  status: Outcome
  reason: string
  created_at?: string
}
export interface Metrics {
  total_tokens?: number | null
  cost_usd?: number | null
  seconds?: number | null
  tool_calls?: number
  tool_errors?: number
  [key: string]: unknown
}
export interface Run {
  id: string
  experiment_id: string
  task_id: string
  strategy_id: string
  task?: Task
  strategy?: Strategy
  task_name?: string
  strategy_name?: string
  trial: number
  mode?: Mode
  source_hash?: string
  execution_status: string
  outcome: Outcome
  error?: string | null
  metrics: Metrics
  answer?: string
  trace?: Record<string, unknown>[]
  audit?: Record<string, unknown>[]
  retrieval?: Record<string, unknown>[]
  checks?: Record<string, unknown>[]
  judge?: Record<string, unknown> | null
  reviews?: Review[]
}
export interface StrategySummary {
  strategy_id: string
  name?: string
  runs: number
  passed: number
  failed?: number
  unknown?: number
  success_rate?: number | null
  [key: string]: unknown
}
export interface Summary {
  runs: number
  passed: number
  failed: number
  unknown: number
  success_rate: number | null
  known_cost_usd: number
  unknown_cost_runs: number
  total_tokens: number
  unknown_token_runs: number
  mean_seconds: number | null
  tool_calls: number
  tool_errors: number
  by_strategy: StrategySummary[]
}
export interface Cluster {
  category: string
  count: number
  run_ids: string[]
}
export interface PlatformState {
  tasks: Task[]
  strategies: Strategy[]
  experiments: Experiment[]
  runs: Run[]
  summary: Summary
  clusters: Cluster[]
  health: {
    node_ready: boolean
    credentials: { env: string; configured: boolean }[]
    codebase_path: string
  }
}
export interface Comparison {
  baseline: string | Record<string, unknown>
  candidate: string | Record<string, unknown>
  rows: {
    task_id: string
    task_name: string
    trial: number
    before: unknown
    after: unknown
    change: string
  }[]
  summary: Record<string, unknown>
  gate: string | Record<string, unknown>
  note: string
}
export interface CompareQuery {
  baseline: string
  candidate: string
  experiment: string
}
export type Page = 'overview' | 'benchmark' | 'strategies' | 'experiments'
  | 'trace' | 'reviews' | 'clusters' | 'compare'
