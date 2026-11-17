import { canonicalJson } from "./store.js";

export interface LoopBudgetConfig {
  maxTurns: number;
  maxToolCalls: number;
  maxRepeatedCall: number;
  maxTotalTokens: number;
  maxCostUsd: number;
  maxDurationMs: number;
}

export interface GuardDecision {
  allow: boolean;
  code: string;
  reason: string;
}

export interface StopDecision {
  stop: boolean;
  code: string;  reason: string;
}

export class LoopGuard {
  private turns = 0;
  private toolCalls = 0;
  private totalTokens = 0;
  private costUsd = 0;
  private readonly startedAt = Date.now();
  private readonly repeatedCalls = new Map<string, number>();

  constructor(private readonly budget: LoopBudgetConfig) {}

  beforeToolCall(toolName: string, args: Record<string, unknown>): GuardDecision {
    if (Date.now() - this.startedAt >= this.budget.maxDurationMs) {
      return deny("MAX_DURATION", "Agent Run 已超过总时限");
    }
    if (this.toolCalls >= this.budget.maxToolCalls) {
      return deny("MAX_TOOL_CALLS", "工具调用预算已耗尽");
    }
    const signature = `${toolName}:${canonicalJson(args)}`;
    const count = (this.repeatedCalls.get(signature) ?? 0) + 1;
    if (count > this.budget.maxRepeatedCall) {
      return deny("REPEATED_TOOL_CALL", "检测到相同工具与参数的重复调用");
    }
    this.repeatedCalls.set(signature, count);
    this.toolCalls += 1;
    return { allow: true, code: "OK", reason: "Loop 工具预算通过" };
  }

  observeAssistantUsage(input: { totalTokens: number; costUsd: number }): void {
    this.totalTokens += input.totalTokens;
    this.costUsd += input.costUsd;
  }

  observeTurn(): void {
    this.turns += 1;
  }

  shouldStop(pendingApprovalId?: string): StopDecision {
    if (pendingApprovalId) return stop("AWAITING_APPROVAL", "工具调用正在等待人工审批");
    if (this.turns >= this.budget.maxTurns) return stop("MAX_TURNS", "Agent Loop 已达到最大轮数");
    if (this.toolCalls >= this.budget.maxToolCalls) return stop("MAX_TOOL_CALLS", "工具调用预算已耗尽");
    if (this.totalTokens >= this.budget.maxTotalTokens) return stop("MAX_TOKENS", "Token 预算已耗尽");
    if (this.costUsd >= this.budget.maxCostUsd) return stop("MAX_COST", "Cost 预算已耗尽");
    if (Date.now() - this.startedAt >= this.budget.maxDurationMs) return stop("MAX_DURATION", "Agent Run 已超过总时限");
    return { stop: false, code: "CONTINUE", reason: "预算允许继续" };
  }

  snapshot(): Record<string, number> {
    return {
      turns: this.turns,
      tool_calls: this.toolCalls,
      total_tokens: this.totalTokens,
      cost_usd: this.costUsd,
      elapsed_ms: Date.now() - this.startedAt,
    };
  }
}

/** 单价表：与 config.model 的 *_per_million 字段同名，直接传进来即可。 */
export interface TokenPrices {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
}

export interface UsageWithCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
}

/**
 * 累计进 Token 预算的只算"这一轮新算的那部分"：prompt + completion。
 *
 * 为什么不用 pi 报的 totalTokens：它等于 input + output + cacheRead + cacheWrite，
 * 而同一批 prompt 既进 input 又进 cacheWrite，等于一份上下文算了两遍；轮数一多，
 * 这个双份累加会先撞上 max_total_tokens，Agent 就被自己记的账拦在半路。
 */
export function freshTokensOf(usage: { input: number; output: number }): number {
  return usage.input + usage.output;
}

/**
 * 一次回复到底花了多少钱。模型侧报了就以它为准；
 * 离线脚本决策器（faux）算出的钱恒为 0，此时按单价自己折算，
 * 否则 MAX_COST 这条预算在课堂与 CI 里永远不会触发。
 */
export function costUsdOf(usage: UsageWithCost, prices: TokenPrices): number {
  if (usage.cost.total > 0) return usage.cost.total;
  return (
    (usage.input * prices.inputPerMillion +
      usage.output * prices.outputPerMillion +
      usage.cacheRead * prices.cacheReadPerMillion +
      usage.cacheWrite * prices.inputPerMillion) /
    1_000_000
  );
}

function deny(code: string, reason: string): GuardDecision {
  return { allow: false, code, reason };
}

function stop(code: string, reason: string): StopDecision {
  return { stop: true, code, reason };
}
