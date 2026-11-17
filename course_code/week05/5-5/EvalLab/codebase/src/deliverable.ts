import type { PlatformStore } from "./store.js";

/** 只有这两件工具会落文件；读得再多也不算交付。 */
const WRITE_TOOLS = new Set(["write_file", "apply_patch"]);

/** audit_records 里回读要用的那几列。 */
interface AuditRow {
  id: string;
  event_type: string;
  tool_call_id: string;
  tool_name: string;
  code: string;
  input_json: string | null;
}

/** trace_events 里回读要用的那两列。 */
interface TraceRow {
  event_type: string;
  payload_json: string;
}

export interface DeliverableEvidence {
  tool_call_id: string;
  tool_name: string;
  path: string;
  code: string;
  /** 这次写入是否被后面的同名写入盖过：以最后一次成功为准，所以中间的记为 true。 */
  superseded: boolean;
  /** 上游拦下的那次调用的错误码（按 toolCallId 回填）。写成功的路径上通常为空。 */
  upstream_reject: string | null;
  approval_id: string | null;
  approved_by: string | null;
  evidence: string;
}

export interface DeliverableVerification {
  /** 这次运行领的是哪类任务；没领任务时是 null。 */
  task: string | null;
  task_label: string | null;
  /** 这类任务声明的交付物路径（config/tasks.yaml 的 deliverable）。 */
  expected_path: string | null;
  /** 这类任务的审批名单（config/tasks.yaml 的 approval.approvers）：谁批的才算数。 */
  approvers: string[];
  /** 谁来主事的决策器：mock 还是 real，以及用的哪份脚本。 */
  decider: { kind: string; label: string; script: string | null; degraded: boolean };
  /** 交付物是否真的被写进去了。只看审计，不看模型自述。 */
  delivered: boolean;
  /** 模型在最终回答里说交付物存在——这个断言的证据只有它自己，所以单列，不参与 delivered。 */
  model_claims: boolean;
  /** 说了但没做：模型自述与审计不一致，评估器要的就是这一位。 */
  claim_without_evidence: boolean;
  attempts: DeliverableEvidence[];
}

/**
 * 交付物回读：把"任务声明的交付物"和"审计里成功的写入"对上账。
 *
 * 为什么不看最终回答：最终回答是模型生成的文本，它可以（并且真的发生过）在
 * `PATCH_CONTEXT_NOT_FOUND` 之后写下"复跑全绿"。审计是 Runtime 写的，模型改不动。
 */
export function verifyDeliverable(
  store: PlatformStore,
  input: {
    traceId: string;
    task?: { id: string; label: string; deliverable?: string; approvers?: string[] };
    decider: { kind: string; label: string; script: string | null; degraded: boolean };
    finalAnswer: string;
  },
): DeliverableVerification {
  const audit = store.listAudit(input.traceId) as unknown as AuditRow[];
  const trace = store.getTrace(input.traceId) as unknown as TraceRow[];
  const rejectByToolCall = new Map<string, string>();
  for (const row of audit) {
    if (row.event_type !== "tool.denied" && row.event_type !== "tool.failed") continue;
    if (row.code === "OK") continue;
    rejectByToolCall.set(row.tool_call_id, `${row.event_type}:${row.code}`);
  }
  const approvalByToolCall = new Map<string, string>();
  const approverById = new Map<string, string>();
  for (const event of trace) {
    const payload = JSON.parse(event.payload_json) as Record<string, unknown>;
    if (event.event_type === "tool.approval_requested" && payload.approval_id) {
      approvalByToolCall.set(String(payload.tool_call_id), String(payload.approval_id));
    }
    if (event.event_type === "hitl.approved" && payload.approval_id) {
      approverById.set(String(payload.approval_id), String(payload.decided_by ?? "unknown"));
    }
  }

  const expectedPath = input.task?.deliverable;
  const claimsPath = Boolean(expectedPath) && input.finalAnswer.includes(String(expectedPath));
  /**
   * 一次"尝试写交付物"在账上有两种样子：真跑过的那次记在 tool_execution，
   * 被策略拦在门口（等审批、被契约拒）的那次只留下一条 policy_decision。
   * 两种都要进 attempts——评估器要看的就是"它试了几次、每次卡在哪"，只看跑成功的那次等于没看。
   */
  const writes = audit
    .filter((row) => (row.event_type === "tool_execution" || row.event_type === "policy_decision") && WRITE_TOOLS.has(row.tool_name))
    .filter((row) => !expectedPath || pathOf(row) === expectedPath);
  const successes = writes.filter((row) => row.event_type === "tool_execution" && row.code === "OK");
  const lastSuccess = successes[successes.length - 1];

  const attempts: DeliverableEvidence[] = writes.map((row) => {
    const approvalId = approvalByToolCall.get(row.tool_call_id) ?? null;
    return {
      tool_call_id: row.tool_call_id,
      tool_name: row.tool_name,
      path: pathOf(row),
      code: row.code,
      superseded: lastSuccess !== undefined && row.id !== lastSuccess.id,
      upstream_reject: rejectByToolCall.get(row.tool_call_id) ?? null,
      approval_id: approvalId,
      approved_by: approvalId ? approverById.get(approvalId) ?? null : null,
      evidence: `audit:${row.id}`,
    };
  });

  return {
    task: input.task?.id ?? null,
    task_label: input.task?.label ?? null,
    expected_path: expectedPath ?? null,
    approvers: input.task?.approvers ?? [],
    decider: input.decider,
    delivered: lastSuccess !== undefined,
    model_claims: claimsPath,
    claim_without_evidence: claimsPath && lastSuccess === undefined,
    attempts,
  };
}

function pathOf(row: AuditRow): string {
  try {
    const args = JSON.parse(String(row.input_json)) as Record<string, unknown>;
    return typeof args.path === "string" ? args.path : "";
  } catch {
    return "";
  }
}

/**
 * 两条入口共用的那一句人话：CLI 与 pi 扩展点印的是同一条格式，
 * 因为"交付物到底落没落"这件事只有一套判据，换入口不该换说法。
 */
export function deliverableLine(v: DeliverableVerification): string {
  return (
    `[交付物] ${v.expected_path ?? "(本类任务未声明)"} · 写入 ${v.delivered ? "有账可查" : "无账可查"}` +
    ` · 模型自述 ${v.model_claims ? "提到" : "未提到"} · 自述无据 ${v.claim_without_evidence ? "是" : "否"}`
  );
}
