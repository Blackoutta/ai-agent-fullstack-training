import type { ExecutionContext, RegisteredTool } from "./domain.js";

/**
 * 工具契约。分两层，两层的写法不一样，因为受众不一样：
 *
 * 第一层是声明式边界，直接写在每件工具的 TypeBox 参数定义里（minimum、maximum、minLength、minItems）。
 * 模型只看得到这份 schema——它是参数的说明书，也是上游校验器的依据，所以能写在这里的边界一定要写在这里。
 *
 * 第二层是语义规则，住在这个文件里。它们要拦的是"schema 全对、沙箱也放行，但这次调用注定办不成事"的参数：
 * 绝对路径、以 / 开头的 glob、编译不出来的正则、空操作补丁。这类事实 JSON Schema 表达不了，
 * 只能由懂业务的人写成代码，所以它必须集中、可清点、能在启动时自检。
 */

export interface ContractRule {
  /** 审计与回喂都靠它筛：契约层统一 CONTRACT_ 前缀，一眼分得清是契约拦的、策略拦的还是工具自己报的。 */
  code: string;
  /** 这条规则读哪几个字段。启动自检据此抓字段名手误。 */
  fields: string[];
  /** 给人看的一句话：这条规则为什么存在。cli contract 会把它打出来。 */
  why: string;
  violated(args: Record<string, unknown>, context: ExecutionContext): boolean;
  /** 违规时念给模型听的那句：点名哪个字段、给出正确的写法。回喂的质量全看这句话。 */
  message(args: Record<string, unknown>, context: ExecutionContext): string;
}

/** 路径字段必须是相对工作区根目录的形式。 */
function pathMustBeRelative(field: string): ContractRule {
  return {
    code: "CONTRACT_PATH_MUST_BE_RELATIVE",
    fields: [field],
    why: "十件工具的路径一律相对工作区根目录书写：绝对路径会把本机目录结构写进审计与审批指纹，换台机器就对不上。",
    violated: (args) => isAbsoluteInput(args[field]),
    message: (args, context) =>
      `${field} 收到 ${String(args[field])}，这是绝对路径。${field} 要相对工作区根目录` +
      `（${context.workspace ?? "本次未声明"}）书写，请去掉前缀改成相对路径重发，其余字段保持原样。`,
  };
}

/** 读文件的工具不许指目录。 */
function pathMustNotBeDirectory(field: string, alternative: string): ContractRule {
  return {
    code: "CONTRACT_PATH_IS_DIRECTORY",
    fields: [field],
    why: `以 / 结尾的路径是目录，读它只会拿到一句操作系统给的 EISDIR；看目录结构该用 ${alternative}。`,
    violated: (args) => typeof args[field] === "string" && String(args[field]).endsWith("/"),
    message: (args) =>
      `${field}=${String(args[field])} 以 / 结尾，这是目录。看目录内容用 ${alternative}，` +
      `要读文件请把 ${field} 写成具体文件名后重发。`,
  };
}

/** glob 是拿相对路径去匹配的，以 / 开头永远命中不了。 */
function globMustMatchRelativePaths(field: string): ContractRule {
  return {
    code: "CONTRACT_GLOB_NEVER_MATCHES",
    fields: [field],
    why: "pattern 与 glob 是拿“工作区内的相对路径”去比对的，以 / 开头就没有任何文件能命中，白扫一轮。",
    violated: (args) => typeof args[field] === "string" && String(args[field]).startsWith("/"),
    message: (args) =>
      `${field}=${String(args[field])} 以 / 开头，永远匹配不到文件：比对用的是相对路径。` +
      `去掉开头的 / 再发一次，**/*.ts 这类写法才能命中。`,
  };
}

/** literal 为 false 时 pattern 要能编译成正则。 */
function searchPatternMustCompile(): ContractRule {
  return {
    code: "CONTRACT_PATTERN_NOT_REGEX",
    fields: ["pattern", "literal"],
    why: "search_code 默认把 pattern 当正则解释。括号不配对时编译会抛错，与其让工具报错，不如在门口说清两种写法。",
    violated: (args) => {
      if (args.literal === true || typeof args.pattern !== "string") return false;
      return !compiles(args.pattern);
    },
    message: (args) =>
      `pattern=${JSON.stringify(String(args.pattern ?? ""))} 编译不成正则（多半是括号没配对）。` +
      `要么补全正则，要么加 literal: true 按字面量搜。这次调用没有扫任何文件。`,
  };
}

/** 一批 edits 不许全是空操作。 */
function patchMustChangeSomething(): ContractRule {
  return {
    code: "CONTRACT_PATCH_NO_CHANGES",
    fields: ["edits"],
    why: "每段 oldText 都与 newText 相同 = 整批空操作。写文件要走审批，空操作也要占用一次审批额度。",
    violated: (args) => {
      const items = editList(args);
      return items.length > 0 && items.every((item) => item.oldText === item.newText);
    },
    message: () =>
      `这一批 edits 每段的 oldText 与 newText 都相同，落盘后文件不会有任何变化。` +
      `要么给出真正要改的内容，要么这个文件这次就别动。`,
  };
}

/** run_command 的 command 不许只有空白。 */
function commandMustNotBeBlank(): ContractRule {
  return {
    code: "CONTRACT_COMMAND_BLANK",
    fields: ["command"],
    why: "只有空白字符的命令会真的起一个 shell，退出码 0，什么也没做——审批单上却已经花掉一次人工确认。",
    violated: (args) => typeof args.command === "string" && args.command.trim() === "",
    message: () => `command 里只有空白字符，没有可执行的命令。给出要执行的那条命令再发一次。`,
  };
}

const RULES: Record<string, ContractRule[]> = {
  read_file: [pathMustBeRelative("path"), pathMustNotBeDirectory("path", "read_directory")],
  read_directory: [pathMustBeRelative("path")],
  list_files: [pathMustBeRelative("path"), globMustMatchRelativePaths("pattern")],
  search_code: [
    pathMustBeRelative("path"),
    globMustMatchRelativePaths("glob"),
    searchPatternMustCompile(),
  ],
  write_file: [pathMustBeRelative("path"), pathMustNotBeDirectory("path", "read_directory")],
  apply_patch: [pathMustBeRelative("path"), patchMustChangeSomething()],
  run_test: [pathMustBeRelative("test_file")],
  run_command: [commandMustNotBeBlank()],
  git_diff: [pathMustBeRelative("path")],
  git_status: [],
};

/** 所有工具共用的路径类规则由各自的 fields 点名，这里只按工具名取。 */
export function contractRulesFor(internalName: string): ContractRule[] {
  return RULES[internalName] ?? [];
}

/**
 * 语义契约的唯一入口。返回 undefined 表示这次参数在语义上成立；
 * 返回的那条 { code, reason } 既写进审计，也原样回喂给模型。
 */
export function findContractBreach(
  tool: RegisteredTool,
  args: Record<string, unknown>,
  context: ExecutionContext,
): { code: string; reason: string } | undefined {
  for (const rule of contractRulesFor(tool.metadata.internalName)) {
    if (rule.violated(args, context)) return { code: rule.code, reason: rule.message(args, context) };
  }
  return undefined;
}

/**
 * 启动自检。契约写错与规则失效都是"看起来一切正常、真要拦时一句都没拦住"的故障，
 * 所以这里在装配阶段就把它们念出来，而不是等模型跑到第 5 轮才发现。
 */
export function verifyContracts(tools: RegisteredTool[]): string[] {
  return [...verifyToolSchemas(tools), ...verifyContractRules(tools)];
}

/** 参数定义本身的检查：模型看得见的每一栏都要说清边界。 */
export function verifyToolSchemas(tools: RegisteredTool[]): string[] {
  const problems: string[] = [];
  for (const tool of tools) {
    const name = tool.metadata.internalName;
    const schema = tool.metadata.parameters as any;
    const label = (field: string): string => `${name}.${field}`;
    if (!schema || typeof schema !== "object" || schema.type !== "object") {
      problems.push(`${name}: 参数定义不是对象 schema，上游校验器无从校验`);
      continue;
    }
    if (schema.additionalProperties !== false) {
      problems.push(`${name}: 允许多余字段（additionalProperties 未设为 false），模型多塞的键会一路进 handler`);
    }
    for (const [field, raw] of Object.entries<unknown>((schema.properties ?? {}) as Record<string, unknown>)) {
      const rule = raw as any;
      if (!rule?.description) {
        problems.push(`${label(field)}: 没有 description——schema 是模型唯一能看到的说明书`);
      }
      if (field === "limit") {
        if (rule?.minimum === undefined) problems.push(`${label(field)}: 没写下界，0 与负数会直接被上游纠正成空结果`);
        if (rule?.maximum === undefined) problems.push(`${label(field)}: 没写上界，一次调用就能塞满上下文窗口`);
      }
      if (field === "offset" && rule?.minimum === undefined) {
        problems.push(`${label(field)}: 没写下界，0 与负数会被当成"从第 1 行之前开始"`);
      }
    }
  }
  return problems;
}

/** 语义规则一侧的检查：规则指向的工具与字段必须真实存在，否则它就是死代码。 */
export function verifyContractRules(tools: RegisteredTool[]): string[] {
  const problems: string[] = [];
  const byName = new Map(tools.map((tool) => [tool.metadata.internalName, tool]));
  for (const [name, rules] of Object.entries(RULES)) {
    const tool = byName.get(name);
    if (!tool) {
      problems.push(`${name}: 契约规则挂在未注册的工具上，这条规则永远不会生效——要么改工具名，要么删规则`);
      continue;
    }
    const properties = ((tool.metadata.parameters as any).properties ?? {}) as Record<string, unknown>;
    for (const rule of rules) {
      if (!/^CONTRACT_[A-Z_]+$/.test(rule.code)) {
        problems.push(`${name}: 规则码 ${rule.code} 不符合 CONTRACT_ 前缀约定，审计里筛不出来`);
      }
      for (const field of rule.fields) {
        if (!(field in properties)) {
          problems.push(`${name}.${field}: 规则要读的字段不在参数定义里（少了一个字段声明或字段名写错），规则会永远拿到 undefined`);
        }
      }
    }
  }
  for (const tool of tools) {
    if (!RULES[tool.metadata.internalName]) {
      problems.push(`${tool.metadata.internalName}: 没有任何语义规则，确认它是否真的无参数可错`);
    }
  }
  return problems;
}

/**
 * 打印契约：交付前先把"模型能看到什么"摊在桌面上对一遍。
 * cli contract 与讲稿里的契约表都出自这里。
 */
export interface ContractFieldView {
  name: string;
  type: string;
  required: boolean;
  bounds: string;
  description: string;
}

export interface ContractView {
  internal_name: string;
  model_name: string;
  risk: string;
  requires_confirmation: boolean;
  fields: ContractFieldView[];
  semantic_rules: Array<{ code: string; fields: string[]; why: string }>;
}

export function renderContract(tools: RegisteredTool[]): ContractView[] {
  return tools.map((tool) => {
    const schema = tool.metadata.parameters as any;
    const required = new Set<string>((schema.required ?? []) as string[]);
    return {
      internal_name: tool.metadata.internalName,
      model_name: tool.modelName,
      risk: tool.metadata.risk,
      requires_confirmation: tool.metadata.requiresConfirmation,
      fields: Object.entries((schema.properties ?? {}) as Record<string, any>).map(([field, raw]) => ({
        name: field,
        type: String(raw.type ?? "any"),
        required: required.has(field),
        bounds: boundsOf(raw),
        description: String(raw.description ?? ""),
      })),
      semantic_rules: contractRulesFor(tool.metadata.internalName).map((rule) => ({
        code: rule.code,
        fields: rule.fields,
        why: rule.why,
      })),
    };
  });
}

/**
 * 单件工具的契约一句话说明。INVALID_ARGUMENT 的那段回喂文案用它：
 * 上游校验器只说"这个字段不合格"，这一句补上"合格长什么样"。
 */
export function describeContractFor(tool: RegisteredTool): string {
  const fields = renderContract([tool])[0].fields;
  if (fields.length === 0) return `${tool.metadata.internalName} 不接受任何参数`;
  const shape = fields
    .map((field) => `${field.name}${field.required ? "" : "?"}(${field.type}${field.bounds ? `，${field.bounds}` : ""})`)
    .join("、");
  const rules = contractRulesFor(tool.metadata.internalName).map((rule) => rule.code);
  return `契约：${shape}${rules.length ? `；另需满足 ${rules.join("、")}` : ""}`;
}

function boundsOf(raw: any): string {
  const items: string[] = [];
  if (raw?.minimum !== undefined) items.push(`≥ ${raw.minimum}`);
  if (raw?.maximum !== undefined) items.push(`≤ ${raw.maximum}`);
  if (raw?.minLength !== undefined) items.push(`长度 ≥ ${raw.minLength}`);
  if (raw?.minItems !== undefined) items.push(`条数 ≥ ${raw.minItems}`);
  return items.join(" 且 ");
}

function isAbsoluteInput(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("~/");
}

function compiles(pattern: string): boolean {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function editList(args: Record<string, unknown>): Array<{ oldText: string; newText: string }> {
  return Array.isArray(args.edits) ? (args.edits as Array<{ oldText: string; newText: string }>) : [];
}
