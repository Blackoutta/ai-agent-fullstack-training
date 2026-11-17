import { Type } from "typebox";
import type { ManagedTool } from "../domain.js";
import type { OkfMemory } from "../memory.js";
import { integer, optionalText, text } from "./args.js";

/**
 * 长期记忆的两件工具。它们和十件仓库工具一样注册进 ToolRegistry、过 PolicyEngine 与 ToolRuntime：
 * 读要 memory:read，写要 memory:write，调用照常落审计、照常受审批门口约束。
 *
 * 与仓库工具的区别只有一个：它们读写的不是 sandbox.root 那个仓库，而是一份独立的 OKF bundle，
 * 所以不经沙箱的仓库路径校验，路径安全由 OkfMemory 自己保证。
 */
export function createMemoryTools(memory: OkfMemory, options: { requireConfirmation: boolean }): ManagedTool[] {
  return [createMemoryRecallTool(memory), createMemoryRememberTool(memory, options.requireConfirmation)];
}

export function createMemoryRecallTool(memory: OkfMemory): ManagedTool {
  return {
    metadata: {
      internalName: "memory_recall",
      description:
        "回读长期记忆（OKF 知识包）。给 id 读某个概念的全文；给 query 按关键词检索；都不给就列出已记住的概念摘要。" +
        "开工前系统提示词里已经有记忆目录，需要细节时再用它取全文。",
      version: "2.0.0",
      parameters: Type.Object(
        {
          id: Type.Optional(Type.String({
            description: "概念 ID，例如 concepts/login-flow。给了它就返回该概念全文；与 query 二选一，同时给以 id 为准",
            minLength: 1,
          })),
          query: Type.Optional(Type.String({
            description: "检索关键词，匹配标题、描述、标签与正文；不给就列出全部概念的摘要",
            minLength: 1,
          })),
          limit: Type.Optional(
            Type.Number({ description: "最多返回多少条摘要，默认 20，上限 100", minimum: 1, maximum: 100 }),
          ),
        },
        { additionalProperties: false },
      ),
      risk: "read",
      permissions: ["memory:read"],
      requiresConfirmation: false,
      timeoutMs: 5_000,
      maxRetries: 2,
      idempotent: true,
      source: "local",
    },
    async handler({ args }) {
      const id = optionalText(args, "id");
      if (id) {
        const concept = memory.read(id);
        return [
          `# ${concept.title}`,
          `概念 ID：${concept.id} · 类型：${concept.type}` +
            (concept.tags.length ? ` · 标签：${concept.tags.join(", ")}` : "") +
            (concept.generatedAt ? ` · 生成于 ${concept.generatedAt}` : ""),
          concept.description ? `描述：${concept.description}` : "",
          "",
          concept.body.trim(),
        ]
          .filter((line) => line !== "")
          .join("\n");
      }
      const limit = integer(args, "limit", 20);
      const query = optionalText(args, "query");
      const hits = memory.search(query, limit);
      const all = memory.list();
      if (all.length === 0) {
        return "长期记忆还是空的。读到值得跨 Run 记住的事实时，用 memory_remember 写一个概念进来。";
      }
      if (hits.length === 0) {
        return `记忆里有 ${all.length} 个概念，但没有命中「${query}」。换个关键词，或者用 memory_recall 不带参数看全量摘要。`;
      }
      return [
        `记忆里有 ${all.length} 个概念，命中 ${hits.length} 个：`,
        ...hits.map((meta) => `- [${meta.id}] ${meta.title} · ${meta.type}${meta.description ? ` · ${meta.description}` : ""}`),
        "读全文：memory_recall id=<概念ID>。",
      ].join("\n");
    },
  };
}

export function createMemoryRememberTool(memory: OkfMemory, requireConfirmation: boolean): ManagedTool {
  return {
    metadata: {
      internalName: "memory_remember",
      description:
        "把一个跨 Run 值得记住的概念写进长期记忆（OKF 知识包），已存在则更新。概念必须有 type 与正文；" +
        "写进去的内容要来自你实际读到的代码，不要凭印象编。",
      version: "2.0.0",
      parameters: Type.Object(
        {
          id: Type.Optional(
            Type.String({
              description: "概念 ID，例如 concepts/login-flow；不给我就从 title 生成。要更新已有概念就传同一个 id",
              minLength: 1,
            }),
          ),
          type: Type.String({
            description: "OKF 概念类型，例如 Code Concept / Architecture / Glossary / Playbook；OKF 只要求它非空",
            minLength: 1,
          }),
          title: Type.String({ description: "概念标题，一句话说清这是什么", minLength: 1 }),
          description: Type.Optional(Type.String({ description: "一句话摘要，进记忆目录用", minLength: 1 })),
          tags: Type.Optional(
            Type.Array(Type.String({ description: "单个标签", minLength: 1 }), {
              description: "标签列表，便于以后检索",
              maxItems: 12,
            }),
          ),
          body: Type.String({
            description: "概念正文（Markdown）。写清：是什么、在哪里（文件与行号级依据）、有什么坑、和谁相关",
            minLength: 1,
          }),
          resource: Type.Optional(Type.String({ description: "可选：这个概念对应的外部 URI 或 bundle 内路径", minLength: 1 })),
          status: Type.Optional(Type.String({ description: "可选生命周期：draft / stable / deprecated", minLength: 1 })),
        },
        { additionalProperties: false },
      ),
      risk: "write",
      permissions: ["memory:write"],
      requiresConfirmation: requireConfirmation,
      timeoutMs: 5_000,
      maxRetries: 0,
      idempotent: false,
      source: "local",
    },
    async handler({ args, context }) {
      const result = memory.remember({
        id: optionalText(args, "id"),
        type: text(args, "type"),
        title: text(args, "title"),
        description: optionalText(args, "description"),
        tags: Array.isArray(args.tags) ? (args.tags as string[]) : undefined,
        body: text(args, "body"),
        resource: optionalText(args, "resource"),
        status: optionalText(args, "status"),
        generatedBy: `${context.agentName}/2.0.0`,
      });
      return (
        `${result.created ? "已记住" : "已更新"}概念 ${result.id}\n` +
        `落盘：${result.path}\n` +
        `index.md 与 log.md 已同步；下一次 Run 开工前会自动回读。`
      );
    },
  };
}
