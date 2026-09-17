// ============================================================================
// 运行提示词与计划快照
//
// planningPrompt         : 业务 Agent 执行任务时遵守的规则（第一轮就注入）；
// renderPlanSnapshot     : 每轮替换注入的当前计划视图，不重复堆积历史。
// ============================================================================
import type { Evidence, PlanSnapshot } from "./plan-store.js";

export const PLANNING_PROMPT = [
  "你是代码任务 Agent。所有面向用户的自然语言回复必须使用简体中文。",
  "根据任务规模决定是否使用显式计划：简单查询直接调用工具；复杂修复先创建或读取计划。",
  "",
  "计划步骤描述可验收结果，列出 dependsOn 和完成标准。",
  "未知根因先安排诊断，不把猜测写成已经确认的修改目标。",
  "执行受计划管理的动作时（write_file / apply_patch / run_test），必须携带对应 planStepId。",
  "",
  "每次工具返回后：",
  "- 判断结果支持还是推翻当前假设；",
  "- 条件未变化就继续就绪步骤，局部参数错误先局部修正；",
  "- 假设或约束变化时，引用证据申请 revise_plan；",
  "- 遇到权限或预算限制，报告阻塞，不绕过规则。",
  "",
  "申请完成步骤时引用真实 evidenceIds。",
  "不得降低验收标准，不得删除必要验证以提前结束。",
  "最终报告包含改动、实际验证命令、结果和未验证项。",
  "只输出必要判断与行动依据，不要求展开完整思维链。",
].join("\n");

export function renderPlanSnapshot(
  plan: PlanSnapshot | undefined,
  evidence: Evidence[],
): string {
  if (!plan) {
    return [
      "[计划快照]", 
      "状态：尚未创建计划。",
      "如果任务包含多个互相依赖的步骤，先调用 create_plan。",
    ].join("\n");
  }

  const line = (step: PlanSnapshot["steps"][number]): string =>
    `- ${step.id}：${step.objective}（依赖：${step.dependsOn.join(",") || "无"}）`;
  const byStatus = (status: string) => plan.steps.filter((step) => step.status === status);
  const ready = plan.steps.filter((step) =>
    step.status === "pending"
    && step.dependsOn.every((id) =>
      plan.steps.find((item) => item.id === id)?.status === "completed"
    )
  );

  const sections: string[] = [
    `[计划快照 v${plan.version}｜已修订 ${plan.revisionCount}/${plan.maxRevisions} 次]`,
    `目标：${plan.goal}`,
  ];
  if (plan.constraints.length > 0) {
    sections.push(`约束：${plan.constraints.join("；")}`);
  }
  sections.push(`就绪：\n${ready.length > 0 ? ready.map(line).join("\n") : "- 无"}`);
  if (byStatus("in_progress").length > 0) {
    sections.push(`进行中：\n${byStatus("in_progress").map(line).join("\n")}`);
  }
  if (byStatus("blocked").length > 0 || byStatus("failed").length > 0) {
    sections.push([
      "阻塞/失败：",
      ...plan.steps
        .filter((step) => step.status === "blocked" || step.status === "failed")
        .map((step) => `${line(step)}｜原因：${step.lastError ?? "未记录"}`),
    ].join("\n"));
  }
  if (byStatus("completed").length > 0) {
    sections.push(`已完成：${byStatus("completed").map((step) => step.id).join(", ")}`);
  }

  const recent = evidence.slice(-5);
  sections.push(
    `最近证据：\n${recent.length > 0
      ? recent.map((item) => `- ${item.id} [${item.kind}] ${item.summary}（步骤 ${item.stepId}）`).join("\n")
      : "- 无"}`,
  );
  return sections.join("\n");
}
