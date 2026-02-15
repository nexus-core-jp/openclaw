/**
 * プロダクトシミュレーションテスト
 *
 * 想定ユーザー3パターンでエンドツーエンドのフローをシミュレート:
 *   1. スタートアップ CTO — 技術選定の合議
 *   2. プロダクトマネージャー — 新機能の優先度判断
 *   3. 経営企画 — M&A 判断の多角的分析
 *
 * 各シナリオで orchestrator を通さず、
 * consensus エンジン + adversarial を直接テストする。
 */

import { describe, expect, it } from "vitest";
import type { SemanticVote, ViewType } from "./types.js";
import { applyAdversarial } from "./adversarial.js";
import {
  normalizePosition,
  extractConclusion,
  calculateHarmony,
  classifyHarmony,
  tallyVotes,
  clusterPositions,
  jaccardSimilarity,
} from "./consensus/harmony.js";
import { checkWeightedQuorum } from "./consensus/weighted-quorum.js";
import { resolvePerspectives } from "./perspectives.js";

function makeVote(
  perspective: ViewType,
  position: string,
  opts?: { confidence?: number; weight?: number; nodeId?: string },
): SemanticVote {
  return {
    nodeId: opts?.nodeId ?? "anthropic/claude-sonnet-4-5-20250929",
    position,
    normalizedPosition: normalizePosition(position),
    reasoning: `${perspective} の観点から分析した結果。`,
    confidence: opts?.confidence ?? 0.8,
    weight: opts?.weight ?? 1.0,
    perspective,
    timestamp: new Date().toISOString(),
  };
}

// ─── シナリオ 1: スタートアップ CTO — 技術選定 ──────────────

describe("シナリオ1: スタートアップCTO — Rust vs Go の技術選定", () => {
  // LLM が返す想定応答をシミュレート
  // プロンプトは「簡潔な一文の結論」を指示するため、position は短い第一文 + 補足 の形式
  const votes: SemanticVote[] = [
    makeVote("cost", "Goを採用すべき。コスト面で有利で採用市場が広い。", {
      nodeId: "openai/gpt-4o",
    }),
    makeVote("time", "Goを採用すべき。学習コストが低く開発速度が速い。", {
      nodeId: "anthropic/claude-sonnet-4-5-20250929",
    }),
    makeVote("risk", "Goを採用すべき。エコシステムが成熟しておりリスクが低い。", {
      nodeId: "openai/gpt-4o",
    }),
    makeVote("feasibility", "Goを採用すべき。チームのスキルセットに合致する。", {
      nodeId: "google/gemini-pro",
    }),
    makeVote("ethics", "どちらも倫理的に問題ない。チームの意向を尊重すべき。", { confidence: 0.6 }),
    makeVote("long_term", "Rustが長期的に有利。パフォーマンスと保守性で優れる。", {
      nodeId: "anthropic/claude-sonnet-4-5-20250929",
    }),
    makeVote("emotion", "Goを採用すべき。チームの親和性が高く不安が少ない。", { confidence: 0.7 }),
    makeVote("uncertainty", "技術トレンドは不確実。どちらにも確証はない。", { confidence: 0.5 }),
  ];

  it("正規化と結論抽出が正しく機能すること", () => {
    // normalizePosition: 句読点除去、小文字化
    const costNorm = votes[0]!.normalizedPosition;
    expect(costNorm).not.toContain("。");

    // extractConclusion: 最初の文を抽出して正規化
    const costConc = extractConclusion(votes[0]!.position);
    const timeConc = extractConclusion(votes[1]!.position);
    // 両方とも結論は「goを採用すべき」
    expect(costConc).toBe(timeConc);
  });

  it("クラスタリングで「Go推奨」系の意見がグループ化されること", () => {
    const goVotes = votes.filter((v) => v.normalizedPosition.includes("go"));
    // cost, time, risk, feasibility, emotion が Go 寄り
    expect(goVotes.length).toBeGreaterThanOrEqual(5);

    const mapping = clusterPositions(votes, 0.3);
    // 結論抽出により「Goを採用すべき」の結論を持つ投票が統合される
    const uniqueClusters = new Set(votes.map((v) => mapping.get(v.normalizedPosition)));
    expect(uniqueClusters.size).toBeLessThan(votes.length);
  });

  it("Harmony Index が partial 以上であること（Go が多数派）", () => {
    const consensus = calculateHarmony(votes, undefined, {
      enableClustering: true,
      similarityThreshold: 0.3,
    });
    // 5/8 が「Goを採用すべき」で統合されるため、harmony は高い
    expect(consensus.harmonyIndex).toBeGreaterThan(0.5);
    expect(consensus.agreementPercentage).toBeGreaterThan(50);
  });

  it("Adversarial で confidence が適切に修正されること", () => {
    const { adjustedVotes, adversarialDetails } = applyAdversarial(votes, "sim-cto-001");
    expect(adversarialDetails.length).toBe(8);

    // critical challenge を受けた視点は confidence が下がる
    const riskDetail = adversarialDetails.find((d) => d.vote.perspective === "risk");
    expect(riskDetail).toBeTruthy();
    if (riskDetail?.challenge.severity === "critical") {
      expect(riskDetail.rebuttal.revisedConfidence).toBeLessThan(riskDetail.vote.confidence);
    }

    // 全体の confidence は元より低い（反論を経て慎重に）
    const origAvg = votes.reduce((s, v) => s + v.confidence, 0) / votes.length;
    const adjAvg = adjustedVotes.reduce((s, v) => s + v.confidence, 0) / adjustedVotes.length;
    expect(adjAvg).toBeLessThanOrEqual(origAvg);
  });

  it("Quorum 判定が機能すること", () => {
    const quorum = checkWeightedQuorum(votes, 0.66, {
      enableClustering: true,
      similarityThreshold: 0.3,
    });
    expect(typeof quorum.hasQuorum).toBe("boolean");
    expect(quorum.totalWeight).toBe(8.0); // 8視点 × 1.0
    expect(quorum.winningPosition).toBeTruthy();
  });
});

// ─── シナリオ 2: PM — 新機能の優先度判断 ────────────────────

describe("シナリオ2: PM — チャット機能 vs 分析ダッシュボード", () => {
  const votes: SemanticVote[] = [
    makeVote("cost", "チャット機能の方が開発コストが低い。ダッシュボードはデータ基盤が必要。"),
    makeVote("time", "チャット機能なら2スプリントで出せる。ダッシュボードは最低4スプリント。"),
    makeVote("risk", "ダッシュボードはデータの正確性に関するリスクが高い。"),
    makeVote("feasibility", "チャット機能は既存のWebSocket基盤を活用できる。"),
    makeVote("ethics", "どちらもユーザーのプライバシーに配慮が必要。"),
    makeVote("long_term", "ダッシュボードの方が長期的な差別化要因になる。"),
    makeVote("emotion", "ユーザーインタビューではチャット機能への期待が大きい。"),
    makeVote("uncertainty", "競合の動向次第でダッシュボードの優先度が変わる可能性。"),
  ];

  it("全8視点が揃うこと", () => {
    const perspectives = resolvePerspectives();
    expect(perspectives).toHaveLength(8);
    expect(votes).toHaveLength(8);
  });

  it("チャット推奨が多数派として検出されること", () => {
    const consensus = calculateHarmony(votes, undefined, {
      enableClustering: true,
      similarityThreshold: 0.3,
    });
    // チャット推奨が cost, time, feasibility, emotion で多数
    expect(consensus.divergenceCount).toBeLessThan(votes.length);
  });

  it("完全な DeliberationResult 相当の構造が組み立て可能なこと", () => {
    const consensus = calculateHarmony(votes);
    const harmonyLevel = classifyHarmony(consensus.harmonyIndex);
    const quorum = checkWeightedQuorum(votes, 0.66);
    const { adjustedVotes, adversarialDetails } = applyAdversarial(votes, "sim-pm-001");

    // 結果構造体の検証
    expect(consensus.harmonyIndex).toBeGreaterThanOrEqual(0);
    expect(consensus.harmonyIndex).toBeLessThanOrEqual(1);
    expect(["dissonance", "partial", "harmony", "perfect"]).toContain(harmonyLevel);
    expect(typeof quorum.hasQuorum).toBe("boolean");
    expect(adversarialDetails).toHaveLength(8);
    expect(adjustedVotes).toHaveLength(8);
  });
});

// ─── シナリオ 3: 経営企画 — 全会一致シナリオ ────────────────

describe("シナリオ3: 経営企画 — 全会一致ケース", () => {
  const votes: SemanticVote[] = [
    makeVote("cost", "M&Aを進めるべき。シナジー効果でコスト削減が見込める。"),
    makeVote("time", "M&Aを進めるべき。市場の窓が開いている今がタイミング。"),
    makeVote("risk", "M&Aを進めるべき。リスクは管理可能な範囲。"),
    makeVote("feasibility", "M&Aを進めるべき。統合の技術的障壁は低い。"),
    makeVote("ethics", "M&Aを進めるべき。従業員への影響は最小限に抑えられる。"),
    makeVote("long_term", "M&Aを進めるべき。長期的な成長戦略に合致。"),
    makeVote("emotion", "M&Aを進めるべき。チームの士気向上が期待できる。"),
    makeVote("uncertainty", "M&Aを進めるべき。不確実性は許容範囲。"),
  ];

  it("全会一致で perfect harmony が得られること", () => {
    const consensus = calculateHarmony(votes, undefined, {
      enableClustering: true,
      similarityThreshold: 0.3,
    });
    expect(consensus.harmonyIndex).toBeGreaterThan(0.85);
    expect(classifyHarmony(consensus.harmonyIndex)).toMatch(/harmony|perfect/);
    expect(consensus.divergenceCount).toBeLessThanOrEqual(1);
  });

  it("Quorum が確実に達成されること", () => {
    const quorum = checkWeightedQuorum(votes, 0.66, {
      enableClustering: true,
      similarityThreshold: 0.3,
    });
    expect(quorum.hasQuorum).toBe(true);
    expect(quorum.supportRatio).toBeGreaterThan(0.8);
  });

  it("Adversarial 後も高い合意水準を維持すること", () => {
    const { adjustedVotes } = applyAdversarial(votes, "sim-ma-001");
    const postAdversarial = calculateHarmony(adjustedVotes, undefined, {
      enableClustering: true,
      similarityThreshold: 0.3,
    });
    // Adversarial で confidence は下がるが、harmony level は維持されるべき
    expect(postAdversarial.harmonyIndex).toBeGreaterThan(0.6);
  });
});

// ─── シナリオ 4: 完全分裂ケース ─────────────────────────────

describe("シナリオ4: 全視点が異なる結論を出すケース", () => {
  const votes: SemanticVote[] = [
    makeVote("cost", "プランAが最もコスト効率が良い"),
    makeVote("time", "プランBがスケジュール的に最適"),
    makeVote("risk", "プランCがリスクが最も低い"),
    makeVote("feasibility", "プランDが技術的に最も実現可能"),
    makeVote("ethics", "プランEが倫理的に最も望ましい"),
    makeVote("long_term", "プランFが長期的に最も有利"),
    makeVote("emotion", "プランGがチームの満足度が最も高い"),
    makeVote("uncertainty", "プランHが不確実性が最も低い"),
  ];

  it("dissonance と判定されること", () => {
    const consensus = calculateHarmony(votes);
    expect(consensus.harmonyIndex).toBeLessThan(0.33);
    expect(classifyHarmony(consensus.harmonyIndex)).toBe("dissonance");
  });

  it("Quorum が不成立であること", () => {
    const quorum = checkWeightedQuorum(votes, 0.66);
    expect(quorum.hasQuorum).toBe(false);
  });

  it("divergenceCount が最大に近いこと", () => {
    const consensus = calculateHarmony(votes);
    expect(consensus.divergenceCount).toBeGreaterThanOrEqual(6);
  });
});

// ─── シナリオ 5: 重み付き投票（シニアの意見が重い）─────────

describe("シナリオ5: 重み付き投票", () => {
  const votes: SemanticVote[] = [
    makeVote("cost", "コスト削減を優先すべき", { weight: 3.0, nodeId: "senior/architect" }),
    makeVote("time", "スピードを優先すべき", { weight: 1.0 }),
    makeVote("risk", "コスト削減を優先すべき", { weight: 2.0, nodeId: "senior/risk" }),
    makeVote("feasibility", "スピードを優先すべき", { weight: 1.0 }),
  ];

  it("重みの大きいシニアの意見が勝つこと", () => {
    const quorum = checkWeightedQuorum(votes, 0.5);
    expect(quorum.hasQuorum).toBe(true);
    // コスト削減 = 3.0 + 2.0 = 5.0, スピード = 1.0 + 1.0 = 2.0
    expect(quorum.supportWeight).toBe(5.0);
    expect(quorum.winningPosition).toContain("コスト削減");
  });
});

// ─── シナリオ 6: 日本語表記ゆれの吸収テスト ────────────────

describe("シナリオ6: 日本語表記ゆれの吸収", () => {
  it("同じ意味の異なる表現がクラスタリングで統合されること", () => {
    const votes: SemanticVote[] = [
      makeVote("cost", "技術的に実現可能である"),
      makeVote("time", "技術的に実現可能です"),
      makeVote("risk", "技術面で実現可能"),
      makeVote("feasibility", "全く別の結論です"),
    ];

    // Jaccard 類似度の確認
    const sim1 = jaccardSimilarity(
      normalizePosition("技術的に実現可能である"),
      normalizePosition("技術的に実現可能です"),
    );
    expect(sim1).toBeGreaterThan(0.5);

    // クラスタリングの確認
    const mapping = clusterPositions(votes, 0.4);
    const cluster1 = mapping.get(votes[0]!.normalizedPosition);
    const cluster2 = mapping.get(votes[1]!.normalizedPosition);
    const cluster4 = mapping.get(votes[3]!.normalizedPosition);

    // 類似した表現は同じクラスタ
    expect(cluster1).toBe(cluster2);
    // 異なる表現は別クラスタ
    expect(cluster1).not.toBe(cluster4);
  });
});
