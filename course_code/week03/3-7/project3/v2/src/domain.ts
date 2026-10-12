import type { TSchema } from "typebox";

export type RiskLevel = "read" | "write" | "high";
export type ExecutionMode = "plan" | "execute";
export type ToolSource = "local";

export interface ExecutionContext {
  traceId: string;
  requestId: string;
  userId: string;
  tenantId: string;
  roles: string[];
  agentName: string;
  mode: ExecutionMode;
  /** 这次运行打开的是哪个仓库。审批指纹要盖住它：批"往这个仓库写"不等于批"往任何仓库写"。 */
  workspace?: string;
}

export interface ToolMetadata {
  internalName: string;
  description: string;
  version: string;
  parameters: TSchema;
  risk: RiskLevel;
  permissions: string[];
  requiresConfirmation: boolean;
  timeoutMs: number;
  maxRetries: number;
  idempotent: boolean;
  source: ToolSource;
  sensitiveFields?: string[];
  executionMode?: "parallel" | "sequential";
}

export interface ToolHandlerInput {
  toolCallId: string;
  args: Record<string, unknown>;
  context: ExecutionContext;
  signal: AbortSignal;
}

export type ToolHandler = (input: ToolHandlerInput) => Promise<unknown>;

export interface ManagedTool {
  metadata: ToolMetadata;
  handler: ToolHandler;
  fallbackHandler?: ToolHandler;
}

export interface RegisteredTool extends ManagedTool {
  modelName: string;
}

export interface PolicyConfig {
  rolePermissions: Record<string, string[]>;
  agentToolAllowlist: Record<string, string[]>;
}

export type DecisionAction = "allow" | "deny" | "confirm";

export interface PolicyDecision {
  action: DecisionAction;
  code: string;
  reason: string;
}

export class ToolRuntimeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ToolRuntimeError";
  }
}
