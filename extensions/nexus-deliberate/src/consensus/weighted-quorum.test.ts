import { describe, expect, it } from "vitest";
import type { SemanticVote } from "../types.js";
import { checkWeightedQuorum } from "./weighted-quorum.js";

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

describe("checkWeightedQuorum", () => {
  it("returns no quorum for empty votes", () => {
    const result = checkWeightedQuorum([]);
    expect(result.hasQuorum).toBe(false);
    expect(result.supportWeight).toBe(0);
    expect(result.totalWeight).toBe(0);
    expect(result.winningPosition).toBeNull();
  });

  it("reaches quorum when all agree", () => {
    const votes = [
      makeVote({ normalizedPosition: "yes", weight: 1.0 }),
      makeVote({ normalizedPosition: "yes", weight: 1.0 }),
      makeVote({ normalizedPosition: "yes", weight: 1.0 }),
    ];
    const result = checkWeightedQuorum(votes, 0.66);
    expect(result.hasQuorum).toBe(true);
    expect(result.supportWeight).toBe(3.0);
    expect(result.totalWeight).toBe(3.0);
    expect(result.supportRatio).toBe(1.0);
  });

  it("returns representativePosition (not normalized key) as winningPosition", () => {
    const votes = [
      makeVote({
        position: "Yes, we should proceed!",
        normalizedPosition: "yes we should proceed",
        weight: 1.0,
      }),
      makeVote({
        position: "YES. We should proceed.",
        normalizedPosition: "yes we should proceed",
        weight: 1.0,
      }),
    ];
    const result = checkWeightedQuorum(votes, 0.66);
    expect(result.hasQuorum).toBe(true);
    // Should return the original (un-normalized) position, not the normalized key
    expect(result.winningPosition).toBe("Yes, we should proceed!");
  });

  it("fails quorum when votes split evenly", () => {
    const votes = [
      makeVote({ normalizedPosition: "a", weight: 1.0 }),
      makeVote({ normalizedPosition: "b", weight: 1.0 }),
      makeVote({ normalizedPosition: "c", weight: 1.0 }),
    ];
    const result = checkWeightedQuorum(votes, 0.66);
    expect(result.hasQuorum).toBe(false);
    expect(result.supportRatio).toBeCloseTo(0.333, 2);
  });

  it("respects weight differences", () => {
    const votes = [
      makeVote({ normalizedPosition: "heavy", weight: 5.0 }),
      makeVote({ normalizedPosition: "light", weight: 1.0 }),
      makeVote({ normalizedPosition: "light2", weight: 1.0 }),
    ];
    const result = checkWeightedQuorum(votes, 0.66);
    expect(result.hasQuorum).toBe(true);
    expect(result.supportWeight).toBe(5.0);
    expect(result.totalWeight).toBe(7.0);
  });

  it("uses default quorumRatio of 0.66", () => {
    const votes = [
      makeVote({ normalizedPosition: "a", weight: 2.0 }),
      makeVote({ normalizedPosition: "b", weight: 1.0 }),
    ];
    const result = checkWeightedQuorum(votes);
    // 2/3 = 0.667 >= 0.66 → quorum
    expect(result.hasQuorum).toBe(true);
    expect(result.quorumRatio).toBe(0.66);
  });

  it("calculates requiredWeight correctly", () => {
    const votes = [
      makeVote({ normalizedPosition: "a", weight: 1.0 }),
      makeVote({ normalizedPosition: "b", weight: 1.0 }),
    ];
    const result = checkWeightedQuorum(votes, 0.75);
    expect(result.requiredWeight).toBe(1.5); // 2.0 * 0.75
  });
});
