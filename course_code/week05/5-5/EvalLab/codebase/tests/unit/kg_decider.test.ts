import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, type PlatformConfig } from "../../src/config.js";
import { createDecider, loadDeciderScript } from "../../src/pi/decider.js";

function config(): PlatformConfig {
  return loadConfig("config/platform.yaml");
}

function scriptFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-script-"));
  const path = join(dir, "script.yaml");
  writeFileSync(path, body, "utf8");
  return path;
}

describe("离线决策脚本", () => {
  it("读 steps：一条 = 模型一轮要说的话和要调的工具", () => {
    const steps = loadDeciderScript(
      scriptFile(`
steps:
  - text: 先搜一下登录入口
    tool_calls:
      - name: search_code
        args: { pattern: login, path: src }
  - text: 已经看清楚了，收尾。
`),
    );
    expect(steps).toHaveLength(2);
    expect(steps[0]?.tool_calls?.[0]).toEqual({ name: "search_code", args: { pattern: "login", path: "src" } });
    expect(steps[1]?.text).toBe("已经看清楚了，收尾。");
  });

  it("steps 缺失或为空直接报错：宁可不开跑，也不跑一个永远不动的 Loop", () => {
    expect(() => loadDeciderScript(scriptFile("steps: []\n"))).toThrow("非空的 steps");
    expect(() => loadDeciderScript(scriptFile("something_else: 1\n"))).toThrow("非空的 steps");
  });

  it("某一步既没文本也没工具调用时，创建决策器就失败", () => {
    const steps = loadDeciderScript(scriptFile("steps:\n  - text: 有内容\n  - {}\n"));
    expect(() => createDecider(config(), steps)).toThrow("至少要有文本或一次工具调用");
  });
});

describe("决策器只有一个切换口", () => {
  it("给了脚本 → scripted（不联网）；没给 → gateway（DeepSeek 模型名）", () => {
    const steps = loadDeciderScript(scriptFile("steps:\n  - text: 完成\n"));
    expect(createDecider(config(), steps).kind).toBe("scripted");

    const gateway = createDecider(config());
    expect(gateway.kind).toBe("gateway");
    expect(gateway.model.id).toBe("deepseek-v4-flash");
    expect(gateway.model.provider).toBe("deepseek");
  });

  it("两条路交出的形状一致：{ models, model, registerTo }，扩展点与自研 Loop 都能接", () => {
    const steps = loadDeciderScript(scriptFile("steps:\n  - text: 完成\n"));
    const scripted = createDecider(config(), steps);
    const gateway = createDecider(config());
    for (const decider of [scripted, gateway]) {
      expect(typeof decider.models.streamSimple).toBe("function");
      expect(typeof decider.registerTo).toBe("function");
      expect(decider.model.contextWindow).toBeGreaterThan(0);
      expect(decider.model.maxTokens).toBeGreaterThan(0);
    }
    expect(scripted.model.provider).toBe("managed-script");
    expect(scripted.model.id).toBe("decider");
  });

  it("脚本决策器按真实单价计价：离线排练烧了多少钱，上线后就是多少", () => {
    const base = config();
    const scripted = createDecider(base, loadDeciderScript(scriptFile("steps:\n  - text: 完成\n")));
    expect(scripted.model.cost).toEqual({
      input: base.model.inputPerMillion,
      output: base.model.outputPerMillion,
      cacheRead: base.model.cacheReadPerMillion,
      cacheWrite: base.model.inputPerMillion,
    });
  });
});
