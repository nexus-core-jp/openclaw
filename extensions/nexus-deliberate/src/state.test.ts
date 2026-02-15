import { describe, expect, it, beforeEach } from "vitest";
import type { DeliberationResult } from "./types.js";
import { saveResult, getResult, listResults } from "./state.js";

function makeResult(id: string): DeliberationResult {
  return {
    id,
    query: `test query ${id}`,
    votes: [],
    consensus: {
      harmonyIndex: 0.5,
      semanticSimilarity: 0.5,
      divergenceCount: 0,
      agreementPercentage: 50,
      confidenceScore: 0.4,
    },
    harmonyLevel: "partial",
    status: "finalized",
    conclusion: null,
    participants: [],
    perspectives: ["cost"],
    timestamp: new Date().toISOString(),
  };
}

describe("state", () => {
  // Note: state is module-level, so tests are not fully isolated.
  // We accept this for Phase A (in-memory store).

  it("saves and retrieves a result", () => {
    const result = makeResult("test_save_1");
    saveResult(result);
    expect(getResult("test_save_1")).toEqual(result);
  });

  it("returns undefined for missing id", () => {
    expect(getResult("nonexistent_id_xyz")).toBeUndefined();
  });

  it("listResults returns saved results", () => {
    const r1 = makeResult("test_list_1");
    const r2 = makeResult("test_list_2");
    saveResult(r1);
    saveResult(r2);
    const results = listResults();
    const ids = results.map((r) => r.id);
    expect(ids).toContain("test_list_1");
    expect(ids).toContain("test_list_2");
  });

  it("listResults respects limit", () => {
    for (let i = 0; i < 5; i++) {
      saveResult(makeResult(`test_limit_${i}`));
    }
    const results = listResults(2);
    expect(results.length).toBeLessThanOrEqual(2);
  });
});
