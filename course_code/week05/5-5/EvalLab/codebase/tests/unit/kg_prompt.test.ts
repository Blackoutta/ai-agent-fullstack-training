import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stringify, parse } from "yaml";
import { renderSystemPrompt } from "../../src/pi/prompt-client.js";
import { createWorkspaceHarness } from "./helpers/workspace.js";

describe("本地提示词渲染", () => {
  it("生产配置默认走 local，且渲染出的提示词带真实租户与用户", async () => {
    const harness = createWorkspaceHarness();
    expect(harness.config.prompt.source).toBe("local");

    const bundle = await renderSystemPrompt(harness.config, harness.context());
    expect(bundle.source).toBe("local");
    expect(bundle.version).toBe("v1");
    expect(bundle.prompt).toContain("你是 codebase-agent，代表 trainer-1 在租户 tenant_a");
    expect(bundle.prompt).toContain("run_command 需要人工审批");
  });

  it("contentHash 就是渲染结果的 sha256：提示词被内容寻址，可复现可比对", async () => {
    const harness = createWorkspaceHarness();
    const bundle = await renderSystemPrompt(harness.config, harness.context());
    expect(bundle.contentHash).toBe(createHash("sha256").update(bundle.prompt, "utf8").digest("hex"));

    const again = await renderSystemPrompt(harness.config, harness.context());
    expect(again.contentHash).toBe(bundle.contentHash);

    const otherTenant = await renderSystemPrompt(harness.config, harness.context({ tenantId: "tenant_b" }));
    expect(otherTenant.contentHash).not.toBe(bundle.contentHash);
  });

  it("变量用 {{ name }} 占位，未声明的变量原样留着，不静默变空串", async () => {
    const harness = createWorkspaceHarness();
    writePrompts(harness, {
      prompts: {
        "codebase.agent": {
          versions: {
            v1: { template: "租户={{tenant_id}} 空格={{ tenant_id }} 未知={{ repo_name }}\n" },
          },
        },
      },
    });
    const bundle = await renderSystemPrompt(harness.config, harness.context());
    expect(bundle.prompt).toBe("租户=tenant_a 空格=tenant_a 未知={{ repo_name }}\n");
  });

  it("required_variables 缺一个就报错，而不是带着空洞的提示词开跑", async () => {
    const harness = createWorkspaceHarness();
    writePrompts(harness, {
      prompts: {
        "codebase.agent": {
          versions: {
            v9: { required_variables: ["tenant_id"], template: "租户 {{ tenant_id }}\n" },
          },
        },
      },
    });
    harness.config.gateway.promptVersion = "v9";

    await expect(renderSystemPrompt(harness.config, harness.context({ tenantId: "" }))).rejects.toThrow(
      "提示词缺少必需变量: tenant_id",
    );
    const ok = await renderSystemPrompt(harness.config, harness.context());
    expect(ok.prompt).toBe("租户 tenant_a\n");
  });

  it("点名不存在的提示词或版本时，错误里写清楚缺的是哪一个", async () => {
    const harness = createWorkspaceHarness();
    harness.config.gateway.promptName = "no.such.prompt";
    await expect(renderSystemPrompt(harness.config, harness.context())).rejects.toThrow(
      "prompts.yaml 里没有 no.such.prompt",
    );

    writePrompts(harness, { prompts: { "codebase.agent": { versions: { v1: { template: "x\n" } } } } });
    harness.config.gateway.promptName = "codebase.agent";
    harness.config.gateway.promptVersion = "v2";
    await expect(renderSystemPrompt(harness.config, harness.context())).rejects.toThrow(
      "codebase.agent 没有版本 v2",
    );
  });

  it("gateway 分支缺网关密钥时直接拒绝，不会退回本地渲染", async () => {
    const harness = createWorkspaceHarness();
    harness.config.prompt.source = "gateway";
    harness.config.gateway.apiKeyEnv = "KG_TEST_ABSENT_KEY";
    delete process.env.KG_TEST_ABSENT_KEY;
    await expect(renderSystemPrompt(harness.config, harness.context())).rejects.toThrow(
      "Missing KG_TEST_ABSENT_KEY",
    );
  });

  it("platform.yaml 点名的提示词与版本，在仓库里那份 prompts.yaml 中真实存在", async () => {
    const raw = parse(readFileSync("config/prompts.yaml", "utf8")) as {
      prompts: Record<string, { active_version: string; versions: Record<string, unknown> }>;
    };
    const config = createWorkspaceHarness().config;
    const entry = raw.prompts[config.gateway.promptName];
    expect(entry).toBeDefined();
    expect(entry.versions[config.gateway.promptVersion]).toBeDefined();
    expect(entry.active_version).toBe(config.gateway.promptVersion);
  });
});

function writePrompts(harness: { config: { prompt: { file: string } }, root: string }, value: unknown): void {
  const file = join(harness.root, "config", "prompts-case.yaml");
  writeFileSync(file, stringify(value), "utf8");
  harness.config.prompt.file = file;
}

it("config/prompts.yaml 与 config/platform.yaml 点名的版本对得上", async () => {
  const raw = parse(readFileSync("config/prompts.yaml", "utf8")) as {
    prompts: Record<string, { active_version: string; versions: Record<string, unknown> }>;
  };
  const config = createWorkspaceHarness().config;
  const entry = raw.prompts[config.gateway.promptName];
  expect(entry).toBeDefined();
  expect(entry.versions[config.gateway.promptVersion]).toBeDefined();
  expect(entry.active_version).toBe(config.gateway.promptVersion);
});
