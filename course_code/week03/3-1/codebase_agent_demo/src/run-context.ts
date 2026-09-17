import { fileURLToPath } from "node:url";
import path from "node:path";

export interface DemoExecutionContext {
  projectRoot: string;
  repoRoot: string;
  artifactRoot: string;
  targetArtifact: string;
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
    repoRoot,
    artifactRoot,
    targetArtifact: overrides.targetArtifact ?? "artifacts/login-flow.md",
  };
}
