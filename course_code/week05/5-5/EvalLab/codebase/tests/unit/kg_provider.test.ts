import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/config.js";

vi.mock("@earendil-works/pi-ai", () => ({
  createProvider: (options: unknown) => options,
  envApiKeyAuth: (_label: string, names: string[]) => names,
}));
vi.mock("@earendil-works/pi-ai/compat", () => ({ openAICompletionsApi: () => "compat" }));

import { createGatewayProvider } from "../../src/pi/provider.js";

describe("模型供应商兼容配置", () => {
  it.each([
    ["https://api.deepseek.com", true],
    ["https://api.openai.com/v1", false],
    ["https://api.deepseek.com.example.org/v1", false],
    ["http://127.0.0.1:8080/v1", false],
  ])("仅官方 DeepSeek 端点使用专属字段: %s", (url, deepseek) => {
    const config = loadConfig();
    config.gateway.baseUrl = url;
    const provider = createGatewayProvider(config) as unknown as {
      models: { reasoning: boolean; compat: Record<string, unknown> }[];
    };
    expect(provider.models[0].reasoning).toBe(deepseek);
    expect(provider.models[0].compat.thinkingFormat).toBe(deepseek ? "deepseek" : undefined);
    expect(provider.models[0].compat.requiresReasoningContentOnAssistantMessages)
      .toBe(deepseek ? true : undefined);
  });
});
