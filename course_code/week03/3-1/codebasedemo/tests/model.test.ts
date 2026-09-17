// 模型接入层验收：全部为静态验收，不触碰网络。
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StreamFn } from "@earendil-works/pi-agent-core";

import {
  DEFAULT_GATEWAY_BASE_URL,
  GATEWAY_API_KEY_ENV,
  GATEWAY_BASE_URL_ENV,
  GATEWAY_PROVIDER_ID,
  LOGICAL_MODEL_ID,
  gatewayModel,
  models,
  streamGateway,
} from "../src/model.js";

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("模型接入层验收", () => {
  it("pi 能识别并取用注册后的逻辑模型", () => {
    expect(models.getProvider(GATEWAY_PROVIDER_ID)?.id).toBe(GATEWAY_PROVIDER_ID);
    expect(models.getModels(GATEWAY_PROVIDER_ID).map((model) => model.id))
      .toContain(LOGICAL_MODEL_ID);

    const model = models.getModel(GATEWAY_PROVIDER_ID, LOGICAL_MODEL_ID);
    expect(model).toMatchObject({
      id: LOGICAL_MODEL_ID,
      provider: GATEWAY_PROVIDER_ID,
      api: "openai-completions",
      reasoning: false,
      input: ["text"],
      contextWindow: 128_000,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    });
  });

  it("未配置环境变量时地址回落到本地默认值", () => {
    expect(gatewayModel.baseUrl)
      .toBe(process.env[GATEWAY_BASE_URL_ENV] ?? DEFAULT_GATEWAY_BASE_URL);
  });

  it("Gateway 地址可被环境变量覆盖", async () => {
    const overridden = "http://gateway.internal:9999/v1";
    vi.stubEnv(GATEWAY_BASE_URL_ENV, overridden);
    vi.resetModules();

    const reloaded = await import("../src/model.js");

    expect(reloaded.gatewayModel.baseUrl).toBe(overridden);
  });

  it("鉴权密钥只从环境变量读取", async () => {
    const sentinel = "test-gateway-key-from-env";
    vi.stubEnv(GATEWAY_API_KEY_ENV, sentinel);
    vi.resetModules();

    const reloaded = await import("../src/model.js");
    const resolved = await reloaded.models.getAuth(reloaded.gatewayModel);

    expect(resolved?.auth.apiKey).toBe(sentinel);
  });

  it("装配层可注入该模型并取得对应流式入口", () => {
    // 类型注解即编译期证明：streamGateway 满足 pi 的 StreamFn 契约。
    const injectable: StreamFn = streamGateway;
    expect(typeof injectable).toBe("function");
    expect(gatewayModel).toEqual(
      models.getModel(GATEWAY_PROVIDER_ID, LOGICAL_MODEL_ID),
    );
  });

  it("源码中不存在硬编码密钥与供应商模型名", async () => {
    const files = await collectSourceFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const token of VENDOR_MODEL_TOKENS) {
        if (text.toLowerCase().includes(token)) {
          offenders.push(`${path.relative(SRC_ROOT, file)} 含供应商模型名: ${token}`);
        }
      }
      const secret = text.match(SECRET_LITERAL);
      if (secret) {
        offenders.push(`${path.relative(SRC_ROOT, file)} 含硬编码密钥: ${secret[0]}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});

// 供应商模型名（非协议名，故不包含 "openai-completions" 这类 API 标识）。
const VENDOR_MODEL_TOKENS = [
  "gpt-",
  "claude",
  "gemini",
  "deepseek",
  "grok",
  "llama",
  "mistral",
  "qwen",
  "kimi",
  "moonshot",
  "glm-",
];

// 形如 apiKey = "xxxx" / secret: "xxxx" / bearer = "xxxx" 的字面量密钥。
const SECRET_LITERAL = /(api[_-]?key|apikey|secret|access[_-]?token|bearer)\s*[:=]\s*["'][^"']{8,}["']/i;

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts")) {
      files.push(fullPath);
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}
