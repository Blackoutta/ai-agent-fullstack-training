// 执行上下文：一次 Run 的路径边界来源。
// 约束：纯函数、无副作用、不触碰文件系统；工程根由模块自身位置推导，不依赖进程工作目录。
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface DemoExecutionContext {
  // 工程根：写入越界校验的基准，也是产物目录的挂载点。
  projectRoot: string;
  // 目标仓库根：读取与搜索不得越出此目录（本层默认指向同级 login_demo）。
  repoRoot: string;
  // 产物根：唯一允许写入的位置。
  artifactRoot: string;
  // 本次任务的交付物相对路径（相对工程根，含产物目录前缀）。
  targetArtifact: string;
}

// 由模块自身位置推导工程根：<projectRoot>/src/run-context.ts -> <projectRoot>。
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function createExecutionContext(
  overrides: Partial<DemoExecutionContext> = {},
): DemoExecutionContext {
  const projectRoot = overrides.projectRoot ?? PROJECT_ROOT;
  // 目标仓库与工程同级：3-1/login_demo。此处只表达位置，不假设其内部文件名。
  const repoRoot = overrides.repoRoot ?? path.resolve(
    projectRoot,
    "..",
    "login_demo",
  );
  const artifactRoot = overrides.artifactRoot ?? path.join(
    projectRoot,
    "artifacts",
  );

  return {
    projectRoot,
    repoRoot,
    artifactRoot,
    targetArtifact: overrides.targetArtifact ?? "artifacts/login-flow.md",
  };
}
