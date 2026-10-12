import type { ApprovalGate } from "./config.js";
import type {
  ExecutionContext,
  PolicyConfig,
  PolicyDecision,
  RegisteredTool,
} from "./domain.js";
import type { Sandbox } from "./sandbox.js";

/** 十件仓库工具里承载路径的入参名。策略层只认这三个键，其余参数不含路径。 */
const PATH_ARGUMENTS = ["path", "file_path", "test_file"];

export class PolicyEngine {
  constructor(
    private readonly config: PolicyConfig,
    private readonly sandbox?: Sandbox,
    /** 门口开关（gate）：按任务类型分置，所以它是构造参数而不是工具元数据。 */
    private readonly gate: ApprovalGate = { mode: "auto", tools: [] },
  ) {}

  permissionsFor(context: ExecutionContext): Set<string> {
    return new Set(context.roles.flatMap((role) => this.config.rolePermissions[role] ?? []));
  }

  isVisible(context: ExecutionContext, internalName: string): boolean {
    return (this.config.agentToolAllowlist[context.agentName] ?? []).some((pattern) =>
      pattern.endsWith("*") ? internalName.startsWith(pattern.slice(0, -1)) : internalName === pattern,
    );
  }

  evaluate(
    context: ExecutionContext,
    tool: RegisteredTool,
    args: Record<string, unknown>,
    options: { approvalSatisfied?: boolean } = {},
  ): PolicyDecision {
    if (!this.isVisible(context, tool.metadata.internalName)) {
      return { action: "deny", code: "TOOL_NOT_VISIBLE", reason: "工具不在当前 Agent 白名单中" };
    }

    const permissions = this.permissionsFor(context);
    const missing = tool.metadata.permissions.filter((permission) => !permissions.has(permission));
    if (missing.length > 0) {
      return { action: "deny", code: "RBAC_DENIED", reason: `缺少权限: ${missing.join(", ")}` };
    }

    if (context.mode === "plan" && tool.metadata.risk !== "read") {
      return { action: "deny", code: "PLAN_MODE_DENIED", reason: "plan 模式禁止写操作" };
    }

    if (this.sandbox) {
      const write = tool.metadata.risk !== "read";
      for (const key of PATH_ARGUMENTS) {
        const value = args[key];
        if (typeof value !== "string") continue;
        const violation = this.sandbox.inspect(value, { write });
        if (violation) {
          return { action: "deny", code: violation.code, reason: violation.reason };
        }
      }
    }

    // 门口开关（gate）在这一层生效，而不是改工具元数据：同一件 write_file，
    // 在一类任务里要过人，在另一类任务里可以不过人——差别全在 tasks.yaml 的那一个条目里。
    if (this.gate.mode === "none" && tool.metadata.requiresConfirmation) {
      // 放行，但"这次没人看过"必须以一条独立的审计记录下来，不能混在 OK 里。
      return { action: "allow", code: "APPROVAL_GATE_OFF", reason: "本类任务的 approval.gate=none：这件工具的动作不经人工确认，直接执行" };
    }
    const listedByTask = this.gate.tools.includes(tool.modelName);
    if ((tool.metadata.requiresConfirmation || listedByTask) && !options.approvalSatisfied) {
      return {
        action: "confirm",
        code: "APPROVAL_REQUIRED",
        reason: listedByTask && !tool.metadata.requiresConfirmation ? "本类任务把这件工具点名进了审批门口" : "该动作必须绑定参数后由人确认",
      };
    }

    return { action: "allow", code: "OK", reason: "策略检查通过" };
  }
}
