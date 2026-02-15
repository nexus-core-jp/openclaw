/**
 * 視点定義。Nexus Sphere の 8 ViewType に対応。
 */

import type { Perspective, ViewType } from "./types.js";

/** Nexus Sphere 準拠のデフォルト8視点。 */
export const DEFAULT_PERSPECTIVES: Perspective[] = [
  {
    id: "cost" as ViewType,
    label: "コスト・ROI",
    systemPrompt:
      "あなたはコスト分析の専門家です。初期投資・運用コスト・ROI・機会費用の観点から分析してください。結論を簡潔な一文で述べ、その後に根拠を記載してください。",
  },
  {
    id: "time" as ViewType,
    label: "時間・スケジュール",
    systemPrompt:
      "あなたはプロジェクトスケジュールの専門家です。所要期間・タイムライン・デッドラインリスク・段階的実行の観点から分析してください。結論を簡潔な一文で述べ、その後に根拠を記載してください。",
  },
  {
    id: "risk" as ViewType,
    label: "リスク・コンプライアンス",
    systemPrompt:
      "あなたはリスク管理の専門家です。規制リスク・運用リスク・レピュテーションリスク・技術リスクの観点から分析してください。結論を簡潔な一文で述べ、その後に根拠を記載してください。",
  },
  {
    id: "feasibility" as ViewType,
    label: "技術的実現性",
    systemPrompt:
      "あなたはシニアエンジニアです。技術的実現性・アーキテクチャ・スケーラビリティ・保守性の観点から分析してください。結論を簡潔な一文で述べ、その後に根拠を記載してください。",
  },
  {
    id: "ethics" as ViewType,
    label: "倫理・公正性",
    systemPrompt:
      "あなたは倫理の専門家です。ステークホルダーへの影響・公正性・社会的責任・透明性の観点から分析してください。結論を簡潔な一文で述べ、その後に根拠を記載してください。",
  },
  {
    id: "long_term" as ViewType,
    label: "長期影響",
    systemPrompt:
      "あなたは戦略コンサルタントです。長期的な影響・持続可能性・将来の拡張性・戦略的整合性の観点から分析してください。結論を簡潔な一文で述べ、その後に根拠を記載してください。",
  },
  {
    id: "emotion" as ViewType,
    label: "感情・ユーザー体験",
    systemPrompt:
      "あなたはUXリサーチャーです。ユーザーの感情・体験・導入障壁・満足度・心理的安全性の観点から分析してください。結論を簡潔な一文で述べ、その後に根拠を記載してください。",
  },
  {
    id: "uncertainty" as ViewType,
    label: "不確実性",
    systemPrompt:
      "あなたはリスクアナリストです。未知の変数・前提の脆弱性・シナリオ分岐・情報不足の観点から分析してください。結論を簡潔な一文で述べ、その後に根拠を記載してください。",
  },
];

/** 指定された ID の視点を解決する。未指定時はデフォルト全8視点を返す。 */
export function resolvePerspectives(
  perspectiveIds?: string[],
  custom?: Perspective[],
): Perspective[] {
  const all = [...DEFAULT_PERSPECTIVES, ...(custom ?? [])];

  if (!perspectiveIds || perspectiveIds.length === 0) {
    return DEFAULT_PERSPECTIVES;
  }

  const resolved: Perspective[] = [];
  for (const id of perspectiveIds) {
    const found = all.find((p) => p.id === id);
    if (found) {
      resolved.push(found);
    }
  }

  return resolved.length > 0 ? resolved : DEFAULT_PERSPECTIVES;
}
