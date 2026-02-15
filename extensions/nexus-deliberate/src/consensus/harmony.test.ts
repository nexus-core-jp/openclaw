import { describe, expect, it } from "vitest";
import type { SemanticVote } from "../types.js";
import {
  normalizePosition,
  classifyHarmony,
  tallyVotes,
  hasQuorum,
  calculateHarmony,
} from "./harmony.js";

function makeVote(overrides: Partial<SemanticVote> & { normalizedPosition: string }): SemanticVote {
  return {
    nodeId: "test/model",
    position: overrides.position ?? overrides.normalizedPosition,
    normalizedPosition: overrides.normalizedPosition,
    reasoning: "test reasoning",
    confidence: 0.8,
    weight: 1.0,
    perspective: "cost",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── normalizePosition ───────────────────────────────────────

describe("normalizePosition", () => {
  it("converts full-width characters to half-width", () => {
    expect(normalizePosition("Ａ Ｂ Ｃ")).toBe("a b c");
  });

  it("converts to lowercase", () => {
    expect(normalizePosition("HELLO World")).toBe("hello world");
  });

  it("removes leading prefix 結論：", () => {
    expect(normalizePosition("結論：これが結論です")).toBe("これが結論です");
  });

  it("removes leading prefix Position:", () => {
    expect(normalizePosition("Position: this is it")).toBe("this is it");
  });

  it("removes leading prefix Stance:", () => {
    expect(normalizePosition("Stance: my stance")).toBe("my stance");
  });

  it("removes punctuation", () => {
    expect(normalizePosition("hello。world！")).toBe("helloworld");
  });

  it("collapses whitespace", () => {
    expect(normalizePosition("  a   b   c  ")).toBe("a b c");
  });

  it("handles combined normalization", () => {
    expect(normalizePosition("結論：Ｈｅｌｌｏ、Ｗｏｒｌｄ！！")).toBe("helloworld");
  });

  it("returns empty string for empty input", () => {
    expect(normalizePosition("")).toBe("");
    expect(normalizePosition("   ")).toBe("");
  });
});

// ─── classifyHarmony ─────────────────────────────────────────

describe("classifyHarmony", () => {
  it("classifies dissonance for low values", () => {
    expect(classifyHarmony(0)).toBe("dissonance");
    expect(classifyHarmony(0.1)).toBe("dissonance");
    expect(classifyHarmony(0.32)).toBe("dissonance");
  });

  it("classifies partial for mid values", () => {
    expect(classifyHarmony(0.33)).toBe("partial");
    expect(classifyHarmony(0.5)).toBe("partial");
    expect(classifyHarmony(0.65)).toBe("partial");
  });

  it("classifies harmony for high values", () => {
    expect(classifyHarmony(0.66)).toBe("harmony");
    expect(classifyHarmony(0.8)).toBe("harmony");
    expect(classifyHarmony(0.89)).toBe("harmony");
  });

  it("classifies perfect for very high values", () => {
    expect(classifyHarmony(0.9)).toBe("perfect");
    expect(classifyHarmony(0.95)).toBe("perfect");
    expect(classifyHarmony(1.0)).toBe("perfect");
  });
});

// ─── tallyVotes ──────────────────────────────────────────────

describe("tallyVotes", () => {
  it("returns null bestKey for empty votes", () => {
    const [stateVotes, bestKey] = tallyVotes([]);
    expect(stateVotes.size).toBe(0);
    expect(bestKey).toBeNull();
  });

  it("tallies a single vote", () => {
    const votes = [makeVote({ normalizedPosition: "option a", weight: 1.0 })];
    const [stateVotes, bestKey] = tallyVotes(votes);
    expect(bestKey).toBe("option a");
    expect(stateVotes.get("option a")!.totalWeight).toBe(1.0);
  });

  it("groups votes by normalizedPosition", () => {
    const votes = [
      makeVote({
        position: "Option A!",
        normalizedPosition: "option a",
        weight: 1.0,
      }),
      makeVote({
        position: "option A。",
        normalizedPosition: "option a",
        weight: 1.0,
      }),
      makeVote({ normalizedPosition: "option b", weight: 1.0 }),
    ];
    const [stateVotes, bestKey] = tallyVotes(votes);
    expect(bestKey).toBe("option a");
    expect(stateVotes.get("option a")!.totalWeight).toBe(2.0);
    expect(stateVotes.get("option b")!.totalWeight).toBe(1.0);
  });

  it("preserves representativePosition from first vote", () => {
    const votes = [
      makeVote({
        position: "First Expression",
        normalizedPosition: "option a",
      }),
      makeVote({
        position: "Second Expression",
        normalizedPosition: "option a",
      }),
    ];
    const [stateVotes] = tallyVotes(votes);
    expect(stateVotes.get("option a")!.representativePosition).toBe("First Expression");
  });

  it("breaks ties by confidence", () => {
    const votes = [
      makeVote({
        normalizedPosition: "a",
        weight: 1.0,
        confidence: 0.9,
      }),
      makeVote({
        normalizedPosition: "b",
        weight: 1.0,
        confidence: 0.5,
      }),
    ];
    const [, bestKey] = tallyVotes(votes);
    expect(bestKey).toBe("a");
  });

  it("breaks further ties by hash (deterministic)", () => {
    const votes = [
      makeVote({
        normalizedPosition: "alpha",
        weight: 1.0,
        confidence: 0.8,
      }),
      makeVote({
        normalizedPosition: "beta",
        weight: 1.0,
        confidence: 0.8,
      }),
    ];
    const [, bestKey] = tallyVotes(votes);
    // Should be deterministic — same input always produces same winner
    expect(typeof bestKey).toBe("string");

    const [, bestKey2] = tallyVotes(votes);
    expect(bestKey2).toBe(bestKey);
  });
});

// ─── hasQuorum ───────────────────────────────────────────────

describe("hasQuorum", () => {
  it("returns false for empty votes", () => {
    expect(hasQuorum([], 3.0)).toBe(false);
  });

  it("returns false for zero expectedWeight", () => {
    const votes = [makeVote({ normalizedPosition: "a" })];
    expect(hasQuorum(votes, 0)).toBe(false);
  });

  it("returns true when majority agrees", () => {
    const votes = [
      makeVote({ normalizedPosition: "yes", weight: 1.0 }),
      makeVote({ normalizedPosition: "yes", weight: 1.0 }),
      makeVote({ normalizedPosition: "no", weight: 1.0 }),
    ];
    expect(hasQuorum(votes, 3.0, 0.66)).toBe(true);
  });

  it("returns false when no clear majority", () => {
    const votes = [
      makeVote({ normalizedPosition: "a", weight: 1.0 }),
      makeVote({ normalizedPosition: "b", weight: 1.0 }),
      makeVote({ normalizedPosition: "c", weight: 1.0 }),
    ];
    expect(hasQuorum(votes, 3.0, 0.66)).toBe(false);
  });

  it("respects custom threshold", () => {
    const votes = [
      makeVote({ normalizedPosition: "yes", weight: 1.0 }),
      makeVote({ normalizedPosition: "no", weight: 1.0 }),
    ];
    // 50% agreement, threshold 0.5 -> quorum
    expect(hasQuorum(votes, 2.0, 0.5)).toBe(true);
    // 50% agreement, threshold 0.66 -> no quorum
    expect(hasQuorum(votes, 2.0, 0.66)).toBe(false);
  });
});

// ─── calculateHarmony ────────────────────────────────────────

describe("calculateHarmony", () => {
  it("returns zeros for empty votes", () => {
    const result = calculateHarmony([]);
    expect(result.harmonyIndex).toBe(0);
    expect(result.semanticSimilarity).toBe(0);
    expect(result.divergenceCount).toBe(0);
    expect(result.agreementPercentage).toBe(0);
    expect(result.confidenceScore).toBe(0);
  });

  it("returns perfect scores for unanimous single vote", () => {
    const votes = [makeVote({ normalizedPosition: "consensus", confidence: 1.0 })];
    const result = calculateHarmony(votes);
    expect(result.harmonyIndex).toBe(1.0);
    expect(result.semanticSimilarity).toBe(1.0);
    expect(result.agreementPercentage).toBe(100);
    expect(result.divergenceCount).toBe(0);
  });

  it("returns perfect harmony for all-agree scenario", () => {
    const votes = [
      makeVote({ normalizedPosition: "same", weight: 1.0, confidence: 0.9 }),
      makeVote({ normalizedPosition: "same", weight: 1.0, confidence: 0.9 }),
      makeVote({ normalizedPosition: "same", weight: 1.0, confidence: 0.9 }),
    ];
    const result = calculateHarmony(votes);
    expect(result.harmonyIndex).toBe(1.0);
    expect(result.semanticSimilarity).toBe(1.0);
    expect(result.agreementPercentage).toBe(100);
    expect(result.divergenceCount).toBe(0);
  });

  it("calculates partial harmony for split votes", () => {
    const votes = [
      makeVote({ normalizedPosition: "a", weight: 1.0 }),
      makeVote({ normalizedPosition: "a", weight: 1.0 }),
      makeVote({ normalizedPosition: "b", weight: 1.0 }),
    ];
    const result = calculateHarmony(votes);
    // similarity = 1 - (2-1)/3 = 0.667
    // agreement = 2/3 = 0.667
    // harmony = 0.667 * 0.4 + 0.667 * 0.6 = 0.667
    expect(result.harmonyIndex).toBeCloseTo(0.667, 2);
    expect(result.divergenceCount).toBe(1);
  });

  it("calculates low harmony for full disagreement", () => {
    const votes = [
      makeVote({ normalizedPosition: "a", weight: 1.0 }),
      makeVote({ normalizedPosition: "b", weight: 1.0 }),
      makeVote({ normalizedPosition: "c", weight: 1.0 }),
      makeVote({ normalizedPosition: "d", weight: 1.0 }),
    ];
    const result = calculateHarmony(votes);
    // similarity = 1 - (4-1)/4 = 0.25
    // agreement = 1/4 = 0.25
    // harmony = 0.25 * 0.4 + 0.25 * 0.6 = 0.25
    expect(result.harmonyIndex).toBeCloseTo(0.25, 2);
    expect(result.divergenceCount).toBe(3);
  });

  it("uses expectedWeight when provided", () => {
    const votes = [
      makeVote({ normalizedPosition: "a", weight: 1.0 }),
      makeVote({ normalizedPosition: "a", weight: 1.0 }),
    ];
    // With expectedWeight=4, agreement = 2/4 = 50%
    const result = calculateHarmony(votes, 4);
    expect(result.agreementPercentage).toBeCloseTo(50, 0);
  });

  it("confidenceScore reflects both confidence and harmony", () => {
    const highConf = [
      makeVote({ normalizedPosition: "a", weight: 1.0, confidence: 1.0 }),
      makeVote({ normalizedPosition: "a", weight: 1.0, confidence: 1.0 }),
    ];
    const lowConf = [
      makeVote({ normalizedPosition: "a", weight: 1.0, confidence: 0.2 }),
      makeVote({ normalizedPosition: "a", weight: 1.0, confidence: 0.2 }),
    ];
    const highResult = calculateHarmony(highConf);
    const lowResult = calculateHarmony(lowConf);
    expect(highResult.confidenceScore).toBeGreaterThan(lowResult.confidenceScore);
  });

  it("clamps harmonyIndex to [0, 1]", () => {
    const votes = [makeVote({ normalizedPosition: "a", weight: 100.0 })];
    const result = calculateHarmony(votes);
    expect(result.harmonyIndex).toBeLessThanOrEqual(1);
    expect(result.harmonyIndex).toBeGreaterThanOrEqual(0);
  });
});
