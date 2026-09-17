// 模型接入层：把已有 OpenAI-compatible Gateway 注册为 pi 可消费的逻辑模型。
// 边界：本层不含任何 Agent 业务逻辑（无工具、无执行上下文、无循环保护、无用户任务）。
// 职责：声明逻辑模型 + 注册 Gateway Provider + 提供流式入口。
// 供应商选择、路由、重试、思考配置、Token 与成本统计全部由 Gateway 负责。
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import {
  openAICompletionsApi,
} from "@earendil-works/pi-ai/api/openai-completions.lazy";

// Agent 只认这些逻辑标识，不绑定任何供应商模型名。
export const GATEWAY_PROVIDER_ID = "phase-gateway";
export const LOGICAL_MODEL_ID = "agent-default";

// Gateway 地址与密钥的唯一来源是环境变量；密钥没有默认值。
export const GATEWAY_BASE_URL_ENV = "GATEWAY_BASE_URL";
export const GATEWAY_API_KEY_ENV = "GATEWAY_API_KEY";

// 未配置环境变量时回落到本地默认地址（仅地址有默认值，密钥没有）。
export const DEFAULT_GATEWAY_BASE_URL = "http://127.0.0.1:8000/v1";

export function resolveGatewayBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env[GATEWAY_BASE_URL_ENV];
  return configured && configured.length > 0
    ? configured
    : DEFAULT_GATEWAY_BASE_URL;
}

// 一个逻辑模型定义：文本输入、关闭 Agent 侧推理、显式上下文窗口与最大输出。
export const gatewayModel: Model<"openai-completions"> = {
  id: LOGICAL_MODEL_ID,
  name: "Agent Default",
  api: "openai-completions",
  provider: GATEWAY_PROVIDER_ID,
  baseUrl: resolveGatewayBaseUrl(),
  reasoning: false,
  input: ["text"],
  // 成本统计由 Gateway 负责；此处成本字段为满足类型要求的零值占位。
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  contextWindow: 128_000,
  maxTokens: 4096,
};

const provider = createProvider({
  id: GATEWAY_PROVIDER_ID,
  name: "Gateway",
  baseUrl: gatewayModel.baseUrl,
  auth: {
    // 鉴权只从环境变量读取，不保存、不硬编码、不写默认密钥。
    apiKey: envApiKeyAuth("Gateway API key", [GATEWAY_API_KEY_ENV]),
  },
  models: [gatewayModel],
  // OpenAI-compatible 流式能力由 pi 的 API 适配提供，本层不重复实现 Provider 重试。
  api: openAICompletionsApi(),
});

// 先完成 Provider 注册，再对外暴露模型集合。
const registry = createModels();
registry.setProvider(provider);

// 已注册 Provider 的模型集合（只读视图，注册后对外暴露）。
export const models: Models = registry;

// 可供 pi 调用的流式入口：装配层注入 { model: gatewayModel, streamFn: streamGateway }。
export const streamGateway: StreamFn = models.streamSimple.bind(models);
