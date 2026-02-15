import { describe, expect, it } from "vitest";
import type { SemanticVote } from "../types.js";
import {
  tokenize,
  jaccardSimilarity,
  clusterPositions,
  tallyVotes,
  calculateHarmony,
} from "./harmony.js";

function makeVote(overrides: Partial<SemanticVote> & { normalizedPosition: string }): SemanticVote {
  return {
    nodeId: "test/model",
    position: overrides.position ?? overrides.normalizedPosition,
    normalizedPosition: overrides.normalizedPosition,
    reasoning: "test",
    confidence: 0.8,
    weight: 1.0,
    perspective: "cost",
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

// ─── tokenize ────────────────────────────────────────────────

describe("tokenize", () => {
  it("extracts english words", () => {
    const tokens = tokenize("hello world test");
    expect(tokens.has("hello")).toBe(true);
    expect(tokens.has("world")).toBe(true);
    expect(tokens.has("test")).toBe(true);
  });

  it("ignores short english words (< 2 chars)", () => {
    const tokens = tokenize("a b cd");
    expect(tokens.has("a")).toBe(false);
    expect(tokens.has("b")).toBe(false);
    expect(tokens.has("cd")).toBe(true);
  });

  it("extracts Japanese bigrams", () => {
    const tokens = tokenize("技術的");
    expect(tokens.has("技術")).toBe(true);
    expect(tokens.has("術的")).toBe(true);
    // Single chars too
    expect(tokens.has("技")).toBe(true);
    expect(tokens.has("術")).toBe(true);
    expect(tokens.has("的")).toBe(true);
  });

  it("handles mixed Japanese and English", () => {
    const tokens = tokenize("ai技術は重要");
    expect(tokens.has("ai")).toBe(true);
    expect(tokens.has("技術")).toBe(true);
  });

  it("returns empty set for empty string", () => {
    const tokens = tokenize("");
    expect(tokens.size).toBe(0);
  });
});

// ─── jaccardSimilarity ──────────────────────────────────────

describe("jaccardSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(jaccardSimilarity("hello", "hello")).toBe(1.0);
  });

  it("returns 0.0 for completely different strings", () => {
    const sim = jaccardSimilarity("abc", "xyz");
    expect(sim).toBe(0.0);
  });

  it("returns high similarity for similar strings", () => {
    const sim = jaccardSimilarity("技術的に実現可能", "技術的に実現可能である");
    expect(sim).toBeGreaterThan(0.5);
  });

  it("returns moderate similarity for somewhat similar strings", () => {
    const sim = jaccardSimilarity("コスト削減が必要", "コスト管理が重要");
    expect(sim).toBeGreaterThan(0.1);
    expect(sim).toBeLessThan(0.9);
  });

  it("handles both empty strings", () => {
    expect(jaccardSimilarity("", "")).toBe(1.0);
  });

  it("handles one empty string", () => {
    expect(jaccardSimilarity("hello", "")).toBe(0.0);
  });
});

// ─── clusterPositions ───────────────────────────────────────

describe("clusterPositions", () => {
  it("clusters identical positions", () => {
    const votes = [
      makeVote({ normalizedPosition: "same", weight: 1.0 }),
      makeVote({ normalizedPosition: "same", weight: 1.0 }),
    ];
    const mapping = clusterPositions(votes, 0.5);
    expect(mapping.get("same")).toBe("same");
  });

  it("clusters similar Japanese positions", () => {
    const votes = [
      makeVote({
        normalizedPosition: "技術的に実現可能",
        weight: 2.0,
      }),
      makeVote({
        normalizedPosition: "技術的に実現可能である",
        weight: 1.0,
      }),
    ];
    const mapping = clusterPositions(votes, 0.5);
    // Both should map to the higher-weight representative
    const rep1 = mapping.get("技術的に実現可能");
    const rep2 = mapping.get("技術的に実現可能である");
    expect(rep1).toBe(rep2);
  });

  it("keeps dissimilar positions separate", () => {
    const votes = [
      makeVote({ normalizedPosition: "賛成" }),
      makeVote({ normalizedPosition: "反対" }),
    ];
    const mapping = clusterPositions(votes, 0.5);
    expect(mapping.get("賛成")).not.toBe(mapping.get("反対"));
  });

  it("representative is the highest-weight member", () => {
    const votes = [
      makeVote({
        normalizedPosition: "技術的に実現可能",
        weight: 3.0,
      }),
      makeVote({
        normalizedPosition: "技術的に実現可能である",
        weight: 1.0,
      }),
    ];
    const mapping = clusterPositions(votes, 0.5);
    expect(mapping.get("技術的に実現可能である")).toBe("技術的に実現可能");
  });
});

// ─── tallyVotes with clustering ─────────────────────────────

describe("tallyVotes with clustering", () => {
  it("groups similar positions when clustering enabled", () => {
    const votes = [
      makeVote({
        normalizedPosition: "技術的に実現可能",
        weight: 1.0,
      }),
      makeVote({
        normalizedPosition: "技術的に実現可能である",
        weight: 1.0,
      }),
      makeVote({
        normalizedPosition: "コストが高すぎる",
        weight: 1.0,
      }),
    ];

    // Without clustering: 3 unique positions
    const [withoutMap] = tallyVotes(votes);
    expect(withoutMap.size).toBe(3);

    // With clustering: similar positions grouped
    const [withMap, bestKey] = tallyVotes(votes, {
      enableClustering: true,
      similarityThreshold: 0.5,
    });
    // The two similar positions should be merged
    expect(withMap.size).toBeLessThanOrEqual(2);
    expect(bestKey).toBeTruthy();
  });
});

// ─── calculateHarmony with clustering ───────────────────────

describe("calculateHarmony with clustering", () => {
  it("produces higher harmony when clustering merges similar positions", () => {
    const votes = [
      makeVote({ normalizedPosition: "技術的に実現可能", weight: 1.0 }),
      makeVote({ normalizedPosition: "技術的に実現可能である", weight: 1.0 }),
      makeVote({ normalizedPosition: "コストが高い", weight: 1.0 }),
    ];

    const withoutClustering = calculateHarmony(votes);
    const withClustering = calculateHarmony(votes, undefined, {
      enableClustering: true,
      similarityThreshold: 0.5,
    });

    // Clustering should improve harmony by merging similar positions
    expect(withClustering.harmonyIndex).toBeGreaterThanOrEqual(withoutClustering.harmonyIndex);
  });
});
