import { describe, expect, it } from "vitest";
import type { SemanticVote } from "./types.js";
import { generateAdversarialResults, applyAdversarial } from "./adversarial.js";

function makeVote(perspective: string, confidence: number = 0.8): SemanticVote {
  return {
    nodeId: "test/model",
    position: "test position",
    normalizedPosition: "test position",
    reasoning: "test reasoning",
    confidence,
    weight: 1.0,
    perspective,
    timestamp: new Date().toISOString(),
  };
}

describe("generateAdversarialResults", () => {
  it("generates challenges for all 8 ViewTypes", () => {
    const views = [
      "cost",
      "time",
      "risk",
      "feasibility",
      "ethics",
      "long_term",
      "emotion",
      "uncertainty",
    ];
    const votes = views.map((v) => makeVote(v));
    const results = generateAdversarialResults(votes, "test-delib-123");

    expect(results).toHaveLength(8);
    for (const r of results) {
      expect(r.challenge.id).toBeTruthy();
      expect(r.challenge.challenge.length).toBeGreaterThan(0);
      expect(["assumption", "evidence", "logic", "scope"]).toContain(r.challenge.challengeType);
      expect(["minor", "significant", "critical"]).toContain(r.challenge.severity);
      expect(r.rebuttal.rebuttal.length).toBeGreaterThan(0);
    }
  });

  it("is deterministic for same deliberationId", () => {
    const votes = [makeVote("cost"), makeVote("risk")];
    const r1 = generateAdversarialResults(votes, "same-id");
    const r2 = generateAdversarialResults(votes, "same-id");

    expect(r1[0]!.challenge.id).toBe(r2[0]!.challenge.id);
    expect(r1[0]!.challenge.challenge).toBe(r2[0]!.challenge.challenge);
  });

  it("produces different results for different deliberationIds", () => {
    const votes = [makeVote("risk")];
    const r1 = generateAdversarialResults(votes, "id-a");
    const r2 = generateAdversarialResults(votes, "id-b");

    // May or may not differ depending on hash collisions, but IDs should differ
    expect(r1[0]!.challenge.id).not.toBe(r2[0]!.challenge.id);
  });

  it("adjusts confidence based on severity", () => {
    const votes = [makeVote("risk", 0.8)]; // risk has critical challenges
    const results = generateAdversarialResults(votes, "test");

    for (const r of results) {
      if (r.challenge.severity === "critical") {
        expect(r.rebuttal.revisedConfidence).toBeCloseTo(0.7, 1);
        expect(r.rebuttal.concession).toBeTruthy();
      }
    }
  });

  it("never drops confidence below 0.1", () => {
    const votes = [makeVote("risk", 0.05)];
    const results = generateAdversarialResults(votes, "test-low");
    for (const r of results) {
      expect(r.rebuttal.revisedConfidence).toBeGreaterThanOrEqual(0.1);
    }
  });

  it("skips unknown perspectives gracefully", () => {
    const votes = [makeVote("custom_unknown")];
    const results = generateAdversarialResults(votes, "test");
    expect(results).toHaveLength(0);
  });
});

describe("applyAdversarial", () => {
  it("returns adjusted votes with modified confidence", () => {
    const votes = [makeVote("cost", 0.9), makeVote("risk", 0.9)];
    const { adjustedVotes, adversarialDetails } = applyAdversarial(votes, "test-apply");

    expect(adjustedVotes).toHaveLength(2);
    expect(adversarialDetails).toHaveLength(2);

    // At least one should have reduced confidence
    const anyReduced = adjustedVotes.some((v) => v.confidence < 0.9);
    expect(anyReduced).toBe(true);
  });

  it("preserves vote structure except confidence", () => {
    const votes = [makeVote("cost", 0.8)];
    const { adjustedVotes } = applyAdversarial(votes, "test-struct");

    expect(adjustedVotes[0]!.nodeId).toBe("test/model");
    expect(adjustedVotes[0]!.position).toBe("test position");
    expect(adjustedVotes[0]!.perspective).toBe("cost");
  });
});
