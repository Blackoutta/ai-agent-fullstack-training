import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderMarkdown, runEval, type EvalReport } from "../../src/eval.js";

describe("评估执行器", () => {
  it("执行状态与验收结论分开记：停在审批的任务不计为完成", async () => {
    // 独立工作副本与独立账本都放在临时目录里，不往工程的 .eval-runs 里写。
    const root = mkdtempSync(join(tmpdir(), "pi-eval-"));
    const outFile = join(root, "eval_report.md");
    const report = await runEval({ cases: [{ task: "fix_tests" }], outFile, workRoot: root });

    expect(report.outcomes).toHaveLength(1);
    const outcome = report.outcomes[0];
    // 门口拦下第一次 run_test：执行状态是"待审批"，不是"完成"。
    expect(outcome.status).toBe("awaiting_approval");
    expect(outcome.stop_code).toBe("AWAITING_APPROVAL");
    // 验收结论取自审计：没有成功写入，就算模型自述完成也不能通过。
    expect(outcome.accepted).toBe(false);
    expect(outcome.delivered).toBe(false);
    expect(outcome.deliverable_path).toBe("src/auth/session-policy.ts");
    expect(outcome.approvals).toBeGreaterThan(0);
    expect(outcome.uncovered.join()).toContain("停在审批");

    // 工作副本里应当能找到被评估的样本，账本与工作区在两个不同位置。
    expect(existsSync(join(outcome.evidence.workspace, "src", "auth", "session-policy.ts"))).toBe(true);
    expect(outcome.evidence.database.startsWith(root)).toBe(true);

    // Markdown 与 JSON 两份报告都落盘，内容与内存里的对象一致。
    expect(existsSync(outFile)).toBe(true);
    const json = JSON.parse(readFileSync(outFile.replace(/\.md$/, ".json"), "utf8")) as EvalReport;
    expect(json.outcomes[0].run_id).toBe(outcome.run_id);
    expect(readFileSync(outFile, "utf8")).toContain("执行状态回答");
  }, 60_000);

  it("报告把状态翻成中文，并把单元格里的竖线转义", () => {
    const markdown = renderMarkdown({
      generated_at: "2026-01-01T00:00:00.000Z",
      decider: "mock",
      uncovered: ["整体未覆盖项"],
      outcomes: [
        {
          task: "demo",
          display_name: "演示 | 任务",
          run_id: "run-1",
          decider: "mock:demo.yaml",
          status: "awaiting_approval",
          stop_code: "AWAITING_APPROVAL",
          stop_reason: "工具调用正在等待人工审批",
          accepted: false,
          deliverable_path: null,
          delivered: false,
          claim_without_evidence: false,
          tool_calls: 1,
          approvals: 1,
          tokens: 10,
          cost_usd: 0.001,
          elapsed_ms: 5,
          evidence: { workspace: "/w", database: "/d", trace_id: "t" },
          uncovered: ["单任务未覆盖项"],
        },
      ],
    });
    expect(markdown).toContain("待审批");
    expect(markdown).toContain("演示 \\| 任务");
    expect(markdown).toContain("(未声明)");
    expect(markdown).toContain("整体未覆盖项");
    expect(markdown).toContain("单任务未覆盖项");
  });
});
