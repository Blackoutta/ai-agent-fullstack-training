import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { PlatformConfig } from "../config.js";
import type { ExecutionContext } from "../domain.js";

export interface PromptBundle {
  prompt: string;
  version: string;
  contentHash: string;
  source: "gateway" | "local";
}

interface PromptTemplate {
  required_variables?: string[];
  template: string;
}

function variablesFor(config: PlatformConfig, context: ExecutionContext): Record<string, string> {
  const task = config.task;
  return {
    tenant_id: context.tenantId,
    user_id: context.userId,
    agent_name: context.agentName,
    // 任务知识进提示词：领了任务就按那一类的简报与交付物说话，没领就把决定权交回目标本身。
    task_name: task ? `${task.id}（${task.displayName}）` : "未指定",
    task_brief: task
      ? task.brief.trimEnd()
      : "任务给出的交付路径与结构要求优先于上面的习惯做法。",
    deliverable: task?.deliverable ?? "以目标里写明的路径为准。",
  };
}

/**
 * 提示词有两个来源，产出同一个三元组 {prompt, version, contentHash}：
 * gateway 走阶段一的 Prompt Registry，local 直接读仓库里那份 prompts.yaml。
 * 离线跑评估时用 local，CI 因此不需要网络。
 */
export async function renderSystemPrompt(
  config: PlatformConfig,
  context: ExecutionContext,
): Promise<PromptBundle> {
  const variables = variablesFor(config, context);
  const bundle =
    config.prompt.source === "gateway"
      ? await renderViaGateway(config, variables)
      : renderLocally(config, variables);
  return bundle;
}

function renderLocally(config: PlatformConfig, variables: Record<string, string>): PromptBundle {
  const raw = parse(readFileSync(config.prompt.file, "utf8")) as {
    prompts?: Record<string, { versions: Record<string, PromptTemplate> }>;
  };
  const entry = raw.prompts?.[config.gateway.promptName];
  if (!entry) throw new Error(`prompts.yaml 里没有 ${config.gateway.promptName}`);
  const template = entry.versions[config.gateway.promptVersion];
  if (!template) {
    throw new Error(`${config.gateway.promptName} 没有版本 ${config.gateway.promptVersion}`);
  }
  for (const name of template.required_variables ?? []) {
    if (!variables[name]) throw new Error(`提示词缺少必需变量: ${name}`);
  }
  const prompt = fillTemplate(template.template, variables);
  return { prompt, version: config.gateway.promptVersion, contentHash: sha256(prompt), source: "local" };
}

async function renderViaGateway(config: PlatformConfig, variables: Record<string, string>): Promise<PromptBundle> {
  const apiKey = process.env[config.gateway.apiKeyEnv];
  if (!apiKey) throw new Error(`Missing ${config.gateway.apiKeyEnv}`);
  const base = config.gateway.baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
  const response = await fetch(`${base}/v1/prompts/${encodeURIComponent(config.gateway.promptName)}/render`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ version: config.gateway.promptVersion, variables }),
  });
  if (!response.ok) throw new Error(`Prompt Registry returned ${response.status}: ${await response.text()}`);
  const payload = (await response.json()) as any;
  return { prompt: payload.prompt, version: payload.version, contentHash: payload.content_hash, source: "gateway" };
}

function fillTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => variables[name] ?? match);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
