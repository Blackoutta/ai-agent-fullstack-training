import { readFileSync } from "node:fs";
import { basename } from "node:path";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  type JsonObject,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parse } from "yaml";
import type { PlatformConfig } from "../config.js";
import { createGatewayProvider } from "./provider.js";

export const SCRIPTED_PROVIDER = "managed-script";
export const SCRIPTED_MODEL_ID = "decider";
/** pi 的 provider 分发只认内置 API 名；脚本决策器借这个名字挂号，实现走我们自己的 streamSimple。 */
export const SCRIPTED_API = "openai-completions";

export interface ScriptedToolCall {
  name: string;
  args?: JsonObject;
}

export interface ScriptedStep {
  text?: string;
  tool_calls?: ScriptedToolCall[];
}

export function loadDeciderScript(path: string): ScriptedStep[] {
  const raw = parse(readFileSync(path, "utf8")) as { steps?: ScriptedStep[] };
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new Error(`决策脚本里没有非空的 steps: ${path}`);
  }
  return raw.steps;
}

/**
 * 决策器只有一个出口 createDecider：给了脚本就用脚本假模型，没给就连阶段本网关。
 * 两条路都返回 { kind, models, model, registerTo }：
 * 自己跑 Loop 用 models.streamSimple，交给 pi 的扩展点调 registerTo(pi)。
 */
export function createDecider(config: PlatformConfig, script?: ScriptedStep[]) {
  const models = createModels();
  const cost = {
    input: config.model.inputPerMillion,
    output: config.model.outputPerMillion,
    cacheRead: config.model.cacheReadPerMillion,
    cacheWrite: config.model.inputPerMillion,
  };
  if (!script) {
    const provider = createGatewayProvider(config);
    models.setProvider(provider);
    const model = models.getModel(config.model.providerId, config.model.id);
    if (!model) throw new Error(`Gateway model not found: ${config.model.id}`);
    return { kind: "gateway" as const, models, model, registerTo: (pi: ExtensionAPI) => pi.registerProvider(provider) };
  }

  const faux = fauxProvider({
    provider: SCRIPTED_PROVIDER,
    // pi 只认内置 API 名做分发，脚本决策器借 openai-completions 这个名字挂号，
    // 真正的实现由下面 registerProvider 里的 streamSimple 提供。
    api: SCRIPTED_API,
    models: [
      {
        id: SCRIPTED_MODEL_ID,
        name: "离线脚本决策器",
        reasoning: false,
        input: ["text"],
        cost,
        contextWindow: config.model.contextWindow,
        maxTokens: config.model.maxTokens,
      },
    ],
  });
  faux.setResponses(script.map(toAssistantMessage));
  models.setProvider(faux.provider);
  const model = models.getModel(SCRIPTED_PROVIDER, SCRIPTED_MODEL_ID);
  if (!model) throw new Error("Scripted decider model not found");
  return {
    kind: "scripted" as const,
    models,
    model,
    registerTo: (pi: ExtensionAPI) =>
      pi.registerProvider(SCRIPTED_PROVIDER, {
        name: "离线脚本决策器",
        // 脚本决策器不发网络请求：baseUrl 与 apiKey 只是把 pi 的鉴权检查走通，
        // 真正的响应由 streamSimple 从脚本队列里取。
        baseUrl: "http://127.0.0.1:1",
        apiKey: "managed-script-offline",
        api: SCRIPTED_API,
        models: [
          {
            id: SCRIPTED_MODEL_ID,
            name: "离线脚本决策器",
            reasoning: false,
            input: ["text"],
            cost,
            contextWindow: config.model.contextWindow,
            maxTokens: config.model.maxTokens,
          },
        ],
        streamSimple: (requested, context, options) => faux.provider.streamSimple(requested, context, options),
      }),
  };
}

export type Decider = ReturnType<typeof createDecider>;

/** 决策器口径：auto=有离线脚本就用它，没有才连网关；mock=只准离线；real=只准真模型。 */
export type DeciderRequest = "auto" | "mock" | "real";

export interface DeciderSelection {
  requested: DeciderRequest;
  kind: Decider["kind"];
  /** 人话说明这一趟是谁在决策、为什么。开头打印一行，同时进 trace。 */
  reason: string;
  /** 用的哪份离线脚本；连网关时为 null。 */
  script: string | null;
  modelId: string;
  /** 要的是真模型、拿到的却是离线脚本：这一位为 true 时必须在输出里说破，不许静默换脑袋。 */
  degraded: boolean;
}

export interface SelectDeciderOptions {
  requested?: DeciderRequest;
  /** 调用方点名的脚本路径，优先于任务条目里的 script。 */
  scriptPath?: string;
  /** 已经在内存里的脚本步骤（单测用），给了它就不再读文件。 */
  inlineScript?: ScriptedStep[];
  /** 测试与 CI 在这里注入，避免为了跑断言去改真实环境变量。 */
  hasApiKey?: boolean;
}

/** 一份离线脚本的来源：要么是指名的文件，要么是内存里的步骤。 */
interface OfflineSource {
  scriptPath?: string;
  inlineSteps?: ScriptedStep[];
}

/**
 * 选决策器只有一个入口。两条入口（CLI 与 pi 扩展点）都调它，所以"降级"这件事
 * 不可能在一边做了另一边忘了；抛错也在这里统一抛——宁可不开跑，也不让 pi 用自己的模型顶上。
 */
export function selectDecider(
  config: PlatformConfig,
  options: SelectDeciderOptions = {},
): { decider: Decider; selection: DeciderSelection } {
  const requested = options.requested ?? "auto";
  // 命令行传进来的是字符串，类型在这儿拦不住：口径写错就直接失败，别让它悄悄走 auto 那条路。
  if (requested !== "auto" && requested !== "mock" && requested !== "real") {
    throw new Error(`DECIDER_MODE: 口径只能是 auto / mock / real，收到 ${String(requested)}`);
  }
  const apiKeyEnv = config.gateway.apiKeyEnv;
  const hasApiKey = options.hasApiKey ?? Boolean(process.env[apiKeyEnv]);
  const gatewayModel = `${config.model.providerId}/${config.model.id}`;
  const scriptedModel = `${SCRIPTED_PROVIDER}/${SCRIPTED_MODEL_ID}`;
  // 这一趟真正拿来决策的那份脚本，来自哪个来源就在账上写谁的名字。
  const callerScript = { scriptPath: options.scriptPath ?? config.task?.script, inlineSteps: options.inlineScript };

  const offlineName = (source: OfflineSource) =>
    source.inlineSteps ? "(内联步骤)" : source.scriptPath ? basename(source.scriptPath) : "(没有可用脚本)";
  const buildOffline = (reason: string, degraded: boolean, source: OfflineSource = callerScript) => {
    const steps = source.inlineSteps ?? (source.scriptPath ? loadDeciderScript(source.scriptPath) : undefined);
    if (!steps) throw new Error(`SCRIPT_REQUIRED: ${reason}`);
    const decider = createDecider(config, steps);
    return {
      decider,
      selection: {
        requested,
        kind: "scripted" as const,
        reason,
        // 记账只留文件名：整条绝对路径又长又每台机器不同，转录里没法逐字对。
        script: offlineName(source),
        modelId: scriptedModel,
        degraded,
      },
    };
  };

  const buildGateway = () => {
    const decider = createDecider(config, undefined);
    return {
      decider,
      selection: {
        requested,
        kind: "gateway" as const,
        reason: `${apiKeyEnv} 已设置，连接 ${config.gateway.baseUrl}`,
        script: null,
        modelId: gatewayModel,
        degraded: false,
      },
    };
  };

  if (requested === "real") {
    if (hasApiKey) return buildGateway();
    // real 不许拿调用方点名的脚本凑数，唯一认可的退路是任务条目里那份——那本来就是这类任务的干活顺序。
    if (config.task?.script) {
      return buildOffline(
        `${apiKeyEnv} 未设置，降级为离线脚本决策器（${basename(config.task.script)}）`,
        true,
        { scriptPath: config.task.script },
      );
    }
    throw new Error(`MODEL_UNAVAILABLE: ${apiKeyEnv} 未设置，而任务 ${config.task?.id ?? "(未领任务)"} 也没有配离线脚本可以降级`);
  }

  if (requested === "mock") {
    return buildOffline(`离线脚本决策器（${offlineName(callerScript)}）`, false);
  }

  if (callerScript.scriptPath || callerScript.inlineSteps) {
    return buildOffline(`离线脚本决策器（${offlineName(callerScript)}）`, false);
  }
  if (hasApiKey) return buildGateway();
  throw new Error(
    `MODEL_UNAVAILABLE: ${apiKeyEnv} 未设置，且这次运行没有可用的离线脚本。` +
      `加 --script <yaml>、在任务条目里配 script，或设置 ${apiKeyEnv} 连网关。`,
  );
}

/** 每步打印的那一句：一眼看出这一步是谁在主事，换了脑袋要说得出来。 */
export function deciderLabel(selection: DeciderSelection): string {
  return selection.kind === "gateway" ? `real:${selection.modelId}` : `mock:${selection.script ?? "inline"}`;
}

function toAssistantMessage(step: ScriptedStep) {
  const parts = [
    ...(step.text ? [fauxText(step.text)] : []),
    ...(step.tool_calls ?? []).map((call) => fauxToolCall(call.name, call.args ?? {})),
  ];
  if (parts.length === 0) throw new Error("脚本的每一步至少要有文本或一次工具调用");
  return fauxAssistantMessage(parts);
}
