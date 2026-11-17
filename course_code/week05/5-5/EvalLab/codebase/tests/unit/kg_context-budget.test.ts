import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  clipForAudit,
  renderContext,
  summarizeStep,
  DEFAULT_CONTEXT_RULES,
  type RenderableMessage,
} from "../../src/context-budget.js";
import { runManagedAgent } from "../../src/pi/agent-runner.js";
import type { ScriptedStep } from "../../src/pi/decider.js";
import { createWorkspaceHarness, type WorkspaceHarness } from "./helpers/workspace.js";

const rules = { ...DEFAULT_CONTEXT_RULES, keepRecentTurns: 2 };

/** 一步 = 一条 assistant（带 toolCall）+ 紧跟其后的 toolResult。 */
function step(index: number, body: string): RenderableMessage[] {
  return [
    {
      role: "assistant",
      content: [
        { type: "text", text: `第${index}步要做的事` },
        { type: "toolCall", id: `call-${index}`, name: "read_file", arguments: { path: `src/f${index}.ts` } },
      ],
    },
    {
      role: "toolResult",
      toolCallId: `call-${index}`,
      toolName: "read_file",
      isError: false,
      content: [{ type: "text", text: body }],
    },
  ];
}

function conversation(steps: number, bodyLines: number): RenderableMessage[] {
  const body = Array.from({ length: bodyLines }, (_, index) => `  ${index + 1}| 这是一行代码`).join("\n");
  return [
    { role: "system", content: "你是 Codebase Agent，规则全文在此。" },
    { role: "user", content: "把登录逻辑整理清楚" },
    ...Array.from({ length: steps }, (_, index) => step(index + 1, body)).flat(),
  ];
}

function auditOutputs(harness: WorkspaceHarness, traceId: string): any[] {
  return harness.store
    .listAudit(traceId)
    .filter((row) => row.event_type === "tool_execution")
    .map((row) => JSON.parse(String(row.output_json)));
}

describe("渲染：旧步骤压成一行，最近几步逐字保留", () => {
  it("五步对话在窗口=2 时只留两步逐字，前三步各压成一行", () => {
    const rendered = renderContext(conversation(5, 40), rules);
    const roles = rendered.messages.map((message) => message.role);

    expect(rendered.stats.applied).toBe(true);
    expect(rendered.stats.steps_total).toBe(5);
    expect(rendered.stats.steps_summarized).toBe(3);
    // system + user + 一条摘要消息 + 最近两步（每步 assistant/toolResult 各一条）
    expect(roles).toEqual(["system", "user", "user", "assistant", "toolResult", "assistant", "toolResult"]);
    const summary = String(rendered.messages[2].content);
    expect(summary.split("\n").filter((line) => line.trim().startsWith("第"))).toHaveLength(3);
    expect(rendered.stats.chars_after).toBeLessThan(rendered.stats.chars_before);
  });

  it("摘要一行里带着重发需要的东西：工具名、参数、结果码、行数与字符数", () => {
    const line = summarizeStep(3, step(3, "1| a\n2| b\n3| c"));

    expect(line).toBe("第3步 read_file(path=src/f3.ts) → OK · 3 行 / 14 字符 · 该步共 4 行已从上下文移出");
    const summary = String(renderContext(conversation(5, 40), rules).messages[2].content);
    expect(summary).toContain("照抄摘要里的工具名与参数重新调用");
    expect(summary).toContain("不要凭摘要描述实现细节下结论");
  });

  it("系统提示词与用户目标永远逐字，不参与压缩", () => {
    const source = conversation(6, 40);
    const rendered = renderContext(source, rules);

    expect(rendered.messages[0].content).toBe(source[0].content);
    expect(rendered.messages[1].content).toBe(source[1].content);
    expect(String(rendered.messages[2].content)).not.toContain("规则全文在此");
  });

  it("步数没超窗口就一个字节都不动：返回的还是原来那份消息数组", () => {
    const source = conversation(2, 40);
    const rendered = renderContext(source, rules);

    expect(rendered.messages).toBe(source);
    expect(rendered.stats.applied).toBe(false);
    expect(rendered.stats.steps_summarized).toBe(0);
    expect(rendered.stats.chars_after).toBe(rendered.stats.chars_before);
  });

  it("摘要不比原文短就不压：逐字保留优先", () => {
    // 每一步只读三行，摘要行本身就有这么长，压了反而更长——这时保留原文。
    const source = conversation(5, 3);
    const rendered = renderContext(source, rules);

    expect(rendered.messages).toBe(source);
    expect(rendered.stats.applied).toBe(false);
    expect(rendered.stats.steps_summarized).toBe(0);
  });

  it("同一份输入两次渲染逐字相同：这是不用 pi compaction 的理由", () => {
    const first = renderContext(conversation(6, 40), rules);
    const second = renderContext(conversation(6, 40), rules);

    // compact() 要调一次模型生成摘要，文字每次都不同，离线跑根本没有可用的摘要模型；
    // 这里的哈希可以直接当断言用，课后复现对得上。
    expect(first.stats.rendered_hash).toBe(second.stats.rendered_hash);
    expect(first.messages).toEqual(second.messages);
  });

  it("压缩真的发生时，token 统计必须跟着降：不拿 provider 回报的 usage 当尺子", () => {
    // pi 的 estimateContextTokens 一旦发现 assistant 消息带着 usage，就直接把那个 usage 当上下文体量返回。
    // 真实 Loop 里每条 assistant 消息都有 usage（faux provider 也报 token 数），压缩前后取的是同一条，
    // 数字恒等——那次实跑就打印出 tokens_before 1957 / tokens_after 1957，而字符数明明少了 445。
    // 所以渲染统计改用 estimateTokens 逐条量字符。这条 AC 钉住这个选择。
    const messages = conversation(6, 40).map((message) =>
      message.role === "assistant"
        ? { ...message, usage: { input: 50_000, output: 50_000, cacheRead: 0, cacheWrite: 0, totalTokens: 100_000 } }
        : message,
    );
    const rendered = renderContext(messages, rules);

    expect(rendered.stats.applied).toBe(true);
    expect(rendered.stats.tokens_after).toBeLessThan(rendered.stats.tokens_before);
  });
});

describe("审计入库：按行截断，留全量行数与整份哈希", () => {
  it("截断只发生在行与行之间，并且留下能与全文对账的哈希", () => {
    const text = Array.from({ length: 60 }, (_, index) => `line-${index + 1}`).join("\n");
    const clip = clipForAudit(text, rules);

    expect(clip.truncated).toBe(true);
    expect(clip.total_lines).toBe(60);
    expect(clip.kept_lines).toBe(30);
    expect(clip.text).toContain("line-30");
    expect(clip.text).not.toContain("line-31");
    expect(clip.full_sha256).toBe(createHash("sha256").update(text).digest("hex"));
  });

  it("40 行上限之内原样入库，不做多余改写", () => {
    const text = Array.from({ length: 5 }, (_, index) => `line-${index + 1}`).join("\n");
    const clip = clipForAudit(text, rules);

    expect(clip).toMatchObject({ truncated: false, text, kept_lines: 5, total_lines: 5 });
  });

  it("工具给模型的是全文，进数据库的是截断后的那一份", async () => {
    const harness = createWorkspaceHarness();
    harness.write("src/big.ts", Array.from({ length: 60 }, (_, index) => `export const v${index} = ${index};`).join("\n"));
    const traceId = "trace-context-audit";

    const result = await harness.invoke("read_file", { path: "src/big.ts" }, { traceId });

    expect(String(result.content).split("\n")).toHaveLength(61);
    const [clip] = auditOutputs(harness, traceId);
    expect(clip.kept_lines).toBe(30);
    expect(clip.total_lines).toBe(61);
    expect(clip.text).toContain("[以下 31 行未入库，全文哈希见 full_sha256]");
    expect(clip.full_sha256).toBe(createHash("sha256").update(String(result.content)).digest("hex"));
  });
});

describe("Loop 入口：每次请求模型前渲染一次，统计写进 Trace", () => {
  it("四步脚本在窗口=1 时从第三步起就带着摘要走，trace 里数得出渲染次数", async () => {
    const harness = createWorkspaceHarness({ keepRecentTurns: 1 });
    for (const name of ["a", "b", "c"]) {
      harness.write(`src/${name}.ts`, Array.from({ length: 50 }, (_, index) => `export const x${index} = 1;`).join("\n"));
    }
    const script: ScriptedStep[] = [
      { tool_calls: [{ name: "read_file", args: { path: "src/a.ts" } }] },
      { tool_calls: [{ name: "read_file", args: { path: "src/b.ts" } }] },
      { tool_calls: [{ name: "read_file", args: { path: "src/c.ts" } }] },
      { text: "三个文件都读过了，内容一致。" },
    ];

    const result = await runManagedAgent(harness.platform, {
      prompt: "读三个文件",
      userId: "trainer-1",
      tenantId: "tenant_a",
      roles: ["maintainer"],
      script,
    });

    // 每一次请求模型前渲染一次：脚本共四步，前三步各自要到工具、第四步收尾。
    const view = result.context;
    expect(view.renders).toBe(4);
    expect(view.rules.keepRecentTurns).toBe(1);
    const last = view.last;
    expect(last?.applied).toBe(true);
    expect(last?.steps_summarized).toBe(2);
    expect(result.stop.code).toBe("COMPLETED");

    const rendered = harness.store
      .getTrace(result.trace_id)
      .filter((row) => row.event_type === "context.rendered");
    expect(rendered).toHaveLength(view.renders);
    expect(JSON.parse(String(rendered[rendered.length - 1].payload_json)).steps_total).toBe(3);
  });
});
