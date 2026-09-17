// 模型注册，接入 Gateway。
import {
  createModels,
  createProvider,
  envApiKeyAuth,
  type Model,
} from "@earendil-works/pi-ai";
import {
  openAICompletionsApi,
} from "@earendil-works/pi-ai/api/openai-completions.lazy";

export const gatewayModel: Model<"openai-completions"> = {
  id: "agent-default",
  name: "Agent Default",
  provider: "phase-gateway",
  api: "openai-completions",
  baseUrl: process.env.GATEWAY_BASE_URL
    ?? "http://127.0.0.1:8000/v1",
  reasoning: false,
  input: ["text"],
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
  id: "phase-gateway",
  name: "Phase One Gateway",
  baseUrl: gatewayModel.baseUrl,
  auth: {
    apiKey: envApiKeyAuth(
      "Gateway API key",
      ["GATEWAY_API_KEY"],
    ),
  },
  models: [gatewayModel],
  api: openAICompletionsApi(),
});

export const models = createModels();
models.setProvider(provider);