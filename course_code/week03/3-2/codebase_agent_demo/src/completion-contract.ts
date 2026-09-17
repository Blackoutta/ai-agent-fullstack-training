// ============================================================================
// 完成契约：把「什么算完成」从 LoopGuard 的硬编码里提取出来。
//
// 对照组（3.1）的 LoopGuard 原先直接判断 artifacts/login-flow.md，
// 只适用于代码理解任务。这里把验收对象做成可注入的契约，使同一条 Loop
// 既能跑代码理解，也能跑测试修复，而两者只差一个可替换的契约。
//   - 代码理解任务：读取足量源码 + 生成说明文档；
//   - 测试修复任务：当前代码版本上有改动、有通过的测试、有交付说明。
// ============================================================================
export type EvidenceKind = "tool" | "inspection" | "diff" | "test";

/** 执行层留下的结构化证据。证据只由 Runtime 写入，模型只能引用 id。 */
export interface EvidenceRecord {
  id: string;
  toolCallId: string;
  /** 产生该证据时的代码版本；换版本后旧的测试/改动证据不再能用于交付。 */
  artifactVersion: string;
  kind: EvidenceKind;
  summary: string;
  payload: Record<string, unknown>;
}

export interface CompletionContract {
  id: string;
  verify(input: { evidence: EvidenceRecord[]; revision: string }): string[];
}

function hasArtifact(evidence: EvidenceRecord[], artifact: string): boolean {
  return evidence.some(
    (item) => item.kind === "tool" && item.payload.artifact === artifact,
  );
}

/** 代码理解契约：读够源码，并交付说明文档。 */
export function createCodeUnderstandingContract(options: {
  targetArtifact: string;
  minReadFiles?: number;
}): CompletionContract {
  const minReadFiles = options.minReadFiles ?? 3;
  return {
    id: "code-understanding",
    verify({ evidence }) {
      const missing: string[] = [];
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

/** 修复契约：当前版本上有改动、约定范围的测试都通过、并有交付说明。 */
export function createLoginFixContract(options: {
  targetSource: string;
  targetArtifact: string;
  /** 必须全部通过的测试范围。 */
  requiredScopes?: string[];
}): CompletionContract {
  const requiredScopes = options.requiredScopes ?? ["target", "boundary", "regression"];
  return {
    id: "login-fix",
    verify({ evidence, revision }) {
      const missing: string[] = [];
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
