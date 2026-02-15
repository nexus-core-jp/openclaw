/**
 * Harmony Index 計算。
 *
 * 移植元: Nexus Sphere (tetsumaru-production) consensus.py
 *   - ConsensusState.calculate_harmony() (L230-295)
 *   - ConsensusState._tally_votes() (L152-185)
 *   - ConsensusState.has_quorum() (L187-201)
 */

import crypto from "node:crypto";
import type { ConsensusMetric, HarmonyLevel, SemanticVote } from "../types.js";

/**
 * Position を正規化する。
 *
 * LLM は同じ結論を微妙に異なる表現で返すため、
 * 完全一致では合意が成立しにくい。以下の正規化を適用：
 *   1. 全角→半角、大文字→小文字
 *   2. 句読点・余分な空白を除去
 *   3. 先頭の「結論：」「Position:」等のプレフィックスを除去
 *
 * Phase B: embedding ベースの意味的類似度に移行予定。
 */
export function normalizePosition(raw: string): string {
  let s = raw.trim();
  // 全角英数→半角
  s = s.replace(/[\uff01-\uff5e]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.toLowerCase();
  // 先頭のプレフィックス除去
  s = s.replace(/^(結論[:：]\s*|position[:：]\s*|stance[:：]\s*)/i, "");
  // 句読点除去
  s = s.replace(/[。、．，.!?！？;；:：]/g, "");
  // 連続空白を単一スペースに
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * 原文から結論部分（最初の文）を抽出し正規化する。
 *
 * LLM は position に「結論。理由。」の形で返すことがある。
 * 合意判定では結論部分のみを比較し、理由の違いによる偽の不一致を防ぐ。
 *
 * 例: "M&Aを進めるべき。シナジー効果でコスト削減が見込める。"
 *   → "m&aを進めるべき"
 */
export function extractConclusion(raw: string): string {
  let s = raw.trim();
  // プレフィックス除去（normalizePosition と同じパターン）
  s = s.replace(/^(結論[:：]\s*|position[:：]\s*|stance[:：]\s*)/i, "");
  // 最初の文末（。．.!！）または改行までを結論とみなす
  const match = s.match(/^([\s\S]+?)[。．.!！\n]/);
  const firstSentence = match ? match[1]!.trim() : s.trim();
  return normalizePosition(firstSentence);
}

/**
 * トークン分割（日本語・英語混在対応）。
 *
 * 日本語は1〜2文字のバイグラム、英語は空白区切りのワード。
 * 簡易的な形態素分割として十分な精度を持つ。
 */
export function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  // 英語ワード
  const words = text.match(/[a-z0-9]+/g);
  if (words) {
    for (const w of words) {
      if (w.length >= 2) tokens.add(w);
    }
  }
  // 日本語文字バイグラム（ひらがな・カタカナ・漢字）
  const jpChars = text.replace(/[a-z0-9\s]/g, "");
  for (let i = 0; i < jpChars.length - 1; i++) {
    tokens.add(jpChars.slice(i, i + 2));
  }
  // 単一文字も追加（短い日本語文に対応）
  for (let i = 0; i < jpChars.length; i++) {
    tokens.add(jpChars[i]!);
  }
  return tokens;
}

/**
 * Jaccard 類似度（0.0〜1.0）。
 * トークン集合の重なりで意味的近さを近似する。
 */
export function jaccardSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
  if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * 意味的にグルーピングされた normalizedPosition を返す。
 *
 * 結論（最初の文）同士の Jaccard 類似度と全文同士の Jaccard 類似度の
 * 両方を計算し、高い方が threshold 以上なら同じクラスタとみなす。
 * 最も重みの大きいクラスタの代表キーに統一する。
 *
 * これにより、「結論は同じだが理由が異なる」ポジションも正しく統合される。
 *
 * @returns 元の normalizedPosition → クラスタ代表キー のマッピング
 */
export function clusterPositions(
  votes: SemanticVote[],
  similarityThreshold: number = 0.5,
): Map<string, string> {
  // 各 normalizedPosition に対して結論を事前計算
  const conclusionMap = new Map<string, string>();
  for (const vote of votes) {
    if (!conclusionMap.has(vote.normalizedPosition)) {
      conclusionMap.set(vote.normalizedPosition, extractConclusion(vote.position));
    }
  }

  const unique = [...new Set(votes.map((v) => v.normalizedPosition))];
  // Union-Find 簡易実装
  const parent = new Map<string, string>();
  for (const u of unique) parent.set(u, u);

  function find(x: string): string {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    // Path compression
    let c = x;
    while (c !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  }

  function union(a: string, b: string): void {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }

  // ペアワイズ比較: 結論同士と全文同士の両方で類似度を計算し、高い方を採用
  for (let i = 0; i < unique.length; i++) {
    for (let j = i + 1; j < unique.length; j++) {
      const fullSim = jaccardSimilarity(unique[i]!, unique[j]!);
      const concSim = jaccardSimilarity(
        conclusionMap.get(unique[i]!)!,
        conclusionMap.get(unique[j]!)!,
      );
      if (Math.max(fullSim, concSim) >= similarityThreshold) {
        union(unique[i]!, unique[j]!);
      }
    }
  }

  // 各クラスタで最も重みの大きい代表を選出
  const clusterWeights = new Map<string, Map<string, number>>();
  for (const vote of votes) {
    const root = find(vote.normalizedPosition);
    if (!clusterWeights.has(root)) clusterWeights.set(root, new Map());
    const members = clusterWeights.get(root)!;
    members.set(vote.normalizedPosition, (members.get(vote.normalizedPosition) ?? 0) + vote.weight);
  }

  const clusterRepresentative = new Map<string, string>();
  for (const [root, members] of clusterWeights) {
    let bestKey = root;
    let bestWeight = -1;
    for (const [key, weight] of members) {
      if (weight > bestWeight) {
        bestKey = key;
        bestWeight = weight;
      }
    }
    clusterRepresentative.set(root, bestKey);
  }

  // 全 position → 代表キーのマッピング
  const mapping = new Map<string, string>();
  for (const u of unique) {
    const root = find(u);
    mapping.set(u, clusterRepresentative.get(root) ?? u);
  }
  return mapping;
}

/** 決定論的ハッシュ（タイブレーク用、Python SHA256 と同等）。 */
function deterministicHash(value: string): string {
  return crypto.createHash("sha256").update(value, "utf-8").digest("hex");
}

/** Harmony レベル分類。 */
export function classifyHarmony(harmonyIndex: number): HarmonyLevel {
  if (harmonyIndex < 0.33) return "dissonance";
  if (harmonyIndex < 0.66) return "partial";
  if (harmonyIndex < 0.9) return "harmony";
  return "perfect";
}

export interface TallyEntry {
  totalWeight: number;
  confidenceSum: number;
  hash: string;
  /** 代表的な原文 position（結果表示用）。 */
  representativePosition: string;
}

/**
 * 投票を normalizedPosition で集計する。
 * [集計結果 Map, 最多得票の正規化キー] を返す。
 *
 * enableClustering=true の場合、Jaccard 類似度でクラスタリングしてから集計。
 * タイブレーク: 重み → 平均 confidence → SHA256 ハッシュ（決定論的）。
 */
export function tallyVotes(
  votes: SemanticVote[],
  options?: { enableClustering?: boolean; similarityThreshold?: number },
): [Map<string, TallyEntry>, string | null] {
  const clustering = options?.enableClustering ?? false;
  const positionMapping = clustering
    ? clusterPositions(votes, options?.similarityThreshold ?? 0.5)
    : null;

  const stateVotes = new Map<string, TallyEntry>();
  let bestKey: string | null = null;
  let bestWeight = -1;
  let bestConfidence = -1;
  let bestHash = "";

  for (const vote of votes) {
    const key = positionMapping
      ? (positionMapping.get(vote.normalizedPosition) ?? vote.normalizedPosition)
      : vote.normalizedPosition;
    const existing = stateVotes.get(key) ?? {
      totalWeight: 0,
      confidenceSum: 0,
      hash: "",
      representativePosition: vote.position,
    };

    existing.totalWeight += vote.weight;
    existing.confidenceSum += vote.confidence * vote.weight;
    existing.hash = deterministicHash(key);
    stateVotes.set(key, existing);

    const avgConfidence = existing.confidenceSum / Math.max(existing.totalWeight, 1e-9);

    if (existing.totalWeight > bestWeight) {
      bestKey = key;
      bestWeight = existing.totalWeight;
      bestConfidence = avgConfidence;
      bestHash = existing.hash;
    } else if (Math.abs(existing.totalWeight - bestWeight) < 1e-6) {
      if (avgConfidence > bestConfidence + 1e-6) {
        bestKey = key;
        bestConfidence = avgConfidence;
        bestHash = existing.hash;
      } else if (Math.abs(avgConfidence - bestConfidence) < 1e-6) {
        if (bestKey === null || existing.hash < bestHash) {
          bestKey = key;
          bestHash = existing.hash;
        }
      }
    }
  }

  return [stateVotes, bestKey];
}

/**
 * クォーラム到達チェック。
 */
export function hasQuorum(
  votes: SemanticVote[],
  expectedWeight: number,
  threshold: number = 0.66,
): boolean {
  if (votes.length === 0) return false;
  if (expectedWeight === 0) return false;

  const [stateVotes, bestKey] = tallyVotes(votes);
  if (!bestKey) return false;

  const best = stateVotes.get(bestKey)!;
  const agreementRate = best.totalWeight / Math.max(expectedWeight, 1.0);
  return agreementRate >= threshold;
}

/**
 * Harmony Index を計算する。
 *
 * Harmony Index = (semantic_similarity × 0.4) + (agreement_rate × 0.6)
 *   - semantic_similarity = 1.0 - (ユニーク正規化ポジション数 - 1) / 投票総数
 *   - agreement_rate = 最大支持重み / 期待総重み
 */
export function calculateHarmony(
  votes: SemanticVote[],
  expectedWeight?: number,
  options?: { enableClustering?: boolean; similarityThreshold?: number },
): ConsensusMetric {
  if (votes.length === 0) {
    return {
      harmonyIndex: 0,
      semanticSimilarity: 0,
      divergenceCount: 0,
      agreementPercentage: 0,
      confidenceScore: 0,
    };
  }

  // 意味的類似度: クラスタリング後のユニーク数で判定
  const clustering = options?.enableClustering ?? false;
  const positionMapping = clustering
    ? clusterPositions(votes, options?.similarityThreshold ?? 0.5)
    : null;

  const effectivePositions = positionMapping
    ? new Set(votes.map((v) => positionMapping.get(v.normalizedPosition) ?? v.normalizedPosition))
    : new Set(votes.map((v) => v.normalizedPosition));

  let similarity = 1.0 - (effectivePositions.size - 1) / Math.max(1, votes.length);
  similarity = Math.max(0, Math.min(1, similarity));

  const totalVoteWeight = votes.reduce((sum, v) => sum + v.weight, 0);
  const expWeight = expectedWeight ?? totalVoteWeight;

  const [stateVotes, bestKey] = tallyVotes(votes, options);

  let agreementRate: number;
  let winnerNormalized: string | null = null;

  if (!bestKey || expWeight === 0) {
    agreementRate = 0;
  } else {
    const best = stateVotes.get(bestKey)!;
    agreementRate = best.totalWeight / Math.max(expWeight, 1.0);
    winnerNormalized = bestKey;
  }

  const agreementPct = agreementRate * 100;

  // 加重平均 confidence
  let avgConfidence: number;
  if (totalVoteWeight === 0) {
    avgConfidence = 0;
  } else {
    avgConfidence = votes.reduce((sum, v) => sum + v.confidence * v.weight, 0) / totalVoteWeight;
  }

  // Harmony Index
  const harmony = similarity * 0.4 + agreementRate * 0.6;

  // 不一致数（クラスタリング時はクラスタ単位で判定）
  let divergent: number;
  if (winnerNormalized !== null) {
    divergent = votes.filter((v) => {
      const effectiveKey = positionMapping
        ? (positionMapping.get(v.normalizedPosition) ?? v.normalizedPosition)
        : v.normalizedPosition;
      return effectiveKey !== winnerNormalized;
    }).length;
  } else {
    divergent = votes.length;
  }

  return {
    harmonyIndex: Math.min(1, Math.max(0, harmony)),
    semanticSimilarity: similarity,
    divergenceCount: divergent,
    agreementPercentage: agreementPct,
    confidenceScore: avgConfidence * harmony,
  };
}
