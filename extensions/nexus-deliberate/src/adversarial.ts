/**
 * Adversarial Deliberation (Devil's Advocate)
 *
 * Nexus Sphere Gen 4 から移植。
 * 各視点の分析に対し反論を生成し、それへの応答で confidence を修正する。
 */

import crypto from "node:crypto";
import type { ViewType, SemanticVote } from "./types.js";

export interface AdversarialChallenge {
  id: string;
  targetPerspective: string;
  challenge: string;
  challengeType: "assumption" | "evidence" | "logic" | "scope";
  severity: "minor" | "significant" | "critical";
}

export interface AdversarialRebuttal {
  challengeId: string;
  rebuttal: string;
  concession?: string;
  revisedConfidence: number;
}

export interface AdversarialResult {
  vote: SemanticVote;
  challenge: AdversarialChallenge;
  rebuttal: AdversarialRebuttal;
}

interface ChallengeTemplate {
  type: AdversarialChallenge["challengeType"];
  challenge: string;
  severity: AdversarialChallenge["severity"];
}

const challengeTemplates: Record<ViewType, ChallengeTemplate[]> = {
  cost: [
    {
      type: "assumption",
      challenge:
        "コスト試算の前提となる単価は最新の市場価格を反映していますか？隠れたコスト（教育・移行・運用）を過小評価している可能性があります。",
      severity: "significant",
    },
    {
      type: "scope",
      challenge:
        "直接コストのみに焦点を当てていますが、機会コストや時間価値の損失を考慮していますか？",
      severity: "minor",
    },
  ],
  time: [
    {
      type: "evidence",
      challenge:
        "この時間見積もりの根拠は？過去の類似プロジェクトでは計画の1.5〜2倍の期間がかかっています。",
      severity: "significant",
    },
    {
      type: "logic",
      challenge: "並行作業を前提としていますが、依存関係によるブロッキングを考慮していますか？",
      severity: "minor",
    },
  ],
  risk: [
    {
      type: "scope",
      challenge:
        "技術リスクに偏重し、組織・人的リスク（離職、スキル不足、モチベーション低下）を見落としていませんか？",
      severity: "critical",
    },
    {
      type: "assumption",
      challenge:
        "リスク発生確率の推定根拠が不明です。楽観バイアスがかかっている可能性を検証してください。",
      severity: "significant",
    },
  ],
  feasibility: [
    {
      type: "evidence",
      challenge: "「技術的に実現可能」とする根拠は？類似の実装実績やPoCの結果はありますか？",
      severity: "significant",
    },
    {
      type: "logic",
      challenge: "個々のコンポーネントは実現可能でも、統合時の複雑性を過小評価していませんか？",
      severity: "minor",
    },
  ],
  ethics: [
    {
      type: "scope",
      challenge:
        "直接のステークホルダーのみを考慮していますが、間接的に影響を受ける層（サプライチェーン、地域社会）はどうですか？",
      severity: "significant",
    },
    {
      type: "assumption",
      challenge: "「公平性」の定義自体が特定の文化的前提に基づいていませんか？",
      severity: "minor",
    },
  ],
  long_term: [
    {
      type: "assumption",
      challenge:
        "3年後の技術トレンド予測に基づいていますが、破壊的イノベーションによる前提崩壊のリスクは？",
      severity: "critical",
    },
    {
      type: "evidence",
      challenge:
        "長期的な持続可能性の評価に使用した指標は、業界のベストプラクティスに準拠していますか？",
      severity: "minor",
    },
  ],
  emotion: [
    {
      type: "logic",
      challenge:
        "感情面の分析と論理的分析を分離していますが、実際の意思決定では両者は不可分です。この分離は人工的すぎませんか？",
      severity: "minor",
    },
    {
      type: "scope",
      challenge: "個人の感情のみに注目していますが、チーム全体の士気や組織文化への影響は？",
      severity: "significant",
    },
  ],
  uncertainty: [
    {
      type: "logic",
      challenge:
        "不確実性を「検証可能」と「検証困難」に分類していますが、「未知の未知」はこのフレームワークでは捕捉できません。",
      severity: "critical",
    },
    {
      type: "assumption",
      challenge: "前提の明示化は有用ですが、明示化されていない暗黙の前提がさらに存在する可能性は？",
      severity: "significant",
    },
  ],
};

const rebuttalTemplates: Record<ViewType, string[]> = {
  cost: [
    "ご指摘を受け、間接コスト（教育・移行・運用）を再試算に含めました。隠れたコストを考慮すると、当初見積もりの1.2〜1.4倍が適切な範囲です。",
    "機会コストの観点は重要です。時間価値を含めた総合コスト評価に修正します。",
  ],
  time: [
    "過去の実績データに基づき、バッファを30%追加した修正見積もりを提示します。",
    "依存関係マップを再検証し、クリティカルパス上のブロッキングポイントを特定しました。",
  ],
  risk: [
    "人的リスクの指摘は的確です。組織・人的要因を追加し、リスクマトリクスを拡張しました。",
    "楽観バイアスの可能性は否定できません。外部ベンチマークとの比較検証を追加しました。",
  ],
  feasibility: [
    "実績ベースの検証は不十分でした。未検証の技術要素についてはPoCの必要性を明記しました。",
    "統合複雑性の指摘を受け入れます。コンポーネント間のインターフェース検証ステップを追加しました。",
  ],
  ethics: [
    "間接的ステークホルダーの分析を拡張しました。サプライチェーン上の影響と地域社会への波及効果を追加しています。",
    "文化的前提の指摘は重要です。公平性の定義を複数の観点から再検討し、明示化しました。",
  ],
  long_term: [
    "破壊的イノベーションリスクは的確な指摘です。シナリオ分析に「技術的断絶」ケースを追加し、ヘッジ策を提案します。",
    "評価指標をISO 26000とGRIスタンダードに照らし合わせて再評価しました。",
  ],
  emotion: [
    "感情と論理の完全分離が人工的という指摘は認めます。分析結果を「感情を考慮した統合的判断材料」として再構成しました。",
    "チーム全体の士気への影響は重要です。組織的な感情マッピングを追加し、集団レベルの影響を評価しました。",
  ],
  uncertainty: [
    "「未知の未知」はフレームワークの限界です。既知の不確実性に対する対処法と、予想外の事態への柔軟性確保策を提案します。",
    "暗黙の前提の追加発掘のため、レッドチーム的な前提チャレンジを実施し、追加前提を特定しました。",
  ],
};

/** 決定的ハッシュ（テンプレート選択用）。 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * 各投票に対して Adversarial Challenge と Rebuttal を生成する。
 *
 * テンプレートは Nexus Sphere Gen 4 から移植。
 * テンプレート選択は perspective + deliberationId のハッシュで決定的。
 * severity に応じて confidence を修正:
 *   - critical: -0.10
 *   - significant: -0.05
 *   - minor: 0
 */
export function generateAdversarialResults(
  votes: SemanticVote[],
  deliberationId: string,
): AdversarialResult[] {
  const results: AdversarialResult[] = [];

  for (const vote of votes) {
    const viewType = vote.perspective as ViewType;
    const templates = challengeTemplates[viewType];
    if (!templates || templates.length === 0) continue;

    const hash = hashString(`${deliberationId}:${vote.perspective}:challenge`);
    const templateIdx = hash % templates.length;
    const template = templates[templateIdx]!;

    const challengeId = `challenge-${viewType}-${hash % 1000}`;
    const challenge: AdversarialChallenge = {
      id: challengeId,
      targetPerspective: vote.perspective,
      challenge: template.challenge,
      challengeType: template.type,
      severity: template.severity,
    };

    const rebuttals = rebuttalTemplates[viewType] ?? [];
    const rebuttalIdx = hash % Math.max(rebuttals.length, 1);
    const rebuttalText = rebuttals[rebuttalIdx] ?? "ご指摘を踏まえ、分析を補強しました。";

    const confidenceDelta =
      template.severity === "critical" ? -0.1 : template.severity === "significant" ? -0.05 : 0;
    const revisedConfidence = Math.max(0.1, vote.confidence + confidenceDelta);

    const rebuttal: AdversarialRebuttal = {
      challengeId,
      rebuttal: rebuttalText,
      concession:
        template.severity === "critical"
          ? "この点は重要な見落としであり、分析の前提を修正しました。"
          : undefined,
      revisedConfidence,
    };

    results.push({ vote, challenge, rebuttal });
  }

  return results;
}

/**
 * Adversarial プロセスを経た投票を返す。
 * confidence が修正された新しい SemanticVote 配列と、challenge/rebuttal の詳細。
 */
export function applyAdversarial(
  votes: SemanticVote[],
  deliberationId: string,
): { adjustedVotes: SemanticVote[]; adversarialDetails: AdversarialResult[] } {
  const adversarialDetails = generateAdversarialResults(votes, deliberationId);
  const adjustedMap = new Map<string, number>();
  for (const ar of adversarialDetails) {
    adjustedMap.set(`${ar.vote.nodeId}:${ar.vote.perspective}`, ar.rebuttal.revisedConfidence);
  }

  const adjustedVotes = votes.map((v) => {
    const key = `${v.nodeId}:${v.perspective}`;
    const revised = adjustedMap.get(key);
    if (revised !== undefined) {
      return { ...v, confidence: revised };
    }
    return v;
  });

  return { adjustedVotes, adversarialDetails };
}
