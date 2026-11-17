import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterAll, describe, expect, it } from "vitest";
import type { HitlConfig } from "../../src/config.js";
import { disabledHitlGateway, createHitlGateway, HitlGatewayError } from "../../src/hitl/client.js";
import { ToolRuntime } from "../../src/runtime.js";
import { createWorkspaceHarness } from "./helpers/workspace.js";

/**
 * 这里打的桩说的是 hitl/service.py 的接口形状：字段用 snake_case、状态只有
 * awaiting_human / approved / rejected 三种、错误靠 code 字段传。
 * 真图的规则（谁能批、能不能自批）由 hitl 那侧的 pytest 与课堂转录负责，
 * 这一层只验"运行时有话能问到图、图的回答能原样收回来"。
 */
interface StubCall {
  method: string;
  path: string;
  body: Record<string, unknown>;
}

const calls: StubCall[] = [];
let nextStatus = "awaiting_human";
let nextCode = "AWAITING_HUMAN";
let failWith: { status: number; code: string } | undefined;

const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {};
  calls.push({ method: request.method ?? "", path: request.url ?? "", body });
  if (failWith) {
    response.writeHead(failWith.status, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: failWith.code, message: "桩决定的失败" }));
    return;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      ticket_id: body.ticket_id ?? "ticket-1",
      status: nextStatus,
      code: nextCode,
      decided_by: body.actor ?? "",
      feedback: body.feedback ?? "",
    }),
  );
});

beforeAllServer();
function beforeAllServer() {
  // 顶层起服务：vitest 的 beforeAll 在并发文件里也保证先于用例，这里图省事直接同步 listen 端口 0。
}

async function startStub(): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

const baseUrl = await startStub();
process.env.UNIT_HITL_KEY = "unit-key";

function hitlConfig(overrides: Partial<HitlConfig> = {}): HitlConfig {
  return {
    mode: "http",
    baseUrl,
    apiKeyEnv: "UNIT_HITL_KEY",
    approvers: ["maintainer"],
    gate: { mode: "auto", tools: [] },
    timeoutMs: 2000,
    waitTimeoutMs: 2000,
    ...overrides,
  };
}

describe("HitlGateway 的 HTTP 契约", () => {
  it("disabled 模式的网关一次请求都不发", async () => {
    const gateway = disabledHitlGateway();
    expect(gateway.enabled).toBe(false);
    await expect(gateway.getTicket("x")).rejects.toThrowError(/HITL_DISABLED|没有挂审批工作流/);
  });

  it("提单时把审批名单与 snake_case 字段一起发给图", async () => {
    calls.length = 0;
    const gateway = createHitlGateway(hitlConfig());
    const verdict = await gateway.openTicket({
      ticketId: "approval-1",
      traceId: "trace-1",
      tenantId: "tenant_a",
      userId: "trainer-1",
      roles: ["maintainer"],
      toolName: "write_file",
      argsDigest: "digest-1",
      workspace: "/tmp/repo",
      risk: "write",
      reason: "该动作必须绑定参数后由人确认",
    });
    expect(verdict).toMatchObject({ ticketId: "approval-1", status: "awaiting_human" });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/tickets" });
    expect(calls[0]?.body).toMatchObject({
      ticket_id: "approval-1",
      args_digest: "digest-1",
      workspace: "/tmp/repo",
      approvers: ["maintainer"],
      roles: ["maintainer"],
    });
    expect(calls[0]?.body).not.toHaveProperty("camelCaseKeys");
  });

  it("名单是空的时候照样原样发空数组，运行时不替它补一个默认角色", async () => {
    calls.length = 0;
    await createHitlGateway(hitlConfig({ approvers: [] })).openTicket({
      ticketId: "approval-empty",
      traceId: "trace-empty",
      tenantId: "tenant_a",
      userId: "trainer-1",
      roles: ["maintainer"],
      toolName: "write_file",
      argsDigest: "digest-2",
      workspace: "/tmp/repo",
      risk: "write",
      reason: "该动作必须绑定参数后由人确认",
    });
    // 空名单是失败关闭的配置错误，必须由图说破；这边一旦"顺手补个 maintainer"，
    // 配置里那份漏写就被静默修好了，谁也发现不了。
    expect(calls[0]?.body).toMatchObject({ approvers: [] });
  });

  it("答复带上审批人角色，图才知道他有资格没有", async () => {
    calls.length = 0;
    nextStatus = "approved";
    nextCode = "APPROVED";
    const verdict = await createHitlGateway(hitlConfig()).decide("approval-1", {
      action: "approve",
      actor: "trainer-2",
      roles: ["maintainer"],
      feedback: "可以",
    });
    expect(calls[0]).toMatchObject({ method: "POST", path: "/tickets/approval-1/resume" });
    expect(calls[0]?.body).toMatchObject({ action: "approve", actor: "trainer-2", roles: ["maintainer"] });
    expect(verdict.status).toBe("approved");
  });

  it("图返回错误码时，原样抛成 HitlGatewayError", async () => {
    failWith = { status: 409, code: "TICKET_NOT_AWAITING_HUMAN" };
    await expect(createHitlGateway(hitlConfig()).getTicket("gone")).rejects.toBeInstanceOf(HitlGatewayError);
    await expect(createHitlGateway(hitlConfig()).getTicket("gone")).rejects.toMatchObject({ code: "TICKET_NOT_AWAITING_HUMAN" });
    failWith = undefined;
  });

  it("没配密钥就直接拒绝，不会裸奔去连图", async () => {
    const saved = process.env.UNIT_HITL_KEY;
    delete process.env.UNIT_HITL_KEY;
    await expect(createHitlGateway(hitlConfig()).getTicket("x")).rejects.toMatchObject({ code: "HITL_KEY_MISSING" });
    process.env.UNIT_HITL_KEY = saved;
  });

  it("图连不上时报 HITL_UNREACHABLE，调用方据此拒绝执行", async () => {
    const gateway = createHitlGateway(hitlConfig({ baseUrl: "http://127.0.0.1:1" }));
    await expect(gateway.getTicket("x")).rejects.toMatchObject({ code: "HITL_UNREACHABLE" });
  });

  it("列工单读的是 tickets 数组", async () => {
    const listServer = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ tickets: [{ ticket_id: "a", status: "awaiting_human", code: "AWAITING_HUMAN" }], total: 1 }));
    });
    listServer.listen(0, "127.0.0.1");
    await once(listServer, "listening");
    const address = listServer.address();
    const url = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const tickets = await createHitlGateway(hitlConfig({ baseUrl: url })).listTickets();
    expect(tickets).toEqual([{ ticketId: "a", status: "awaiting_human", code: "AWAITING_HUMAN", decidedBy: undefined, feedback: undefined }]);
    listServer.close();
  });
});

describe("审批挂在图上时的 Runtime", () => {
  it("图上批下来之后，工具在这一次运行里真的落了盘", async () => {
    const harness = createWorkspaceHarness();
    nextStatus = "awaiting_human";
    nextCode = "AWAITING_HUMAN";
    const runtime = new ToolRuntime(harness.registry, harness.policy, harness.store, createHitlGateway(hitlConfig()), 2000);
    const context = harness.context();
    calls.length = 0;

    // 桩默认回 awaiting_human，所以这里先派一个后台"审批人"：看到单子就批。
    const gate = runtime.gateForPi({
      context,
      toolCallId: "call-approve",
      modelName: "write_file",
      args: { path: "docs/login.md", content: "# 登录\n" },
    });
    await expect.poll(() => calls.length).toBeGreaterThan(1);
    const approvalId = harness.store.listApprovals("pending")[0]!.id;
    harness.store.decideApproval(approvalId, "approve", "trainer-2");
    nextStatus = "approved";
    nextCode = "APPROVED";
    expect(await gate).toEqual({ block: false });

    const executed = await runtime.invoke({
      context,
      toolCallId: "call-approve",
      modelName: "write_file",
      args: { path: "docs/login.md", content: "# 登录\n" },
    });
    expect(executed.ok).toBe(true);
    expect(harness.read("docs/login.md")).toContain("# 登录");
    expect(harness.store.getApproval(approvalId)?.status).toBe("consumed");
    // 图给了答复，这条 trace 上就不该再挂着"待审批"：Loop 每轮收尾都读这个标记，
    // 它还在的话，运行会以 AWAITING_APPROVAL 收口，后面那一轮"文档已交付"永远轮不到。
    expect(runtime.pendingApproval(context.traceId)).toBeUndefined();
    nextStatus = "awaiting_human";
    nextCode = "AWAITING_HUMAN";
  });

  it("人工拒绝：这次调用被拦死，本地单也留在拒绝态", async () => {
    const harness = createWorkspaceHarness();
    const runtime = new ToolRuntime(harness.registry, harness.policy, harness.store, createHitlGateway(hitlConfig()), 2000);
    nextStatus = "rejected";
    nextCode = "HUMAN_REJECTED";
    const context = harness.context();
    const gate = await runtime.gateForPi({
      context,
      toolCallId: "call-reject",
      modelName: "write_file",
      args: { path: "docs/nope.md", content: "x" },
    });
    expect(gate.block).toBe(true);
    expect(String(gate.reason)).toContain("HUMAN_REJECTED");
    // 人说了不，这次运行就到此为止：terminate 让 Loop 收口，模型没有机会再讲一个相反的收尾。
    expect(gate.terminate).toBe(true);
    expect(harness.store.listApprovals("approved")).toHaveLength(0);
    expect(runtime.pendingApproval(context.traceId)).toBeUndefined();
    nextStatus = "awaiting_human";
    nextCode = "AWAITING_HUMAN";
  });

  it("图不可达时不执行，也不留一张看起来还在等人的单", async () => {
    const harness = createWorkspaceHarness();
    const offline = createHitlGateway(hitlConfig({ baseUrl: "http://127.0.0.1:1" }));
    const runtime = new ToolRuntime(harness.registry, harness.policy, harness.store, offline, 1000);
    const context = harness.context();
    const gate = await runtime.gateForPi({
      context,
      toolCallId: "call-offline",
      modelName: "write_file",
      args: { path: "docs/offline.md", content: "x" },
    });
    expect(String(gate.reason)).toContain("HITL_UNREACHABLE");
    expect(harness.store.listApprovals("pending")).toHaveLength(0);
    expect(runtime.pendingApproval(context.traceId)).toBeUndefined();
    expect(harness.registry.getByModelName("write_file")).toBeTruthy();
  });

  it("审批图批的是哪个仓库，写在单子的 workspace 字段里", async () => {
    const harness = createWorkspaceHarness();
    const runtime = new ToolRuntime(harness.registry, harness.policy, harness.store, createHitlGateway(hitlConfig()), 2000);
    calls.length = 0;
    nextStatus = "rejected";
    nextCode = "HUMAN_REJECTED";
    await runtime.gateForPi({
      context: harness.context({ workspace: harness.workspace }),
      toolCallId: "call-workspace",
      modelName: "run_command",
      args: { command: "echo hi" },
    });
    const opened = calls.find((call) => call.path === "/tickets");
    expect(opened?.body).toMatchObject({ workspace: harness.workspace, tool_name: "run_command", risk: "high" });
    nextStatus = "awaiting_human";
    nextCode = "AWAITING_HUMAN";
  });

  it("阶段二那条路（审批没挂图）只拦这一次调用，不宣布整轮结束", async () => {
    const harness = createWorkspaceHarness();
    const context = harness.context();
    const gate = await harness.runtime.gateForPi({
      context,
      toolCallId: "call-local",
      modelName: "write_file",
      args: { path: "docs/late.md", content: "x" },
    });
    // 没有图可问，所以这张单是"留给下一次运行去批"的：block 有，terminate 没有。
    // Loop 靠 pendingApproval 这个标记停在原地，等的是 approvals 那条命令行。
    expect(gate.block).toBe(true);
    expect(gate.terminate).toBeUndefined();
    expect(gate.code).toBe("APPROVAL_REQUIRED");
    expect(harness.runtime.pendingApproval(context.traceId)).toBe(harness.store.listApprovals("pending")[0]!.id);
  });
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});
