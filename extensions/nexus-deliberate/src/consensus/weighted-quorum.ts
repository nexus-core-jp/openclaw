/**
 * Weighted quorum calculator.
 * Simplified port of tetsumaru-production/backend/app/collective/consensus/weighted_quorum.py
 * for Phase A (deliberation-focused use case).
 */

import type { QuorumResult, SemanticVote } from "../types.js";
import { tallyVotes } from "./harmony.js";

export interface Replica {
  nodeId: string;
  weight: number;
  isVoter: boolean;
}

/**
 * Evaluate weighted quorum for a set of semantic votes.
 * Groups votes by position and checks whether the strongest position
 * meets the quorum threshold.
 */
export function checkWeightedQuorum(
  votes: SemanticVote[],
  quorumRatio: number = 0.66,
  clusteringOptions?: { enableClustering?: boolean; similarityThreshold?: number },
): QuorumResult {
  if (votes.length === 0) {
    return {
      hasQuorum: false,
      supportWeight: 0,
      totalWeight: 0,
      requiredWeight: 0,
      supportRatio: 0,
      quorumRatio,
      winningPosition: null,
    };
  }

  const totalWeight = votes.reduce((sum, v) => sum + v.weight, 0);
  const requiredWeight = totalWeight * quorumRatio;

  const [stateVotes, bestKey] = tallyVotes(votes, clusteringOptions);

  if (!bestKey) {
    return {
      hasQuorum: false,
      supportWeight: 0,
      totalWeight,
      requiredWeight,
      supportRatio: 0,
      quorumRatio,
      winningPosition: null,
    };
  }

  const best = stateVotes.get(bestKey)!;
  const supportRatio = totalWeight > 0 ? best.totalWeight / totalWeight : 0;

  return {
    hasQuorum: best.totalWeight >= requiredWeight,
    supportWeight: best.totalWeight,
    totalWeight,
    requiredWeight,
    supportRatio,
    quorumRatio,
    winningPosition: best.representativePosition,
  };
}
