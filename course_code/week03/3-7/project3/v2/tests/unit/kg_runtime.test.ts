import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import type { ExecutionContext, ManagedTool } from "../../src/domain.js";
import { ToolRuntimeError } from "../../src/domain.js";
import { PolicyEngine } from "../../src/policy.js";
import { ToolRegistry } from "../../src/registry.js";
import { ToolRuntime } from "../../src/runtime.js";
import { PlatformStore } from "../../src/store.js";

function context(roles: string[] = ["support"]): ExecutionContext {
  return {
    traceId: `trace-${roles.join("-")}`,
    requestId: "request-runtime",
    userId: "user-1",
    tenantId: "tenant_a",
    roles,
    agentName: "support-agent",
    mode: "execute",
  };
}

function createHarness(tools: ManagedTool[]) {
  const registry = new ToolRegistry();
  tools.forEach((tool) => registry.register(tool));
  const policy = new PolicyEngine({
    rolePermissions: {
      support: ["order:read"],
      supervisor: ["order:read", "ticket:create"],
    },
    agentToolAllowlist: {
      "support-agent": tools.map((tool) => tool.metadata.internalName),
    },
  });
  const directory = mkdtempSync(join(tmpdir(), "pi-runtime-test-"));
  const store = new PlatformStore(join(directory, "platform.db"));
  const runtime = new ToolRuntime(registry, policy, store);
  return { registry, store, runtime };
}

describe("ToolRuntime public invocation seam", () => {
  it("denies RBAC before a write side effect", async () => {
    let writes = 0;
    const ticket = ticketTool(async () => {
      writes += 1;
      return { ticket_id: "T-1" };
    });
    const { runtime } = createHarness([ticket]);

    const result = await runtime.invoke({
      context: context(["support"]),
      toolCallId: "call-rbac",
      modelName: "ticket__create",
      args: { order_id: "ORD-A-1001", title: "Need help" },
    });

    expect(result).toMatchObject({ ok: false, action: "deny", code: "RBAC_DENIED" });
    expect(writes).toBe(0);
  });

  it("binds approval to exact arguments and consumes it once", async () => {
    let writes = 0;
    const ticket = ticketTool(async () => {
      writes += 1;
      return { ticket_id: "T-1" };
    });
    const { runtime, store } = createHarness([ticket]);
    const args = { order_id: "ORD-A-1001", title: "Need help" };
    const pending = await runtime.invoke({
      context: context(["supervisor"]),
      toolCallId: "call-approval",
      modelName: "ticket__create",
      args,
    });
    expect(pending).toMatchObject({ ok: false, action: "confirm", code: "APPROVAL_REQUIRED" });
    expect(pending.approvalId).toBeTruthy();
    store.decideApproval(pending.approvalId!, "approve", "manager-1");

    const changed = await runtime.executeApproval(pending.approvalId!, {
      order_id: "ORD-A-1001",
      title: "Changed after approval",
    });
    expect(changed.code).toBe("APPROVAL_BINDING_MISMATCH");
    expect(writes).toBe(0);

    const executed = await runtime.executeApproval(pending.approvalId!, args);
    expect(executed).toMatchObject({ ok: true, action: "allow", code: "OK" });
    expect(writes).toBe(1);

    const repeated = await runtime.executeApproval(pending.approvalId!, args);
    expect(repeated.code).toBe("APPROVAL_NOT_EXECUTABLE");
    expect(writes).toBe(1);
  });

  it("retries a transient read but never retries a non-idempotent write", async () => {
    let reads = 0;
    const readTool: ManagedTool = {
      metadata: {
        internalName: "order.get_status",
        description: "Read an order",
        version: "1.0.0",
        parameters: Type.Object({ order_id: Type.String() }, { additionalProperties: false }),
        risk: "read",
        permissions: ["order:read"],
        requiresConfirmation: false,
        timeoutMs: 1_000,
        maxRetries: 2,
        idempotent: true,
        source: "local",
      },
      async handler() {
        reads += 1;
        if (reads === 1) throw new ToolRuntimeError("UPSTREAM_UNAVAILABLE", "temporary", true);
        return { status: "paid" };
      },
    };
    let writes = 0;
    const unsafeWrite = ticketTool(async () => {
      writes += 1;
      throw new ToolRuntimeError("UPSTREAM_UNAVAILABLE", "temporary", true);
    });
    unsafeWrite.metadata.requiresConfirmation = false;
    const { runtime } = createHarness([readTool, unsafeWrite]);

    const read = await runtime.invoke({
      context: context(["support"]),
      toolCallId: "call-read-retry",
      modelName: "order__get_status",
      args: { order_id: "ORD-A-1001" },
    });
    const write = await runtime.invoke({
      context: context(["supervisor"]),
      toolCallId: "call-write-no-retry",
      modelName: "ticket__create",
      args: { order_id: "ORD-A-1001", title: "Need help" },
    });

    expect(read).toMatchObject({ ok: true, attempts: 2 });
    expect(reads).toBe(2);
    expect(write).toMatchObject({ ok: false, code: "UPSTREAM_UNAVAILABLE", attempts: 1 });
    expect(writes).toBe(1);
  });

  it("redacts model output and keeps trace/audit correlation", async () => {
    const readTool: ManagedTool = {
      metadata: {
        internalName: "order.get_status",
        description: "Read an order",
        version: "1.0.0",
        parameters: Type.Object({ order_id: Type.String() }, { additionalProperties: false }),
        risk: "read",
        permissions: ["order:read"],
        requiresConfirmation: false,
        timeoutMs: 1_000,
        maxRetries: 0,
        idempotent: true,
        source: "local",
        sensitiveFields: ["customer_email", "access_token"],
      },
      async handler() {
        return { status: "paid", customer_email: "alice@example.com", access_token: "secret-token" };
      },
    };
    const { runtime, store } = createHarness([readTool]);
    const result = await runtime.invoke({
      context: context(),
      toolCallId: "call-redact",
      modelName: "order__get_status",
      args: { order_id: "ORD-A-1001" },
    });

    expect(result.content).toEqual({ status: "paid", customer_email: "***", access_token: "***" });
    const audit = store.listAudit(context().traceId);
    expect(JSON.stringify(audit)).not.toContain("alice@example.com");
    expect(JSON.stringify(audit)).not.toContain("secret-token");
    expect(store.getTrace(context().traceId).every((event) => event.trace_id === context().traceId)).toBe(true);
  });

  it("enforces the deadline even when a handler ignores AbortSignal", async () => {
    const slowTool: ManagedTool = {
      metadata: {
        internalName: "order.slow_status",
        description: "Never completes in time",
        version: "1.0.0",
        parameters: Type.Object({ order_id: Type.String() }, { additionalProperties: false }),
        risk: "read",
        permissions: ["order:read"],
        requiresConfirmation: false,
        timeoutMs: 15,
        maxRetries: 0,
        idempotent: true,
        source: "local",
      },
      async handler() {
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { status: "too-late" };
      },
    };
    const { runtime } = createHarness([slowTool]);
    const started = Date.now();
    const result = await runtime.invoke({
      context: context(),
      toolCallId: "call-hard-timeout",
      modelName: "order__slow_status",
      args: { order_id: "ORD-A-1001" },
    });

    expect(result).toMatchObject({ ok: false, code: "TOOL_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(150);
  });

  it("never retries a non-idempotent tool on timeout (defends against misconfiguration)", async () => {
    let calls = 0;
    const flakyWrite: ManagedTool = {
      metadata: {
        internalName: "ticket.create_slow",
        description: "Simulates a write that times out",
        version: "1.0.0",
        parameters: Type.Object({ order_id: Type.String() }, { additionalProperties: false }),
        risk: "write",         // write risk
        permissions: ["ticket:create"],
        requiresConfirmation: false,
        timeoutMs: 15,
        maxRetries: 3,
        // 故意误配：把本应非幂等的写入标为 idempotent，用来验证 executePrepared
        // 的最终兑底逻辑不会因超时去重试写入（那会造成重复副作用）。
        idempotent: true,
        source: "local",
      },
      async handler() {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { created: true };
      },
    };
    const { runtime } = createHarness([flakyWrite]);
    const result = await runtime.invoke({
      context: context(["supervisor"]),
      toolCallId: "call-write-timeout-no-retry",
      modelName: "ticket__create_slow",
      args: { order_id: "ORD-A-1001" },
    });

    // 尽管 idempotent=true 且 maxRetries=3，但 risk=write，超时后也只执行一次，绝不重试。
    expect(calls).toBe(1);
    expect(result).toMatchObject({ ok: false, code: "TOOL_TIMEOUT", attempts: 1 });
  });
});

function ticketTool(handler: ManagedTool["handler"]): ManagedTool {
  return {
    metadata: {
      internalName: "ticket.create",
      description: "Create a support ticket",
      version: "1.0.0",
      parameters: Type.Object(
        { order_id: Type.String(), title: Type.String({ minLength: 3 }) },
        { additionalProperties: false },
      ),
      risk: "write",
      permissions: ["ticket:create"],
      requiresConfirmation: true,
      timeoutMs: 1_000,
      maxRetries: 2,
      idempotent: false,
      source: "local",
      executionMode: "sequential",
    },
    handler,
  };
}
