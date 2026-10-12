import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { PolicyEngine } from "../../src/policy.js";
import { ToolRegistry } from "../../src/registry.js";
import type { ExecutionContext, ManagedTool } from "../../src/domain.js";

const context: ExecutionContext = {
  traceId: "trace-registry",
  requestId: "request-registry",
  userId: "user-1",
  tenantId: "tenant_a",
  roles: ["support"],
  agentName: "support-agent",
  mode: "execute",
};

function tool(internalName: string): ManagedTool {
  return {
    metadata: {
      internalName,
      description: `Tool ${internalName}`,
      version: "1.0.0",
      parameters: Type.Object({ value: Type.String() }, { additionalProperties: false }),
      risk: "read",
      permissions: ["order:read"],
      requiresConfirmation: false,
      timeoutMs: 1_000,
      maxRetries: 0,
      idempotent: true,
      source: "local",
    },
    async handler() {
      return { ok: true };
    },
  };
}

describe("ToolRegistry public snapshot", () => {
  it("exposes only allowlisted tools and maps dotted names for the model", () => {
    const registry = new ToolRegistry();
    registry.register(tool("repo.list_files"));
    registry.register(tool("repo.write_file"));
    const policy = new PolicyEngine({
      rolePermissions: { support: ["order:read"] },
      agentToolAllowlist: { "support-agent": ["repo.list_files"] },
    });

    const snapshot = registry.snapshot(context, policy);

    expect(snapshot.map((entry) => entry.modelName)).toEqual(["repo__list_files"]);
    expect(registry.getByModelName("repo__list_files").metadata.internalName).toBe("repo.list_files");
  });

  it("rejects model-name collisions during registration", () => {
    const registry = new ToolRegistry();
    registry.register(tool("repo.list_files"));

    expect(() => registry.register(tool("repo__list_files"))).toThrow(/collision/i);
  });

  it("allows only the configured namespace wildcard", () => {
    const registry = new ToolRegistry();
    registry.register(tool("repo.list_files"));
    registry.register(tool("search.list_files"));
    const policy = new PolicyEngine({
      rolePermissions: { support: ["order:read"] },
      agentToolAllowlist: { "support-agent": ["repo.*"] },
    });

    expect(registry.snapshot(context, policy).map((entry) => entry.metadata.internalName)).toEqual([
      "repo.list_files",
    ]);
  });
});
