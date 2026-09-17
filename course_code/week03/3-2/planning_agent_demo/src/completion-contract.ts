// ============================================================================
// 完成契约：把「什么算完成」从 LoopGuard 的硬编码里提取出来。
//
// 3.1 的 LoopGuard 直接判断 artifacts/login-flow.md，只适用于代码理解任务。
// 3.2 同一套 Loop 要跑两类任务，因此把验收对象做成可注入的契约：
//   - 代码理解任务：读取足量源码 + 生成说明文档；
//   - 测试修复任务：当前代码版本上有改动、有通过的测试、有交付说明。
// ============================================================================
import type { Evidence, PlanSnapshot } from "./plan-store.js";

export interface CompletionInput {
  plan?: PlanSnapshot;
  evidence: Evidence[];
  /** 当前代码版本；测试与改动证据必须产自这个版本。 */
  revision: string;
}

export interface CompletionContract {
  id: string;
  verify(input: CompletionInput): string[];
}

function unfinishedSteps(plan?: PlanSnapshot): string[] {
  if (!plan) return ["尚未创建计划"];
  return plan.steps
    .filter((step) => step.status !== "completed" && step.status !== "skipped")
    .map((step) => `步骤未完成：${step.id}（${step.status}）`);
}

function hasArtifact(evidence: Evidence[], artifact: string): boolean {
  return evidence.some(
    (item) => item.kind === "tool" && item.payload.artifact === artifact,
  );
}

/** 3.1 已有的代码理解契约：读够源码，并交付说明文档。 */
export function createCodeUnderstandingContract(options: {
  targetArtifact: string;
  minReadFiles?: number;
}): CompletionContract {
  const minReadFiles = options.minReadFiles ?? 3;
  return {
    id: "code-understanding",
    verify({ plan, evidence }) {
      const missing = unfinishedSteps(plan);
      const readFiles = new Set(
        evidence
          .filter((item) => item.kind === "inspection")
          .map((item) => item.payload.path)
          .filter((value): value is string => typeof value === "string"),
      );
      if (readFiles.size < minReadFiles) {
        missing.push(`至少读取 ${minReadFiles} 个相关源码文件，当前 ${readFiles.size} 个`);
      }
      if (!hasArtifact(evidence, options.targetArtifact)) {
        missing.push(`生成 ${options.targetArtifact}`);
      }
      return missing;
    },
  };
}

/** 3.2 的修复契约：当前版本上有改动、约定范围的测试都通过、并有交付说明。 */
export function createLoginFixContract(options: {
  targetSource: string;
  targetArtifact: string;
  /** 必须全部通过的测试范围。 */
  requiredScopes?: string[];
}): CompletionContract {
  const requiredScopes = options.requiredScopes ?? ["target", "boundary", "regression"];
  return {
    id: "login-fix",
    verify({ plan, evidence, revision }) {
      const missing = unfinishedSteps(plan);
      const current = evidence.filter((item) => item.artifactVersion === revision);

      const patched = current.some(
        (item) => item.kind === "diff" && item.payload.path === options.targetSource,
      );
      if (!patched) {
        missing.push(`当前代码版本缺少 ${options.targetSource} 的修改证据`);
      }

      const passedTest = (scope: string): boolean => current.some(
        (item) =>
          item.kind === "test"
          && item.payload.scope === scope
          && item.payload.exitCode === 0,
      );
      for (const scope of requiredScopes) {
        if (!passedTest(scope)) {
          missing.push(`当前版本缺少通过的测试范围：${scope}`);
        }
      }

      if (!hasArtifact(current, options.targetArtifact)) {
        missing.push(`缺少交付说明：${options.targetArtifact}`);
      }
      return missing;
    },
  };
}
