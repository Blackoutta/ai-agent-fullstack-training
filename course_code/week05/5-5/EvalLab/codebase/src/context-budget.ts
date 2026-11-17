import { createHash } from "node:crypto";
import { estimateTokens } from "@earendil-works/pi-agent-core";

/**
 * 上下文预算的单一出口。三件事都在这里做，别处不许各写一份：
 *   1) renderContext —— 把跑了几轮之后越堆越长的对话压回一个能复现的形状；
 *   2) summarizeStep —— 旧步骤只留一行，格式固定，人可以逐字比对；
 *   3) clipForAudit —— 工具全文不进数据库，进的是按行截断的头部 + 全量哈希。
 *
 * 为什么不用 pi 自带的 compact()：它要调一次模型生成摘要，摘要文字每次跑都不一样，
 * 离线跑（脚本决策器）根本没有可用的摘要模型，课后复现和评估器对账都无从下手。
 * 这里的压缩不请模型帮忙，纯按规则裁剪，同一份输入永远得到同一份输出。
 */
export interface ContextRules {
  keepRecentTurns: number;
  auditMaxLines: number;
  auditMaxChars: number;
}

/** 没配 context 段时的兜底：与 config/platform.yaml 里写的值一致。 */
export const DEFAULT_CONTEXT_RULES: ContextRules = {
  keepRecentTurns: 2,
  auditMaxLines: 30,
  auditMaxChars: 4_000,
};

export interface RenderableMessage {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

export interface ContextStats {
  /** 这次渲染是否真的换掉了上下文。摘要不比原文短时宁可不换：逐字保留更重要。 */
  applied: boolean;
  steps_total: number;
  steps_summarized: number;
  chars_before: number;
  chars_after: number;
  tokens_before: number;
  tokens_after: number;
  rendered_hash: string;
}

export interface RenderedContext {
  messages: RenderableMessage[];
  stats: ContextStats;
}

export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const item = part as Record<string, unknown>;
        if (typeof item?.text === "string") return item.text;
        if (item?.type === "toolCall") {
          return `${String(item.name)}(${canonicalArgs(item.arguments ?? item.args)})`;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function canonicalArgs(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return entries.map(([key, item]) => `${key}=${typeof item === "string" ? item : JSON.stringify(item)}`).join(", ");
}

/** assistant 一条 + 紧跟其后的若干 toolResult = 一步。其余消息不参与压缩，永远逐字留着。 */
function splitSteps(messages: RenderableMessage[]): { pinned: RenderableMessage[]; steps: RenderableMessage[][] } {
  const pinned: RenderableMessage[] = [];
  const steps: RenderableMessage[][] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      steps.push([message]);
      continue;
    }
    if (message.role === "toolResult" && steps.length > 0) {
      steps[steps.length - 1].push(message);
      continue;
    }
    pinned.push(message);
  }
  return { pinned, steps };
}

/**
 * 一行摘要要回答的是"这一步干了什么、结果如何、还想看的话怎么回去"。
 * 参数照抄进摘要，模型才能原样重发；不写结果正文，避免摘要本身又长成一个新的上下文包袱。
 */
export function summarizeStep(index: number, step: RenderableMessage[]): string {
  const assistant = step.find((message) => message.role === "assistant");
  const calls = ((assistant?.content ?? []) as unknown[]).filter(
    (part) => (part as Record<string, unknown>)?.type === "toolCall",
  ) as Array<Record<string, unknown>>;
  const results = step.filter((message) => message.role === "toolResult");

  const label = (call: Record<string, unknown> | undefined, result: RenderableMessage | undefined): string => {
    const name = String(call?.name ?? result?.toolName ?? "unknown");
    const args = canonicalArgs(call?.arguments ?? call?.args);
    const text = textOf(result?.content);
    const code = resultError(result) ? String(result?.code ?? "ERROR") : "OK";
    return `${name}(${args}) → ${code} · ${lineCount(text)} 行 / ${text.length} 字符`;
  };

  const head = calls.length > 0 ? calls : results.map(() => undefined);
  const parts = head.map((call, position) => label(call, results[position]));
  const lines = step.reduce((total, message) => total + lineCount(textOf(message.content)), 0);
  return `第${index}步 ${parts.join("；") || "无工具调用"} · 该步共 ${lines} 行已从上下文移出`;
}

function resultError(result: RenderableMessage | undefined): boolean {
  return Boolean((result as Record<string, unknown> | undefined)?.isError);
}

function lineCount(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

function summaryMessage(summaries: string[]): RenderableMessage {
  return {
    role: "user",
    content:
      `[上下文压缩] 下面 ${summaries.length} 步的逐字内容不在本轮上下文里，只留一行摘要：\n` +
      summaries.map((line) => `  ${line}`).join("\n") +
      `\n需要重看某一步的原文：照抄摘要里的工具名与参数重新调用；不要凭摘要描述实现细节下结论。`,
    timestamp: 0,
  };
}

/**
 * 渲染前后的"体量"必须用同一把尺子逐条量，所以这里用 pi 的 estimateTokens（字符/4 的保守启发式，
 * 每条消息各算各的），不用 estimateContextTokens：后者一发现 assistant 消息带着 provider 回报的
 * usage，就直接把那个 usage 数当结果返回——压缩前后取的是同一条 assistant 消息的 usage，
 * 数字永远相等，也就回答不了"这次渲染到底省下了多少"。
 * 两个口径下 role 为 system 的消息都记 0，所以这两个数是"对话正文"的量，不含系统提示词。
 */
function tokenSum(messages: RenderableMessage[]): number {
  return messages.reduce((total, message) => total + estimateTokens(message as never), 0);
}

export function renderContext(
  messages: RenderableMessage[],
  rules: ContextRules,
): RenderedContext {
  const charsBefore = messages.reduce((total, message) => total + textOf(message.content).length, 0);
  const tokensBefore = tokenSum(messages);
  const { pinned, steps } = splitSteps(messages);

  if (steps.length <= rules.keepRecentTurns) {
    return { messages, stats: statsOf(messages, steps.length, 0, false, charsBefore, tokensBefore) };
  }

  const summarized = steps.slice(0, steps.length - rules.keepRecentTurns);
  const kept = steps.slice(steps.length - rules.keepRecentTurns);
  const summaries = summarized.map((step, index) => summarizeStep(index + 1, step));
  const rendered = [...pinned, summaryMessage(summaries), ...kept.flat()];
  const charsAfter = rendered.reduce((total, message) => total + textOf(message.content).length, 0);

  // 摘要行本身也要占地方。旧步骤都很短的时候，"压缩"反而更长——那就别压，逐字留着。
  if (charsAfter >= charsBefore) {
    return { messages, stats: statsOf(messages, steps.length, 0, false, charsBefore, tokensBefore) };
  }
  return {
    messages: rendered,
    stats: statsOf(rendered, steps.length, summarized.length, true, charsBefore, tokensBefore),
  };
}

function statsOf(
  rendered: RenderableMessage[],
  stepsTotal: number,
  stepsSummarized: number,
  applied: boolean,
  charsBefore: number,
  tokensBefore: number,
): ContextStats {
  const charsAfter = rendered.reduce((total, message) => total + textOf(message.content).length, 0);
  return {
    applied,
    steps_total: stepsTotal,
    steps_summarized: stepsSummarized,
    chars_before: charsBefore,
    chars_after: charsAfter,
    tokens_before: tokensBefore,
    tokens_after: tokenSum(rendered),
    rendered_hash: sha256(rendered.map((message) => `${message.role}:${textOf(message.content)}`).join("\n")),
  };
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * 审计与 Trace 存的是"发生过什么"，不是"全文是什么"。
 * 按行截断（绝不从行中间切断），留下全量行数与整份文本的哈希：
 * 事后要证明"模型当时看到的就是这一份"，拿哈希对哈希即可，不必把 12k 字符塞进数据库。
 */
export interface AuditClip {
  text: string;
  truncated: boolean;
  total_lines: number;
  total_chars: number;
  kept_lines: number;
  full_sha256: string;
}

export function clipForAudit(value: unknown, rules: ContextRules): AuditClip {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  const lines = text.length === 0 ? [] : text.split("\n");
  const kept: string[] = [];
  let chars = 0;
  for (const line of lines) {
    if (kept.length >= rules.auditMaxLines) break;
    if (chars + line.length + 1 > rules.auditMaxChars) break;
    kept.push(line);
    chars += line.length + 1;
  }
  const truncated = kept.length < lines.length;
  return {
    text: truncated ? `${kept.join("\n")}\n[以下 ${lines.length - kept.length} 行未入库，全文哈希见 full_sha256]` : text,
    truncated,
    total_lines: lines.length,
    total_chars: text.length,
    kept_lines: kept.length,
    full_sha256: sha256(text),
  };
}
