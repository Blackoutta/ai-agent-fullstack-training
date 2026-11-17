import { join } from "node:path";
import { Type } from "typebox";
import type { RagConfig } from "../config.js";
import type { ManagedTool } from "../domain.js";
import { ToolRuntimeError } from "../domain.js";
import type { Sandbox } from "../sandbox.js";
import { integer, optionalText, text } from "./args.js";

/** query.py --json 的输出契约（见 4-6/rag/query.py）。 */
interface RagPayload {
  question?: string;
  mode?: string;
  top_k?: number;
  answer?: string | null;
  llm_error?: string | null;
  error?: string;
  citations?: Array<{
    index?: number;
    file?: string;
    heading?: string;
    score?: number;
    snippet?: string;
  }>;
}

/**
 * 外部 RAG 查询工具。它和十件仓库工具一样注册进 ToolRegistry、过 PolicyEngine 与 ToolRuntime：
 * 读要 rag:read，调用照常落审计。与仓库工具的区别只有一个：它查的不是 sandbox.root 那个仓库，
 * 而是一份独立的 RAG 服务（4-6/rag），所以不经沙箱的仓库路径校验。
 *
 * 调用形态：`python <rag.dir>/query.py --json -q "<问题>" [...]`。RAG 目录在工作区之外，
 * 但 query.py 用 __file__ 自己定位存储，与子进程 cwd 无关，因此用绝对脚本路径调用即可（sandbox.exec 的
 * cwd 恒为工作区根，这里不依赖它）。
 */
export function createRagTools(rag: RagConfig, sandbox: Sandbox): ManagedTool[] {
  return [createRagQueryTool(rag, sandbox)];
}

export function createRagQueryTool(rag: RagConfig, sandbox: Sandbox): ManagedTool {
  return {
    metadata: {
      internalName: "rag_query",
      description:
        "查询外部 RAG 知识库（BGE 向量 + BM25 关键词混合检索），返回「答案 + 引用来源追溯」。" +
        "答案只依据命中的文档片段生成，每条结论都带 [编号]，编号对应 citations 里的同一条来源。" +
        "需要事实依据、追溯出处时用它的返回，不要凭印象编。查不到会明确说明。",
      version: "2.0.0",
      parameters: Type.Object(
        {
          question: Type.String({
            description: "要查询的自然语言问题，例如「会话的有效期是多少分钟？」",
            minLength: 1,
          }),
          mode: Type.Optional(
            Type.String({
              description: "检索方式：hybrid（默认，向量+BM25 融合）/ vector（仅向量）/ bm25（仅关键词）",
              enum: ["hybrid", "vector", "bm25"],
            }),
          ),
          top_k: Type.Optional(
            Type.Number({
              description: `最终返回的证据条数，默认 ${rag.defaultTopK}，上限 20`,
              minimum: 1,
              maximum: 20,
            }),
          ),
          doc_type: Type.Optional(
            Type.String({
              description: "元数据过滤，只看某一类来源：doc / code / web / table / pdf",
              enum: ["doc", "code", "web", "table", "pdf"],
            }),
          ),
          no_llm: Type.Optional(
            Type.Boolean({ description: "true 时只召回证据、不调生成模型（离线或省调用时用）" }),
          ),
        },
        { additionalProperties: false },
      ),
      risk: "read",
      permissions: ["rag:read"],
      requiresConfirmation: false,
      // handler 内部子进程用 rag.timeoutMs；外层 deadline 要留出余量，否则会被 runtime 提前 abort。
      timeoutMs: rag.timeoutMs + 15_000,
      maxRetries: 0,
      idempotent: true,
      source: "local",
    },
    async handler({ args, signal }) {
      if (!rag.enabled) {
        throw new ToolRuntimeError("RAG_DISABLED", "RAG 服务未启用（config.platform.yaml 的 rag.enabled=false）。");
      }
      const question = text(args, "question");
      const argv = [rag.python, join(rag.dir, "query.py"), "--json", "-q", question];
      const mode = optionalText(args, "mode");
      if (mode) argv.push("--mode", mode);
      const topK = args.top_k === undefined ? rag.defaultTopK : integer(args, "top_k", rag.defaultTopK);
      argv.push("--top-k", String(topK));
      const docType = optionalText(args, "doc_type");
      if (docType) argv.push("--doc-type", docType);
      if (args.no_llm === true) argv.push("--no-llm");

      let result;
      try {
        result = await sandbox.exec({ argv, timeoutMs: rag.timeoutMs, signal });
      } catch (error) {
        throw new ToolRuntimeError(
          "RAG_SPAWN_FAILED",
          `无法启动 RAG 查询子进程（${rag.python} ${join(rag.dir, "query.py")}）：` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
      if (result.timed_out) {
        throw new ToolRuntimeError("RAG_TIMEOUT", `RAG 查询超过 ${rag.timeoutMs}ms 被终止`);
      }

      const stdout = result.stdout.trim();
      let payload: RagPayload;
      try {
        payload = JSON.parse(stdout) as RagPayload;
      } catch {
        const detail = (result.stderr || stdout || "(无输出)").slice(-1_200);
        throw new ToolRuntimeError(
          "RAG_BAD_OUTPUT",
          `query.py 未输出可解析的 JSON（退出码 ${result.exit_code ?? "无"}）。末尾输出：\n${detail}`,
        );
      }

      return formatRag(question, payload, result);
    },
  };
}

/** 把 JSON 结果编排成给模型读的文本：答案在前，引用来源追溯逐条编号对齐。 */
function formatRag(question: string, payload: RagPayload, result: { exit_code: number | null; duration_ms: number }): string {
  const citations = payload.citations ?? [];
  if (payload.error && citations.length === 0) {
    return `RAG 查询「${question}」没有结果：${payload.error}`;
  }

  const header =
    `RAG 查询：${payload.question ?? question}` +
    `（模式 ${payload.mode ?? "?"} · top_k ${payload.top_k ?? "?"} · ${citations.length} 条证据 · ${result.duration_ms}ms）`;

  const answerBlock =
    payload.answer != null
      ? `【回答】\n${payload.answer.trim()}`
      : `【回答】\n（未生成${payload.llm_error ? `：LLM 调用失败 ${payload.llm_error}` : "——只召回证据，未调模型"}）`;

  const citationLines: string[] = [];
  citations.forEach((item, i) => {
    const index = item.index ?? i + 1;
    const heading = item.heading ? ` § ${item.heading}` : "";
    const score = typeof item.score === "number" ? `  (score ${item.score.toFixed(4)})` : "";
    citationLines.push(`[${index}] ${item.file ?? "?"}${heading}${score}`);
    const snippet = (item.snippet ?? "").trim().replace(/\s+/g, " ");
    if (snippet) citationLines.push(`     ${snippet.slice(0, 240)}${snippet.length > 240 ? "…" : ""}`);
  });

  return [
    header,
    "",
    answerBlock,
    "",
    "【引用来源追溯】（编号与回答中的 [n] 一一对应）",
    ...(citationLines.length > 0 ? citationLines : ["（无引用来源）"]),
  ].join("\n");
}
