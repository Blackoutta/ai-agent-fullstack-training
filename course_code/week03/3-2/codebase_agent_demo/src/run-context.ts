import { fileURLToPath } from "node:url";
import path from "node:path";

/** 一组约定好的测试文件，路径相对 repoRoot。 */
export interface TestSuiteSpec {
  files: string[];
}

export interface DemoExecutionContext {
  projectRoot: string;
  /** 执行测试时的工作目录：tsx 等运行依赖从这里解析。 */
  runtimeRoot: string;
  repoRoot: string;
  artifactRoot: string;
  targetArtifact: string;
  /** 本次任务允许修改的源码文件（相对 repoRoot）。 */
  targetSource: string;
  /** 目标用例：复现失败与验证修复都用它。 */
  targetSuite: TestSuiteSpec;
  /** 边界用例：到期前、到期时、到期后。 */
  boundarySuite: TestSuiteSpec;
  /** 约定的回归范围。 */
  regressionSuite: TestSuiteSpec;
}

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function createExecutionContext(
  overrides: Partial<DemoExecutionContext> = {},
): DemoExecutionContext {
  const projectRoot = overrides.projectRoot ?? PROJECT_ROOT;
  const repoRoot = overrides.repoRoot ?? path.join(
    projectRoot,
    "fixtures",
    "demo-app",
  );
  const artifactRoot = overrides.artifactRoot ?? path.join(
    projectRoot,
    "artifacts",
  );

  return {
    projectRoot,
    runtimeRoot: overrides.runtimeRoot ?? projectRoot,
    repoRoot,
    artifactRoot,
    targetArtifact: overrides.targetArtifact ?? "artifacts/login-flow.md",
    targetSource: overrides.targetSource ?? "src/auth/session-policy.ts",
    targetSuite: overrides.targetSuite ?? { files: ["tests/session-policy.test.ts"] },
    boundarySuite: overrides.boundarySuite ?? { files: ["tests/session-boundary.test.ts"] },
    regressionSuite: overrides.regressionSuite ?? { files: ["tests/login-flow.test.ts"] },
  };
}
