import type { HitlConfig } from "../config.js";
/**
 * 运行时侧的审批工作流客户端。这里只定义"怎么问图"，不含任何审批规则：
 * 谁能批、能不能自己批、批完算不算数，全都写在 hitl/graph.py 那张图上。
 */

export interface HitlTicketRequest {
  /** 单号直接用运行时本地审批记录的 id：两边同一个号，不必再存一张映射表。 */
  ticketId: string;
  traceId: string;
  tenantId: string;
  userId: string;
  roles: string[];
  toolName: string;
  argsDigest: string;
  workspace: string;
  risk: string;
  reason: string;
}

export interface HitlVerdict {
  ticketId: string;
  status: string;
  code: string;
  decidedBy?: string;
  feedback?: string;
}

export interface HitlDecision {
  action: "approve" | "reject";
  actor: string;
  roles: string[];
  feedback?: string;
}

export class HitlGatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HitlGatewayError";
  }
}

export interface HitlGateway {
  /** false = 审批落在本地 SQLite（阶段二行为），一次 HTTP 都不发。 */
  readonly enabled: boolean;
  openTicket(request: HitlTicketRequest): Promise<HitlVerdict>;
  decide(ticketId: string, decision: HitlDecision): Promise<HitlVerdict>;
  getTicket(ticketId: string): Promise<HitlVerdict>;
  listTickets(): Promise<HitlVerdict[]>;
}

const LOCAL_ONLY: HitlGateway = {
  enabled: false,
  async openTicket() {
    throw new HitlGatewayError("HITL_DISABLED", "没有挂审批工作流，不会向图提单");
  },
  async decide() {
    throw new HitlGatewayError("HITL_DISABLED", "没有挂审批工作流，审批由本地 store 直接决定");
  },
  async getTicket() {
    throw new HitlGatewayError("HITL_DISABLED", "没有挂审批工作流，没有远端工单可查");
  },
  async listTickets() {
    throw new HitlGatewayError("HITL_DISABLED", "没有挂审批工作流，没有远端工单可查");
  },
};

/** 阶段二行为：审批只落在本地 approvals 表。单测与离线跑就用它。 */
export function disabledHitlGateway(): HitlGateway {
  return LOCAL_ONLY;
}

export function createHitlGateway(config: HitlConfig): HitlGateway {
  return config.mode === "http" ? new HttpHitlGateway(config) : disabledHitlGateway();
}

class HttpHitlGateway implements HitlGateway {
  readonly enabled = true;

  constructor(private readonly config: HitlConfig) {}

  openTicket(request: HitlTicketRequest): Promise<HitlVerdict> {
    return this.call("POST", "/tickets", {
      ticket_id: request.ticketId,
      trace_id: request.traceId,
      tenant_id: request.tenantId,
      user_id: request.userId,
      roles: request.roles,
      tool_name: request.toolName,
      args_digest: request.argsDigest,
      workspace: request.workspace,
      risk: request.risk,
      reason: request.reason,
      approvers: this.config.approvers,
    });
  }

  decide(ticketId: string, decision: HitlDecision): Promise<HitlVerdict> {
    return this.call("POST", `/tickets/${encodeURIComponent(ticketId)}/resume`, {
      action: decision.action,
      actor: decision.actor,
      roles: decision.roles,
      feedback: decision.feedback ?? "",
    });
  }

  getTicket(ticketId: string): Promise<HitlVerdict> {
    return this.call("GET", `/tickets/${encodeURIComponent(ticketId)}`);
  }

  async listTickets(): Promise<HitlVerdict[]> {
    const body = await this.raw("GET", "/tickets");
    const tickets = Array.isArray((body as { tickets?: unknown }).tickets)
      ? ((body as { tickets: Record<string, unknown>[] }).tickets ?? [])
      : [];
    return tickets.map(toVerdict);
  }

  private async call(method: string, path: string, body?: unknown): Promise<HitlVerdict> {
    return toVerdict(await this.raw(method, path, body));
  }

  private async raw(method: string, path: string, body?: unknown): Promise<unknown> {
    const apiKey = process.env[this.config.apiKeyEnv];
    if (!apiKey) {
      throw new HitlGatewayError("HITL_KEY_MISSING", `审批服务需要环境变量 ${this.config.apiKeyEnv}`);
    }
    let response: Response;
    try {
      response = await fetch(new URL(path, this.config.baseUrl), {
        method,
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      // 连不上必须说清楚：这张图是审批的唯一权威，它不在就等于没有批准，不能当成"批过了"。
      throw new HitlGatewayError(
        "HITL_UNREACHABLE",
        `审批服务 ${this.config.baseUrl} 不可达：先起 hitl/service.py（${error instanceof Error ? error.message : String(error)}）`,
      );
    }
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) {
      throw new HitlGatewayError(
        String(parsed.code ?? `HTTP_${response.status}`),
        String(parsed.message ?? `审批服务返回 ${response.status}`),
      );
    }
    return parsed;
  }
}

function toVerdict(body: unknown): HitlVerdict {
  const record = (body ?? {}) as Record<string, unknown>;
  return {
    ticketId: String(record.ticket_id ?? ""),
    status: String(record.status ?? "unknown"),
    code: String(record.code ?? ""),
    decidedBy: record.decided_by ? String(record.decided_by) : undefined,
    feedback: record.feedback ? String(record.feedback) : undefined,
  };
}
