import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import { generateUnifiedPatch } from "@earendil-works/pi-coding-agent";
import type { ManagedTool } from "../domain.js";
import { ToolRuntimeError } from "../domain.js";
import type { Sandbox } from "../sandbox.js";
import { edits, text } from "./args.js";
import { clipHead } from "./clip.js";

export function createWriteFileTool(sandbox: Sandbox): ManagedTool {
  return {
    metadata: {
      internalName: "write_file",
      description: "整文件写入，创建新文件时用它。改已有文件优先用 apply_patch：整文件重写会丢掉你没看到的内容。",
      version: "2.0.0",
      parameters: Type.Object(
        {
          path: Type.String({ description: "目标文件路径，相对工作区根目录，例如 docs/tech-debt-audit.md", minLength: 1 }),
          content: Type.String({ description: "完整文件内容；空串会把目标文件清成 0 字节" }),
        },
        { additionalProperties: false },
      ),
      risk: "write",
      permissions: ["repo:write"],
      requiresConfirmation: true,
      timeoutMs: 5_000,
      maxRetries: 0,
      idempotent: true,
      source: "local",
    },
    async handler({ args }) {
      const absolutePath = sandbox.check(text(args, "path"), { write: true });
      const content = text(args, "content");
      const existed = await exists(absolutePath);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, "utf8");
      const rel = sandbox.relativeOf(absolutePath);
      const bytes = Buffer.byteLength(content, "utf8");
      return existed ? `已覆盖 ${rel}（${bytes} 字节）` : `已创建 ${rel}（${bytes} 字节）`;
    },
  };
}

export function createApplyPatchTool(sandbox: Sandbox): ManagedTool {
  return {
    metadata: {
      internalName: "apply_patch",
      description:
        "对已有文件做精确文本替换。oldText 必须在当前文件里唯一出现，0 次或多次都会整批拒绝；一批 edits 要么全生效要么全不生效。",
      version: "2.0.0",
      parameters: Type.Object(
        {
          path: Type.String({
            description: "目标文件路径，相对工作区根目录；这个文件必须已经存在，建新文件用 write_file",
            minLength: 1,
          }),
          edits: Type.Array(
            Type.Object(
              {
                oldText: Type.String({ description: "要被替换掉的原文，需与文件内容逐字一致", minLength: 1 }),
                newText: Type.String({ description: "替换后的文本" }),
              },
              { additionalProperties: false },
            ),
            { description: "按顺序应用的替换列表，至少一段；每段要么全生效要么全不生效", minItems: 1 },
          ),
        },
        { additionalProperties: false },
      ),
      risk: "write",
      permissions: ["repo:write"],
      requiresConfirmation: true,
      timeoutMs: 5_000,
      maxRetries: 0,
      idempotent: false,
      source: "local",
    },
    async handler({ args }) {
      const absolutePath = sandbox.check(text(args, "path"), { write: true });
      const original = await readFile(absolutePath, "utf8");
      const incoming = edits(args, "edits");
      if (incoming.length === 0) throw new ToolRuntimeError("EMPTY_PATCH", "edits 不能为空数组");

      let next = original;
      incoming.forEach((edit, index) => {
        const occurrences = countOccurrences(next, edit.oldText);
        if (occurrences === 0) {
          throw new ToolRuntimeError("PATCH_CONTEXT_NOT_FOUND", `第 ${index + 1} 段的 oldText 在文件里找不到，整批未写入`);
        }
        if (occurrences > 1) {
          throw new ToolRuntimeError("PATCH_AMBIGUOUS", `第 ${index + 1} 段的 oldText 命中 ${occurrences} 次，需要更多上下文，整批未写入`);
        }
        // 用下标拼接而不是 String.replace：newText 里的 $& / $1 会被 replace 当成引用展开。
        const at = next.indexOf(edit.oldText);
        next = `${next.slice(0, at)}${edit.newText}${next.slice(at + edit.oldText.length)}`;
      });

      await writeFile(absolutePath, next, "utf8");
      const rel = sandbox.relativeOf(absolutePath);
      const delta = Buffer.byteLength(next, "utf8") - Buffer.byteLength(original, "utf8");
      const patch = clipHead(generateUnifiedPatch(rel, original, next, 3), sandbox.rules.maxOutputChars);
      return [
        `已应用 ${incoming.length} 段替换 ${rel}（变化 ${delta >= 0 ? "+" : ""}${delta} 字节）`,
        patch.text.trimEnd(),
        patch.truncated ? `[差异超过 ${sandbox.rules.maxOutputChars} 字符，已截断，看全文用 git_diff]` : "",
      ]
        .filter(Boolean)
        .join("\n");
    },
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath);
    return true;
  } catch {
    return false;
  }
}
