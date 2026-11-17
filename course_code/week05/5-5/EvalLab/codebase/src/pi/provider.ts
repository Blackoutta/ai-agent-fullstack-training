import {
  createProvider,
  envApiKeyAuth,
  type Model,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/compat";
import type { PlatformConfig } from "../config.js";

export function createGatewayProvider(config: PlatformConfig) {
  const deepseek = new URL(config.gateway.baseUrl).hostname === "api.deepseek.com";
  const model: Model<"openai-completions"> = {
    id: config.model.id,
    name: config.model.name,
    api: "openai-completions",
    provider: config.model.providerId,
    baseUrl: config.gateway.baseUrl,
    // DeepSeek 专用字段仅发往官方端点，避免污染其他 OpenAI-compatible 策略。
    // 官方模型默认关闭思考，打开需显式设置 pi 的 thinkingLevel / reasoning。
    reasoning: deepseek,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      maxTokensField: "max_tokens",
      ...(deepseek ? {
        requiresReasoningContentOnAssistantMessages: true,
        thinkingFormat: "deepseek" as const,
      } : {}),
      supportsStrictMode: true,
    },
    input: ["text"],
    cost: {
      input: config.model.inputPerMillion,
      output: config.model.outputPerMillion,
      cacheRead: config.model.cacheReadPerMillion,
      cacheWrite: config.model.inputPerMillion,
    },
    contextWindow: config.model.contextWindow,
    maxTokens: config.model.maxTokens,
  };
  return createProvider({
    id: config.model.providerId,
    name: deepseek ? "DeepSeek" : "OpenAI-compatible gateway",
    baseUrl: config.gateway.baseUrl,
    auth: {
      apiKey: envApiKeyAuth("Gateway API key", [config.gateway.apiKeyEnv]),
    },
    models: [model],
    api: openAICompletionsApi(),
  });
}
