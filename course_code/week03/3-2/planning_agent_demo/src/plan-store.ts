// ============================================================================
// 3.2 计划层：Plan / PlanStep / Evidence / PlanStore / PlanningSession
//
// 这些类型与方法是课程新增的应用代码；pi 只提供 Agent Loop 与 Hook。
// 计划层回答三个问题：
//   1. 任务由哪些可验收的子目标组成（PlanStep.successCriteria）；
//   2. 当前允许开始哪一步（dependsOn + readySteps）；
//   3. 哪一步真的完成了（Evidence + StepVerifier）。
// ============================================================================

export type StepStatus =
  | "pending"      // 等待依赖完成
  | "in_progress"  // 正在执行
  | "completed"    // 证据已通过步骤验收
  | "blocked"      // 权限、预算或外部条件阻塞
  | "skipped"      // 被替换或明确放弃；不等于 completed
  | "failed";      // 尝试失败，等待修订或重试

export type EvidenceKind = "tool" | "test" | "diff" | "inspection";

/** 执行层留下的结构化证据。证据只由 Runtime 写入，模型只能引用 id。 */
export interface Evidence {
  id: string;
  stepId: string;
  toolCallId: string;
  /** 产生该证据时的代码版本；换版本后旧的测试/改动证据不再能用于交付。 */
  artifactVersion: string;
  kind: EvidenceKind;
  summary: string;
  payload: Record<string, unknown>;
}

export interface PlanStep {
  id: string;
  /** 完成后系统应产生的新事实，而不是“做个什么动作”。 */
  objective: string;
  dependsOn: string[];
  /** 事前定义的完成标准；与事后收集的 evidence 分开存放。 */
  successCriteria: string[];
  status: StepStatus;
  evidenceIds: string[];
  attempts: number;
  lastError?: string;
}

export interface Plan {
  version: number;
  goal: string;
  constraints: string[];
  steps: PlanStep[];
  revisionCount: number;
  maxRevisions: number;
}

export interface PlanRevision {
  version: number;
  reason: string;
  evidenceIds: string[];
  changes: string[];
}

export type PlanSnapshot = Plan & {
  revisions: PlanRevision[];
  executedSteps: number;
};

/** 一次修订请求：整体校验通过才提交，失败时原计划保持不变。 */
export interface RevisionRequest {
  expectedVersion: number;
  reason: string;
  evidenceIds: string[];
  replace?: { oldStepId: string; newStep: StepSpec };
  add?: StepSpec[];
  dependencies?: { stepId: string; dependsOn: string[] }[];
}

/** 步骤验收器：返回缺失项；空数组表示证据满足该步骤的完成标准。 */
export type StepVerifier = (step: PlanStep, evidence: Evidence[]) => string[];

/** 新建步骤时只描述结果与依赖，状态由 PlanStore 托管。 */
export interface StepSpec {
  id: string;
  objective: string;
  dependsOn: string[];
  successCriteria: string[];
}

export function stepFromSpec(spec: StepSpec): PlanStep {
  return {
    id: spec.id,
    objective: spec.objective,
    dependsOn: [...spec.dependsOn],
    successCriteria: [...spec.successCriteria],
    status: "pending",
    evidenceIds: [],
    attempts: 0,
  };
}

// ============================================================================
// EvidenceStore：可信证据的唯一来源
// ============================================================================
export class EvidenceStore {
  private readonly items = new Map<string, Evidence>();
  private sequence = 0;

  add(input: Omit<Evidence, "id"> & { id?: string }): Evidence {
    const id = input.id ?? `ev-${++this.sequence}`;
    if (this.items.has(id)) throw new Error(`duplicate evidence: ${id}`);
    const evidence: Evidence = { ...input, id };
    this.items.set(id, evidence);
    return evidence;
  }

  get(id: string): Evidence | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  forStep(stepId: string): Evidence[] {
    return [...this.items.values()].filter((item) => item.stepId === stepId);
  }

  list(): Evidence[] {
    return [...this.items.values()];
  }
}

// ============================================================================
// PlanStore：计划状态与确定性规则
// 依赖检查、证据校验、原子修订与修订预算都在这里收口。
// ============================================================================
export interface PlanStoreOptions {
  verifyStep?: StepVerifier;
  /** 读取当前代码版本；测试与改动证据必须产自这个版本。 */
  getRevision?: () => string;
}

export class PlanStore {
  private plan: Plan;
  private readonly revisions: PlanRevision[] = [];
  private executedSteps = 0;
  private readonly verifyStep: StepVerifier;
  private readonly getRevision: () => string;

  constructor(
    plan: Plan,
    private readonly evidence: EvidenceStore,
    options: PlanStoreOptions = {},
  ) {
    this.plan = structuredClone(plan);
    this.verifyStep = options.verifyStep ?? (() => []);
    this.getRevision = options.getRevision ?? (() => "r0");
    PlanStore.validate(this.plan);
  }

  get version(): number {
    return this.plan.version;
  }

  get maxRevisions(): number {
    return this.plan.maxRevisions;
  }

  get revisionCount(): number {
    return this.plan.revisionCount;
  }

  get goal(): string {
    return this.plan.goal;
  }

  snapshot(): PlanSnapshot {
    return {
      ...structuredClone(this.plan),
      revisions: structuredClone(this.revisions),
      executedSteps: this.executedSteps,
    };
  }

  getStep(id: string): PlanStep | undefined {
    return this.plan.steps.find((step) => step.id === id);
  }

  /** 当前可以开始的步骤：依赖全部 completed。skipped/failed 都不满足依赖。 */
  readySteps(): PlanStep[] {
    return this.plan.steps.filter((step) =>
      step.status === "pending"
      && step.dependsOn.every((id) => this.requireStep(id).status === "completed"),
    );
  }

  isReady(id: string): boolean {
    return this.readySteps().some((step) => step.id === id);
  }

  start(id: string, expectedVersion?: number): void {
    this.assertVersion(expectedVersion);
    const step = this.requireStep(id);
    if (step.status === "in_progress") return;
    if (!this.isReady(id)) {
      throw new Error(`PLAN_STEP_NOT_READY: ${id}`);
    }
    step.status = "in_progress";
    step.attempts += 1;
    this.executedSteps += 1;
  }

  /** 执行前校验：受计划约束的动作必须绑定到一个已就绪或进行中的步骤。 */
  ensureActive(id: string): void {
    const step = this.requireStep(id);
    if (step.status === "in_progress") return;
    if (step.status === "pending" && this.isReady(id)) {
      this.start(id);
      return;
    }
    throw new Error(`PLAN_STEP_NOT_READY: ${id} (${step.status})`);
  }

  complete(id: string, evidenceIds: string[], expectedVersion?: number): void {
    this.assertVersion(expectedVersion);
    const step = this.requireStep(id);
    if (step.status !== "in_progress") {
      throw new Error(`PLAN_STEP_NOT_RUNNING: ${id} (${step.status})`);
    }
    if (evidenceIds.length === 0) {
      throw new Error(`PLAN_COMPLETION_REQUIRES_EVIDENCE: ${id}`);
    }

    const items = evidenceIds.map((evidenceId) => {
      const item = this.evidence.get(evidenceId);
      if (!item) throw new Error(`PLAN_UNKNOWN_EVIDENCE: ${evidenceId}`);
      if (item.stepId !== id) {
        throw new Error(`PLAN_EVIDENCE_STEP_MISMATCH: ${evidenceId} -> ${item.stepId}`);
      }
      return item;
    });

    const current = this.getRevision();
    const stale = items.filter((item) =>
      (item.kind === "test" || item.kind === "diff")
      && item.artifactVersion !== current
    );
    if (stale.length > 0) {
      throw new Error(
        `PLAN_EVIDENCE_STALE: ${stale.map((item) => item.id).join(",")}`,
      );
    }

    const missing = this.verifyStep(step, items);
    if (missing.length > 0) {
      throw new Error(`PLAN_COMPLETION_REJECTED: ${missing.join("; ")}`);
    }

    step.evidenceIds.push(...evidenceIds);
    step.status = "completed";
  }

  fail(id: string, error: string, expectedVersion?: number): void {
    this.assertVersion(expectedVersion);
    const step = this.requireStep(id);
    step.status = "failed";
    step.lastError = error;
  }

  block(id: string, reason: string, expectedVersion?: number): void {
    this.assertVersion(expectedVersion);
    const step = this.requireStep(id);
    step.status = "blocked";
    step.lastError = reason;
  }

  /** skipped 不满足下游依赖；有下游依赖时必须先修订改接。 */
  skip(id: string, reason: string, expectedVersion?: number): void {
    this.assertVersion(expectedVersion);
    const dependents = this.plan.steps.filter((step) => step.dependsOn.includes(id));
    if (dependents.length > 0) {
      throw new Error(
        `PLAN_SKIP_REQUIRES_REWIRE: ${id} <- ${dependents.map((step) => step.id).join(",")}`,
      );
    }
    const step = this.requireStep(id);
    step.status = "skipped";
    step.lastError = reason;
  }

  revise(request: RevisionRequest): PlanSnapshot {
    this.assertVersion(request.expectedVersion);
    if (this.plan.revisionCount >= this.plan.maxRevisions) {
      throw new Error("PLAN_MAX_REVISIONS_EXCEEDED");
    }
    if (!request.reason || request.reason.trim().length === 0) {
      throw new Error("PLAN_REVISION_REQUIRES_REASON");
    }
    if (request.evidenceIds.length === 0) {
      throw new Error("PLAN_REVISION_REQUIRES_EVIDENCE");
    }
    for (const evidenceId of request.evidenceIds) {
      if (!this.evidence.has(evidenceId)) {
        throw new Error(`PLAN_UNKNOWN_EVIDENCE: ${evidenceId}`);
      }
    }

    const candidate = structuredClone(this.plan);
    const changes: string[] = [];
    const find = (id: string): PlanStep | undefined =>
      candidate.steps.find((step) => step.id === id);

    if (request.replace) {
      const { oldStepId, newStep } = request.replace;
      const old = find(oldStepId);
      if (!old) throw new Error(`PLAN_UNKNOWN_STEP: ${oldStepId}`);
      if (newStep.id !== oldStepId && find(newStep.id)) {
        throw new Error(`PLAN_DUPLICATE_STEP: ${newStep.id}`);
      }

      // 旧步骤保留在历史中，不再参与执行；下游依赖原子改接到新步骤。
      old.status = "skipped";
      old.lastError = `replaced by ${newStep.id}`;
      const insertAt = candidate.steps.findIndex((step) => step.id === oldStepId);
      candidate.steps.splice(insertAt + 1, 0, stepFromSpec(newStep));
      changes.push(`replace:${oldStepId}->${newStep.id}`);

      for (const step of candidate.steps) {
        if (!step.dependsOn.includes(oldStepId)) continue;
        step.dependsOn = step.dependsOn.map((id) =>
          id === oldStepId ? newStep.id : id
        );
        changes.push(`rewire:${step.id}.dependsOn=${newStep.id}`);
      }
    }

    for (const step of request.add ?? []) {
      if (find(step.id)) throw new Error(`PLAN_DUPLICATE_STEP: ${step.id}`);
      candidate.steps.push(stepFromSpec(step));
      changes.push(`add:${step.id}`);
    }

    for (const change of request.dependencies ?? []) {
      const step = find(change.stepId);
      if (!step) throw new Error(`PLAN_UNKNOWN_STEP: ${change.stepId}`);
      step.dependsOn = [...new Set(change.dependsOn)];
      changes.push(`depends:${step.id}->[${step.dependsOn.join(",")}]`);
    }

    PlanStore.validate(candidate);

    // 候选计划整体校验通过后才提交。
    candidate.version += 1;
    candidate.revisionCount += 1;
    this.plan = candidate;
    this.revisions.push({
      version: candidate.version,
      reason: request.reason,
      evidenceIds: [...request.evidenceIds],
      changes,
    });
    return this.snapshot();
  }

  private assertVersion(expectedVersion?: number): void {
    if (expectedVersion === undefined) return;
    if (expectedVersion !== this.plan.version) {
      throw new Error(
        `PLAN_VERSION_CONFLICT: expected ${expectedVersion}, current ${this.plan.version}`,
      );
    }
  }

  private requireStep(id: string): PlanStep {
    const step = this.getStep(id);
    if (!step) throw new Error(`PLAN_UNKNOWN_STEP: ${id}`);
    return step;
  }

  /** 不变量：ID 唯一、依赖存在、依赖图无环。 */
  static validate(plan: Plan): void {
    if (plan.steps.length === 0) {
      throw new Error("PLAN_REQUIRES_STEPS");
    }
    const ids = new Set<string>();
    for (const step of plan.steps) {
      if (ids.has(step.id)) throw new Error(`PLAN_DUPLICATE_STEP: ${step.id}`);
      ids.add(step.id);
    }
    for (const step of plan.steps) {
      for (const dependencyId of step.dependsOn) {
        if (!ids.has(dependencyId)) {
          throw new Error(`PLAN_UNKNOWN_DEPENDENCY: ${step.id} -> ${dependencyId}`);
        }
      }
    }
    if (PlanStore.hasCycle(plan)) {
      throw new Error("PLAN_DEPENDENCY_CYCLE");
    }
  }

  private static hasCycle(plan: Plan): boolean {
    const byId = new Map(plan.steps.map((step) => [step.id, step]));
    const visiting = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string): boolean => {
      if (done.has(id)) return false;
      if (visiting.has(id)) return true;
      visiting.add(id);
      const step = byId.get(id);
      for (const dependencyId of step?.dependsOn ?? []) {
        if (visit(dependencyId)) return true;
      }
      visiting.delete(id);
      done.add(id);
      return false;
    };
    return plan.steps.some((step) => visit(step.id));
  }
}

// ============================================================================
// PlanningSession：一次 Run 的计划容器
// Loop、计划工具、完成契约都通过它读写同一份计划与证据。
// ============================================================================
export interface CreatePlanSpec {
  goal: string;
  constraints?: string[];
  steps: StepSpec[];
  maxRevisions?: number;
}

export class PlanningSession {
  readonly evidence = new EvidenceStore();
  private store?: PlanStore;

  constructor(private readonly options: PlanStoreOptions & { maxRevisions?: number } = {}) {}

  get plan(): PlanStore | undefined {
    return this.store;
  }

  requirePlan(): PlanStore {
    if (!this.store) throw new Error("PLAN_NOT_CREATED");
    return this.store;
  }

  createPlan(spec: CreatePlanSpec): PlanStore {
    if (this.store) throw new Error("PLAN_ALREADY_EXISTS");
    this.store = new PlanStore(
      {
        version: 1,
        goal: spec.goal,
        constraints: [...(spec.constraints ?? [])],
        steps: spec.steps.map(stepFromSpec),
        revisionCount: 0,
        maxRevisions: spec.maxRevisions ?? this.options.maxRevisions ?? 2,
      },
      this.evidence,
      this.options,
    );
    return this.store;
  }

  snapshot(): PlanSnapshot | undefined {
    return this.store?.snapshot();
  }

  addEvidence(input: Omit<Evidence, "id">): Evidence {
    return this.evidence.add(input);
  }
}
