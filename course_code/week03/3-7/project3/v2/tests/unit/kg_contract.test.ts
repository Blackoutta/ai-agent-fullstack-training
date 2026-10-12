import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { renderContract, verifyContracts } from "../../src/contract.js";
import type { RegisteredTool, ToolMetadata } from "../../src/domain.js";
import { runManagedAgent } from "../../src/pi/agent-runner.js";
import type { ScriptedStep } from "../../src/pi/decider.js";
import { createWorkspaceHarness, type WorkspaceHarness } from "./helpers/workspace.js";

function repo(): WorkspaceHarness {
  const harness = createWorkspaceHarness();
  harness.write("README.md", "# demo\nline2\nline3\nline4\nline5\n");
  harness.write("src/routes/login.ts", "export function login(user: string) { return user; }\n");
  return harness;
}

function auditCodes(harness: WorkspaceHarness, traceId: string): string[] {
  return harness.store
    .listAudit(traceId)
    .map((row) => `${String(row.event_type)}:${String(row.tool_name)}:${String(row.code)}`);
}

describe("契约第一层：能写进 schema 的边界都写在 schema 里", () => {
  it("行号与条数边界由参数定义给出，文案点名到字段并说清合格长什么样", async () => {
    const harness = repo();
    const traceId = "trace-contract-bounds";
    const tooMany = await harness.invoke("read_file", { path: "README.md", limit: 99_999 }, { traceId });

    expect(tooMany).toMatchObject({ ok: false, code: "INVALID_ARGUMENT" });
    const help = String(tooMany.content);
    expect(help).toContain("limit");
    expect(help).toContain("≤ 2000");
    expect(help).toContain("只改上面点名的字段");
    // 越界的读取一次文件都没打开：账上只有 policy_decision。
    expect(auditCodes(harness, traceId)).toEqual(["policy_decision:read_file:INVALID_ARGUMENT"]);
  });

  it("类型写错由上游顺手纠正，我们不再造第二个校验器", async () => {
    const harness = repo();
    // 字符串 "2" 进不来整数栏位这件事，上游的 Convert 会先把它折成 2；
    // 契约层因此不必自己实现一遍类型强转，只需要盯住语义。
    const coerced = await harness.invoke("read_file", { path: "README.md", limit: "2" });

    expect(coerced.ok).toBe(true);
    expect(String(coerced.content)).toContain("显示 1-2");
    expect(String(coerced.content)).toContain("续读用 offset=3");
  });
});

describe("契约第二层：schema 表达不了的语义规则", () => {
  it("绝对路径即使真实存在，也照样被挡在门口", async () => {
    const harness = repo();
    const traceId = "trace-contract-absolute";
    const absolute = `${harness.workspace}/README.md`;
    expect(readFileSync(absolute, "utf8")).toContain("# demo");

    const denied = await harness.invoke("read_file", { path: absolute }, { traceId });

    expect(denied).toMatchObject({ ok: false, code: "CONTRACT_PATH_MUST_BE_RELATIVE" });
    expect(String(denied.content)).toContain("相对工作区根目录");
    expect(auditCodes(harness, traceId)).toEqual(["policy_decision:read_file:CONTRACT_PATH_MUST_BE_RELATIVE"]);
  });

  it("目录当文件读、glob 以 / 开头，都被点名指出改法", async () => {
    const harness = repo();
    const directory = await harness.invoke("read_file", { path: "src/routes/" });
    expect(directory).toMatchObject({ ok: false, code: "CONTRACT_PATH_IS_DIRECTORY" });
    expect(String(directory.content)).toContain("read_directory");

    // 契约层只做纯参数判断，不碰文件系统：路径没写错、但它其实是个目录时，事实由文件系统回答。
    const withoutSlash = await harness.invoke("read_file", { path: "src/routes" });
    expect(withoutSlash.code).toBe("TOOL_EXECUTION_FAILED");
    expect(String(withoutSlash.content)).toContain("EISDIR");

    const impossible = await harness.invoke("list_files", { pattern: "/**/*.ts" });
    expect(impossible).toMatchObject({ ok: false, code: "CONTRACT_GLOB_NEVER_MATCHES" });
    expect(String(impossible.content)).toContain("**/*.ts");

    // 去掉开头的 / 之后，同一个 pattern 立刻命中文件：契约给的改法是真能用的。
    const fixed = await harness.invoke("list_files", { pattern: "**/*.ts" });
    expect(String(fixed.content)).toContain("src/routes/login.ts");
  });

  it("整批空操作的补丁不配占用一次审批", async () => {
    const harness = repo();
    const noop = await harness.invoke("apply_patch", {
      path: "README.md",
      edits: [{ oldText: "# demo", newText: "# demo" }],
    });

    expect(noop).toMatchObject({ ok: false, code: "CONTRACT_PATCH_NO_CHANGES" });
    expect(noop.approvalId).toBeUndefined();
  });

  it("literal: true 时同一串字符就按字面量搜，语义规则不多管闲事", async () => {
    const harness = repo();
    harness.write("src/odd.ts", "const broken = \"([unclosed\";\n");

    const asRegexp = await harness.invoke("search_code", { pattern: "([unclosed" });
    expect(asRegexp).toMatchObject({ ok: false, code: "CONTRACT_PATTERN_NOT_REGEX" });

    const asLiteral = await harness.invoke("search_code", { pattern: "([unclosed", literal: true });
    expect(asLiteral.ok).toBe(true);
    expect(String(asLiteral.content)).toContain("src/odd.ts:1:");
  });
});

describe("契约自检：契约自己有毛病就在装配时炸", () => {
  function productionTools(): RegisteredTool[] {
    return repo().registry.list();
  }

  function breakTool(tool: RegisteredTool, patch: (metadata: ToolMetadata) => void): RegisteredTool[] {
    const metadata = { ...tool.metadata };
    patch(metadata);
    return [{ ...tool, metadata }];
  }

  it("十件工具的契约全部合格", () => {
    expect(verifyContracts(productionTools())).toEqual([]);
  });

  it("缺说明书、开了额外字段、limit 没有上界，都被逐条念出来", () => {
    const [first] = productionTools();
    const problems = verifyContracts(
      breakTool(first, (metadata) => {
        metadata.parameters = Type.Object(
          { path: Type.String(), limit: Type.Number() },
          { additionalProperties: true },
        ) as typeof metadata.parameters;
      }),
    );

    expect(problems.join("\n")).toContain("允许多余字段");
    expect(problems.join("\n")).toContain("path: 没有 description");
    expect(problems.join("\n")).toContain("limit: 没写下界");
    expect(problems.join("\n")).toContain("limit: 没写上界");
  });

  it("cli contract 打印的就是模型收到的那份说明书", () => {
    const read = renderContract(productionTools()).find((entry) => entry.internal_name === "read_file");
    const patch = renderContract(productionTools()).find((entry) => entry.internal_name === "apply_patch");

    expect(read?.fields.map((field) => `${field.name}:${field.bounds}`)).toEqual([
      "path:长度 ≥ 1",
      "offset:≥ 1",
      "limit:≥ 1 且 ≤ 2000",
    ]);
    expect(read?.semantic_rules.map((rule) => rule.code)).toEqual([
      "CONTRACT_PATH_MUST_BE_RELATIVE",
      "CONTRACT_PATH_IS_DIRECTORY",
    ]);
    expect(patch?.requires_confirmation).toBe(true);
  });
});

describe("回喂：被拒之后模型拿到的是下一步，不是一句不行", () => {
  it("Loop 入口与直调入口共用同一套契约，坏参数改对之后 Loop 继续推进", async () => {
    const harness = repo();
    const script: ScriptedStep[] = [
      { text: "先按绝对路径列一遍文件。", tool_calls: [{ name: "list_files", args: { pattern: "/**/*.ts" } }] },
      { text: "这个 pattern 永远命中不了，改成相对形式重发。", tool_calls: [{ name: "list_files", args: { pattern: "**/*.ts" } }] },
      { text: "文件清单拿到了，可以开始读。" },
    ];
    const result = await runManagedAgent(harness.platform, {
      prompt: "看看仓库里有哪些 TypeScript 文件",
      userId: "trainer-1",
      tenantId: "tenant_a",
      roles: ["maintainer"],
      script,
    });

    expect(auditCodes(harness, result.trace_id)).toEqual(
      expect.arrayContaining([
        "policy_decision:list_files:CONTRACT_GLOB_NEVER_MATCHES",
        "tool_execution:list_files:OK",
      ]),
    );
    expect(result.stop.code).toBe("COMPLETED");
    expect(result.budget.tool_calls).toBe(2);
    expect(result.final_answer).toContain("文件清单拿到了");
  });

  it("契约拒绝只挡住这一次调用：不带 terminate，pi 的 Loop 还能往前走", async () => {
    const harness = repo();
    const gate = await harness.runtime.gateForPi({
      context: harness.context(),
      toolCallId: "call-contract-glob",
      modelName: "list_files",
      args: { pattern: "/**/*.ts" },
    });

    // pi 的 tool_call 钩子按这个字段决定要不要停整个 Run。带 terminate 的只有审批终局那三条路，
    // 契约拒绝如果也停，模型就失去了"改对参数再发一次"的机会——回喂白做了。
    expect(gate).toMatchObject({ block: true, code: "CONTRACT_GLOB_NEVER_MATCHES" });
    expect(gate.terminate).toBeUndefined();
    expect(String(gate.reason)).toContain("**/*.ts");
  });
});
