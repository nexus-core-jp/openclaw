import { describe, expect, it } from "vitest";
import { resolveProviders } from "./orchestrator.js";

// Note: runDeliberation requires runEmbeddedPiAgent which is an internal OpenClaw API.
// We test the pure functions that don't require the runner.

describe("resolveProviders", () => {
  const makeApi = (overrides?: Record<string, unknown>) => {
    return {
      pluginConfig: overrides?.pluginConfig ?? {},
      config: overrides?.config ?? {},
    } as Parameters<typeof resolveProviders>[0];
  };

  it("uses explicit providers first", () => {
    const api = makeApi({
      pluginConfig: { defaultProviders: ["fallback/model"] },
    });
    const result = resolveProviders(api, ["openai/gpt-4o", "anthropic/claude-sonnet-4-5-20250929"]);
    expect(result).toHaveLength(2);
    expect(result[0]!.provider).toBe("openai");
    expect(result[0]!.model).toBe("gpt-4o");
    expect(result[1]!.provider).toBe("anthropic");
    expect(result[1]!.model).toBe("claude-sonnet-4-5-20250929");
  });

  it("falls back to defaultProviders from plugin config", () => {
    const api = makeApi({
      pluginConfig: {
        defaultProviders: ["openai/gpt-4o"],
        defaultAuthProfileId: "auth-1",
      },
    });
    const result = resolveProviders(api);
    expect(result).toHaveLength(1);
    expect(result[0]!.provider).toBe("openai");
    expect(result[0]!.authProfileId).toBe("auth-1");
  });

  it("falls back to OpenClaw primary model", () => {
    const api = makeApi({
      config: {
        agents: {
          defaults: {
            model: { primary: "google/gemini-pro" },
          },
        },
      },
    });
    const result = resolveProviders(api);
    expect(result).toHaveLength(1);
    expect(result[0]!.provider).toBe("google");
    expect(result[0]!.model).toBe("gemini-pro");
  });

  it("returns empty array when no providers configured", () => {
    const api = makeApi({});
    const result = resolveProviders(api);
    expect(result).toHaveLength(0);
  });

  it("handles model names with multiple slashes", () => {
    const result = resolveProviders(makeApi({}), ["provider/org/model-name"]);
    expect(result[0]!.provider).toBe("provider");
    expect(result[0]!.model).toBe("org/model-name");
  });
});
