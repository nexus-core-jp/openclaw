import { describe, expect, it } from "vitest";
import type { Perspective } from "./types.js";
import { DEFAULT_PERSPECTIVES, resolvePerspectives } from "./perspectives.js";

describe("DEFAULT_PERSPECTIVES", () => {
  it("has exactly 8 perspectives matching Nexus Sphere ViewTypes", () => {
    expect(DEFAULT_PERSPECTIVES).toHaveLength(8);
    const ids = DEFAULT_PERSPECTIVES.map((p) => p.id);
    expect(ids).toEqual([
      "cost",
      "time",
      "risk",
      "feasibility",
      "ethics",
      "long_term",
      "emotion",
      "uncertainty",
    ]);
  });

  it("each perspective has required fields", () => {
    for (const p of DEFAULT_PERSPECTIVES) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.label).toBe("string");
      expect(typeof p.systemPrompt).toBe("string");
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.systemPrompt.length).toBeGreaterThan(0);
    }
  });
});

describe("resolvePerspectives", () => {
  it("returns all 8 defaults when no ids provided", () => {
    const result = resolvePerspectives();
    expect(result).toEqual(DEFAULT_PERSPECTIVES);
  });

  it("returns all 8 defaults for empty array", () => {
    const result = resolvePerspectives([]);
    expect(result).toEqual(DEFAULT_PERSPECTIVES);
  });

  it("resolves specific perspectives by id", () => {
    const result = resolvePerspectives(["cost", "risk"]);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("cost");
    expect(result[1]!.id).toBe("risk");
  });

  it("preserves order of requested ids", () => {
    const result = resolvePerspectives(["uncertainty", "cost", "time"]);
    expect(result.map((p) => p.id)).toEqual(["uncertainty", "cost", "time"]);
  });

  it("falls back to defaults when no ids match", () => {
    const result = resolvePerspectives(["nonexistent"]);
    expect(result).toEqual(DEFAULT_PERSPECTIVES);
  });

  it("ignores unrecognized ids but returns matched ones", () => {
    const result = resolvePerspectives(["cost", "nonexistent", "risk"]);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("cost");
    expect(result[1]!.id).toBe("risk");
  });

  it("includes custom perspectives", () => {
    const custom: Perspective[] = [
      {
        id: "custom_view",
        label: "Custom",
        systemPrompt: "Custom prompt",
      },
    ];
    const result = resolvePerspectives(["custom_view"], custom);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("custom_view");
  });

  it("merges custom with defaults", () => {
    const custom: Perspective[] = [
      {
        id: "custom_view",
        label: "Custom",
        systemPrompt: "Custom prompt",
      },
    ];
    const result = resolvePerspectives(["cost", "custom_view"], custom);
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("cost");
    expect(result[1]!.id).toBe("custom_view");
  });
});
