import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { MemoryConfig } from "./config.js";
import { ToolRuntimeError } from "./domain.js";

/** OKF 的两个保留文件名：任何一层出现它们都不是概念文档。 */
const RESERVED = new Set(["index.md", "log.md"]);
/** 只看目录名字，跳过依赖与构建产物——它们不是人写下的知识。 */
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", "coverage"]);

export interface MemoryConceptMeta {
  /** 概念 ID = bundle 内相对路径去掉 .md，例如 concepts/login-flow。 */
  id: string;
  type: string;
  title: string;
  description: string;
  tags: string[];
  generatedAt?: string;
  /** 概念文件在磁盘上的绝对路径。 */
  path: string;
}

export interface MemoryConcept extends MemoryConceptMeta {
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface RememberInput {
  /** 概念 ID，例如 concepts/login-flow；不给我就从 title 生成一个。 */
  id?: string;
  type: string;
  title: string;
  description?: string;
  tags?: string[];
  resource?: string;
  status?: string;
  body: string;
  sources?: unknown[];
  /** OKF actor 约定，例如 codebase-agent/2.0.0。 */
  generatedBy: string;
  /** 不给我就用当前时间。 */
  at?: string;
}

export interface MemoryDigest {
  concepts: number;
  chars: number;
  text: string;
}

export interface MemoryValidation {
  ok: boolean;
  concepts: number;
  errors: string[];
  warnings: string[];
}

/**
 * OKF v0.2 长期记忆。bundle 是一份独立于仓库工作区的目录：
 * 概念是带 YAML frontmatter 的 Markdown，根目录维护 index.md（渐进披露）与 log.md（变更历史）。
 *
 * 模块只做三件事：读、写、校验。它不碰模型、不碰审批——那两件事分别属于提示词与 ToolRuntime。
 */
export class OkfMemory {
  readonly bundle: string;

  constructor(private readonly config: MemoryConfig) {
    this.bundle = resolve(config.bundle);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** 列出全部概念。bundle 不存在或没开记忆时返回空数组，绝不因为“还没记忆”而报错。 */
  list(): MemoryConceptMeta[] {
    if (!this.config.enabled || !existsSync(this.bundle)) return [];
    return this.walk()
      .map((path) => this.metaOf(path))
      .filter((meta): meta is MemoryConceptMeta => meta !== undefined)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /**
   * 检索：标题命中权重最高，其次描述/标签，最后正文。query 为空时等价于列出全部。
   * 只返回摘要，正文交给 read(id)。
   */
  search(query: string | undefined, limit = 20): MemoryConceptMeta[] {
    const all = this.list();
    const needle = (query ?? "").trim().toLowerCase();
    if (needle === "") return all.slice(0, limit);
    const scored: Array<{ meta: MemoryConceptMeta; score: number }> = [];
    for (const meta of all) {
      let score = 0;
      if (meta.title.toLowerCase().includes(needle)) score += 3;
      if (meta.description.toLowerCase().includes(needle)) score += 2;
      if (meta.tags.some((tag) => tag.toLowerCase().includes(needle))) score += 2;
      if (meta.type.toLowerCase().includes(needle)) score += 1;
      if (score === 0 && this.read(meta.id).body.toLowerCase().includes(needle)) score = 1;
      if (score > 0) scored.push({ meta, score });
    }
    return scored
      .sort((left, right) => right.score - left.score || left.meta.id.localeCompare(right.meta.id))
      .slice(0, limit)
      .map((item) => item.meta);
  }

  /** 按概念 ID 读全文。 */
  read(id: string): MemoryConcept {
    const path = this.absoluteOf(id);
    if (!existsSync(path)) {
      throw new ToolRuntimeError("MEMORY_NOT_FOUND", `记忆里没有概念 ${id}；先用 memory_recall 看有哪些概念`);
    }
    const raw = readFileSync(path, "utf8");
    const parsed = parseFrontmatter(raw);
    if (parsed.error) throw new ToolRuntimeError("MEMORY_CORRUPT", `${id} 的 frontmatter 解析失败：${parsed.error}`);
    const frontmatter = parsed.frontmatter ?? {};
    return {
      id: normalizeId(id),
      path,
      type: typeof frontmatter.type === "string" ? frontmatter.type : "",
      title: typeof frontmatter.title === "string" ? frontmatter.title : normalizeId(id),
      description: typeof frontmatter.description === "string" ? frontmatter.description : "",
      tags: toStringList(frontmatter.tags),
      generatedAt: actorAt(frontmatter.generated),
      body: parsed.body,
      frontmatter,
    };
  }

  /** 写入或更新一个概念，并同步 index.md 与 log.md。 */
  remember(input: RememberInput): { id: string; path: string; created: boolean } {
    this.assertEnabled();
    if (!input.type || input.type.trim() === "") {
      throw new ToolRuntimeError("MEMORY_INVALID", "OKF 概念必须有非空的 type");
    }
    if (!input.title || input.title.trim() === "") {
      throw new ToolRuntimeError("MEMORY_INVALID", "概念需要有 title");
    }
    if (!input.body || input.body.trim() === "") {
      throw new ToolRuntimeError("MEMORY_INVALID", "概念正文不能为空；没有内容的记忆不是记忆");
    }

    const id = normalizeId(input.id && input.id.trim() !== "" ? input.id : `concepts/${slugify(input.title)}`);
    const path = this.absoluteOf(id);
    const created = !existsSync(path);
    const frontmatter: Record<string, unknown> = {
      type: input.type.trim(),
      title: input.title.trim(),
    };
    if (input.description?.trim()) frontmatter.description = input.description.trim();
    if (input.tags?.length) frontmatter.tags = input.tags.map((tag) => tag.trim()).filter(Boolean);
    if (input.resource?.trim()) frontmatter.resource = input.resource.trim();
    if (input.status?.trim()) frontmatter.status = input.status.trim();
    if (input.sources?.length) frontmatter.sources = input.sources;
    frontmatter.generated = { by: input.generatedBy, at: input.at ?? new Date().toISOString() };

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderConcept(frontmatter, input.body), "utf8");
    this.rebuildIndex();
    this.appendLog(created ? "Creation" : "Update", id, String(frontmatter.title), String(frontmatter.type));
    return { id, path, created };
  }

  /**
   * 开跑前注入系统提示词的那段摘要：只放「标题 + 概念 ID + 一句描述」。
   * 全文不进提示词——那会把 token 预算烧在模型这趟根本用不上的概念上。
   */
  digest(limit = this.config.recallLimit, maxChars = this.config.recallChars): MemoryDigest {
    if (!this.config.enabled) return { concepts: 0, chars: 0, text: "" };
    const all = this.list();
    if (all.length === 0) return { concepts: 0, chars: 0, text: "" };
    const shown = all.slice(0, Math.max(limit, 0));
    const lines = shown.map((meta) => {
      const description = meta.description ? ` · ${meta.description}` : "";
      return `- [${meta.title}](/${meta.id}.md) · ${meta.type}${description}`;
    });
    const header = `已记住 ${all.length} 个概念${shown.length < all.length ? `（下面是前 ${shown.length} 个）` : ""}：`;
    const footer = "用 memory_recall id=<概念ID> 读全文；发现新事实用 memory_remember 写回来。";
    let text = `${header}\n${lines.join("\n")}\n${footer}`;
    if (text.length > maxChars) text = `${text.slice(0, Math.max(maxChars - 24, 0))}\n…（记忆摘要超过字符上限，已截断）`;
    return { concepts: shown.length, chars: text.length, text };
  }

  /** 最小自检：OKF 的硬规则（type 非空、根 index 声明版本、log 有日期分组）。 */
  validate(): MemoryValidation {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!this.config.enabled) return { ok: true, concepts: 0, errors, warnings };
    if (!existsSync(this.bundle)) {
      return { ok: true, concepts: 0, errors, warnings: ["记忆 bundle 尚未创建"] };
    }
    const index = join(this.bundle, "index.md");
    if (!existsSync(index)) errors.push("缺少 bundle 根 index.md");
    else {
      const parsed = parseFrontmatter(readFileSync(index, "utf8"));
      const version = parsed.frontmatter?.okf_version;
      if (!parsed.frontmatter || typeof version !== "string" || version.trim() === "") {
        errors.push("index.md 必须声明非空的 okf_version");
      }
    }
    const logPath = join(this.bundle, "log.md");
    if (!existsSync(logPath)) errors.push("缺少 log.md");
    else if (!/^##\s+\d{4}-\d{2}-\d{2}\s*$/m.test(readFileSync(logPath, "utf8"))) {
      errors.push("log.md 至少需要一个 ## YYYY-MM-DD 日期分组");
    }

    const concepts = this.list();
    for (const meta of concepts) {
      if (!meta.type) errors.push(`${meta.id}: 概念缺少非空的 type`);
      if (!meta.title) warnings.push(`${meta.id}: 建议补上 title`);
      if (!meta.description) warnings.push(`${meta.id}: 建议补上 description`);
    }
    return { ok: errors.length === 0, concepts: concepts.length, errors, warnings };
  }

  /** 重建根索引：按 type 分组，条目用 bundle 相对链接。 */
  private rebuildIndex(): void {
    const concepts = this.list();
    const groups = new Map<string, MemoryConceptMeta[]>();
    for (const meta of concepts) {
      const group = groups.get(meta.type) ?? [];
      group.push(meta);
      groups.set(meta.type, group);
    }
    const sections = [...groups.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([type, items]) => {
        const rows = items
          .sort((left, right) => left.id.localeCompare(right.id))
          .map((meta) => `* [${meta.title}](/${meta.id}.md)${meta.description ? ` - ${meta.description}` : ""}`);
        return `# ${type}\n\n${rows.join("\n")}`;
      });
    const body = [
      "# 代码库知识包",
      "",
      "由 codebase-agent 跨 Run 累积维护的 OKF v0.2 记忆。",
      "",
      ...sections,
    ].join("\n");
    writeFileSync(join(this.bundle, "index.md"), `---\nokf_version: "0.2"\n---\n\n${body}\n`, "utf8");
  }

  /** 往 log.md 追加一条，日期分组新在前；同一天就并进最上面那一组。 */
  private appendLog(action: string, id: string, title: string, type: string): void {
    const path = join(this.bundle, "log.md");
    const today = new Date().toISOString().slice(0, 10);
    const entry = `* **${action}**: [${title}](/${id}.md)（${type}）`;
    const existing = existsSync(path) ? readFileSync(path, "utf8") : "# 更新日志\n";
    const lines = existing.split("\n");
    const titleIndex = lines.findIndex((line) => /^#\s+\S+/.test(line));
    const head = titleIndex === -1 ? ["# 更新日志"] : lines.slice(0, titleIndex + 1);
    const rest = titleIndex === -1 ? [] : lines.slice(titleIndex + 1);
    const firstGroup = rest.findIndex((line) => /^##\s+/.test(line));
    let next: string[];
    if (firstGroup !== -1 && rest[firstGroup].trim() === `## ${today}`) {
      next = [...head, rest[firstGroup], "", entry, ...rest.slice(firstGroup + 1)];
    } else {
      next = [...head, "", `## ${today}`, "", entry, ...rest];
    }
    writeFileSync(path, `${next.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`, "utf8");
  }

  /** 概念 ID → bundle 内的绝对路径，顺带挡下目录穿越。 */
  private absoluteOf(id: string): string {
    const normalized = normalizeId(id);
    if (normalized === "" || normalized.startsWith("../") || normalized.includes("/../")) {
      throw new ToolRuntimeError("MEMORY_PATH_ESCAPE", `概念 ID ${id} 试图跳出记忆 bundle`);
    }
    const candidate = resolve(this.bundle, `${normalized}.md`);
    const rel = relative(this.bundle, candidate);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new ToolRuntimeError("MEMORY_PATH_ESCAPE", `概念 ID ${id} 解析到记忆 bundle 之外`);
    }
    return candidate;
  }

  private assertEnabled(): void {
    if (!this.config.enabled) {
      throw new ToolRuntimeError("MEMORY_DISABLED", "长期记忆未启用：在 config/platform.yaml 的 memory.enabled 打开它");
    }
  }

  private walk(): string[] {
    const files: string[] = [];
    const visit = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) visit(join(directory, entry.name));
          continue;
        }
        if (!entry.isFile() || !entry.name.endsWith(".md") || RESERVED.has(entry.name)) continue;
        files.push(join(directory, entry.name));
      }
    };
    visit(this.bundle);
    return files;
  }

  private metaOf(path: string): MemoryConceptMeta | undefined {
    try {
      if (!statSync(path).isFile()) return undefined;
      const parsed = parseFrontmatter(readFileSync(path, "utf8"));
      if (parsed.error) return undefined;
      const frontmatter = parsed.frontmatter ?? {};
      const id = relative(this.bundle, path).split("\\").join("/").replace(/\.md$/, "");
      return {
        id,
        type: typeof frontmatter.type === "string" ? frontmatter.type : "",
        title: typeof frontmatter.title === "string" ? frontmatter.title : id,
        description: typeof frontmatter.description === "string" ? frontmatter.description : "",
        tags: toStringList(frontmatter.tags),
        generatedAt: actorAt(frontmatter.generated),
        path,
      };
    } catch {
      return undefined;
    }
  }
}

/** 概念 ID 归一化：去掉前导 / 与末尾 .md，统一用 / 分隔。 */
export function normalizeId(id: string): string {
  return id.trim().replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.md$/i, "");
}

export function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown> | null;
  body: string;
  error?: string;
} {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { frontmatter: null, body: raw };
  const closing = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closing === -1) return { frontmatter: null, body: "", error: "frontmatter 块没有闭合的 ---" };
  try {
    const parsed = parseYaml(lines.slice(1, closing).join("\n"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { frontmatter: null, body: lines.slice(closing + 1).join("\n"), error: "frontmatter 必须是 YAML 映射" };
    }
    return { frontmatter: parsed as Record<string, unknown>, body: lines.slice(closing + 1).join("\n").replace(/^\s*\n/, "") };
  } catch (error) {
    return {
      frontmatter: null,
      body: lines.slice(closing + 1).join("\n"),
      error: error instanceof Error ? error.message : "YAML 解析失败",
    };
  }
}

function renderConcept(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(frontmatter).trimEnd()}\n---\n\n${body.trim()}\n`;
}

function toStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function actorAt(value: unknown): string | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const at = (value as Record<string, unknown>).at;
    if (typeof at === "string") return at;
  }
  return undefined;
}

function slugify(input: string): string {
  const ascii = input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (ascii) return ascii;
  return `concept-${createHash("sha1").update(input).digest("hex").slice(0, 8)}`;
}
