/**
 * Nexus Sphere フロントエンド互換レイヤー
 *
 * nexus-deliberate の DeliberationResult を Nexus Sphere の
 * HybridExecuteResponse / Deliberation 型に変換する。
 *
 * 参照: Nexus-sphere/frontend-chat/src/app/api/hybrid/execute/types.ts
 *
 * フロントエンドの制約:
 *   - ChatMain.tsx L295: deliberation = data?.deliberation (ラッパー必須)
 *   - ChatMain.tsx L252: deliberation:complete で HybridExecuteResponse を期待
 *   - DeliberationMinutes.tsx L81: participants.length === 0 で null 返却
 *   - DeliberationMinutes.tsx L291: participant_id でステップを参加者に紐付け
 */

import type { DeliberationResult, ViewType } from "../types.js";
import { DEFAULT_PERSPECTIVES } from "../perspectives.js";

// ─── Nexus Sphere Compatible Types ──────────────────────────
// frontend-chat/src/app/api/hybrid/execute/types.ts と完全一致

export type NsDeliberationParticipant = {
  id: string;
  role: string;
  perspective: string;
};

export type NsAdversarialChallenge = {
  id: string;
  target_participant_id: string;
  challenge: string;
  challenge_type: "assumption" | "evidence" | "logic" | "scope";
  severity: "minor" | "significant" | "critical";
};

export type NsAdversarialRebuttal = {
  challenge_id: string;
  rebuttal: string;
  concession?: string;
  revised_confidence: number;
};

export type NsDeliberationStep = {
  participant_id: string;
  analysis: string;
  confidence: number;
  key_points: string[];
  concerns?: string[];
  challenge?: NsAdversarialChallenge;
  rebuttal?: NsAdversarialRebuttal;
};

export type NsDeliberationSynthesis = {
  method: string;
  agreements: string[];
  tensions: string[];
  resolution: string;
};

export type NsDeliberation = {
  participants: NsDeliberationParticipant[];
  steps: NsDeliberationStep[];
  synthesis: NsDeliberationSynthesis;
  depth: number;
  total_perspectives: number;
  processing_time_ms: number;
  adversarial_enabled?: boolean;
};

export type NsSection = {
  id: string;
  type: "empathy" | "extraction" | "structure" | "questions" | "options";
  role: "listener" | "organizer" | "skeptic" | "facilitator";
  title: string;
  content?: string;
  bullets?: string[];
  confidence?: number;
  derived_from: Array<"assumptions" | "views" | "mode_transition">;
};

export type NsHybridExecuteResponse = {
  trace_id: string;
  mode: "empathy" | "think" | "wallcheck" | "decide";
  status: "ok" | "error";
  meta: {
    version: "arcus-v1.0";
    model: string;
    created_at: string;
    principles: ["non_judgement", "external_decider", "neutrality"];
  };
  cognitive_trace: {
    mode_path: Array<"empathy" | "think" | "wallcheck" | "decide">;
    activated_views: ViewType[];
    suppressed_views: Array<{
      view: ViewType;
      reason: "not_requested" | "insufficient_information";
    }>;
    assumptions_used: string[];
    decision_boundary: {
      reached: boolean;
      stop_reason?: string;
      blocked_by?: "multi_perspective_deliberation";
    };
    selected_style: "gentle" | "clear" | "organize_only";
    overall_confidence: number;
  };
  sections: NsSection[];
  guardrails: {
    did_not_do: Array<"make_final_decision" | "recommend_single_option" | "override_user_values">;
    triggered_rules: Array<"multi_perspective_deliberation">;
  };
  deliberation?: NsDeliberation;
};

// ─── Helper Maps ─────────────────────────────────────────────

const PERSPECTIVE_META: Record<string, { role: string; perspective: string }> = {};
for (const p of DEFAULT_PERSPECTIVES) {
  // role = label, perspective = systemPrompt の第一文
  const firstSentence = p.systemPrompt.split(/[。．.]/)[0] ?? p.label;
  PERSPECTIVE_META[p.id] = {
    role: p.label,
    perspective: firstSentence,
  };
}

const VALID_VIEW_TYPES = new Set<string>([
  "cost",
  "time",
  "risk",
  "feasibility",
  "ethics",
  "long_term",
  "emotion",
  "uncertainty",
]);

// ─── Extraction Helpers ──────────────────────────────────────

/** reasoning テキストからキーポイントを抽出する */
export function extractKeyPoints(reasoning: string): string[] {
  if (!reasoning) return [];
  return reasoning
    .split(/[。．.\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** 合意点を抽出する */
function extractAgreements(result: DeliberationResult): string[] {
  const agreements: string[] = [];

  if (result.conclusion) {
    agreements.push(result.conclusion);
  }

  if (result.consensus.agreementPercentage > 50) {
    agreements.push(`${result.consensus.agreementPercentage.toFixed(0)}% の視点が同じ方向性を支持`);
  }

  if (result.harmonyLevel === "harmony" || result.harmonyLevel === "perfect") {
    agreements.push("高い合意水準を達成");
  }

  return agreements;
}

/** 緊張点を抽出する */
function extractTensions(result: DeliberationResult): string[] {
  const tensions: string[] = [];

  if (result.consensus.divergenceCount > 0) {
    tensions.push(`${result.consensus.divergenceCount} 件の異なる見解あり`);
  }

  if (result.harmonyLevel === "dissonance") {
    tensions.push("視点間の合意が得られていません");
  }

  if (result.adversarialDetails) {
    const criticals = result.adversarialDetails.filter((d) => d.severity === "critical");
    if (criticals.length > 0) {
      tensions.push(`${criticals.length} 件の重要な反論が提起されました`);
    }
  }

  return tensions;
}

// ─── Conversion Functions ────────────────────────────────────

/** SemanticVote → NsDeliberationParticipant */
function toParticipant(perspective: string): NsDeliberationParticipant {
  const meta = PERSPECTIVE_META[perspective] ?? {
    role: perspective,
    perspective: perspective,
  };
  return {
    id: `participant-${perspective}`,
    role: meta.role,
    perspective: meta.perspective,
  };
}

/** SemanticVote + adversarial → NsDeliberationStep */
function toStep(
  vote: DeliberationResult["votes"][0],
  adversarial?: DeliberationResult["adversarialDetails"] extends Array<infer T> | undefined
    ? T
    : never,
): NsDeliberationStep {
  const participantId = `participant-${vote.perspective}`;
  const keyPoints = extractKeyPoints(vote.reasoning);

  const step: NsDeliberationStep = {
    participant_id: participantId,
    analysis: vote.reasoning ? `${vote.position}\n\n${vote.reasoning}` : vote.position,
    confidence: vote.confidence,
    key_points: keyPoints.length > 0 ? keyPoints : [vote.position],
  };

  if (adversarial) {
    const challengeId = `challenge-${vote.perspective}`;
    step.challenge = {
      id: challengeId,
      target_participant_id: participantId,
      challenge: adversarial.challenge,
      challenge_type: adversarial.challengeType as NsAdversarialChallenge["challenge_type"],
      severity: adversarial.severity as NsAdversarialChallenge["severity"],
    };
    step.rebuttal = {
      challenge_id: challengeId,
      rebuttal: adversarial.rebuttal,
      concession: adversarial.concession,
      revised_confidence: adversarial.revisedConfidence,
    };
  }

  return step;
}

/** sections を構築する（ChatMain.tsx のレンダリングに必要） */
function buildSections(result: DeliberationResult): NsSection[] {
  const sections: NsSection[] = [];

  // Section 1: 多角的分析の概要
  sections.push({
    id: "analysis",
    type: "extraction",
    role: "organizer",
    title: "多角的分析",
    content: `${result.perspectives.length}つの視点から分析を実施しました。`,
    bullets: result.votes.map((v) => {
      const label = PERSPECTIVE_META[v.perspective]?.role ?? v.perspective;
      return `${label}: ${v.position}`;
    }),
    derived_from: ["views"],
  });

  // Section 2: 統合結果
  if (result.conclusion) {
    sections.push({
      id: "synthesis",
      type: "structure",
      role: "facilitator",
      title: "統合",
      content: result.conclusion,
      confidence: result.consensus.harmonyIndex,
      derived_from: ["views", "assumptions"],
    });
  }

  // Section 3: Adversarial 結果（存在する場合）
  if (result.adversarialDetails && result.adversarialDetails.length > 0) {
    const criticals = result.adversarialDetails.filter((d) => d.severity === "critical");
    if (criticals.length > 0) {
      sections.push({
        id: "adversarial",
        type: "questions",
        role: "skeptic",
        title: "重要な反論",
        bullets: criticals.map(
          (d) => `${PERSPECTIVE_META[d.perspective]?.role ?? d.perspective}: ${d.challenge}`,
        ),
        derived_from: ["views"],
      });
    }
  }

  return sections;
}

/**
 * DeliberationResult → NsDeliberation
 *
 * Nexus Sphere の DeliberationMinutes.tsx が期待する形式に変換。
 */
export function toDeliberation(
  result: DeliberationResult,
  processingTimeMs: number,
): NsDeliberation {
  // 参加者（perspective ごとに一意）
  const seen = new Set<string>();
  const participants: NsDeliberationParticipant[] = [];
  for (const vote of result.votes) {
    const key = vote.perspective as string;
    if (!seen.has(key)) {
      seen.add(key);
      participants.push(toParticipant(key));
    }
  }

  // Adversarial 詳細を perspective でインデックス化
  const adversarialMap = new Map<
    string,
    NonNullable<DeliberationResult["adversarialDetails"]>[number]
  >();
  if (result.adversarialDetails) {
    for (const ad of result.adversarialDetails) {
      adversarialMap.set(ad.perspective, ad);
    }
  }

  // ステップ
  const steps = result.votes.map((vote) =>
    toStep(vote, adversarialMap.get(vote.perspective as string)),
  );

  // 統合
  const synthesis: NsDeliberationSynthesis = {
    method: `harmony_index (${result.harmonyLevel})`,
    agreements: extractAgreements(result),
    tensions: extractTensions(result),
    resolution: result.conclusion ?? "合意に至りませんでした。さらなる議論が必要です。",
  };

  return {
    participants,
    steps,
    synthesis,
    depth: result.votes.length > 1 ? 1 : 0,
    total_perspectives: result.perspectives.length,
    processing_time_ms: processingTimeMs,
    adversarial_enabled: result.adversarialEnabled,
  };
}

/**
 * DeliberationResult → NsHybridExecuteResponse
 *
 * ChatMain.tsx が期待する完全なレスポンス形式。
 * SSE の deliberation:complete イベントおよび非ストリーミング応答で使用。
 */
export function toHybridExecuteResponse(
  result: DeliberationResult,
  processingTimeMs: number,
): NsHybridExecuteResponse {
  const deliberation = toDeliberation(result, processingTimeMs);

  const activatedViews = result.perspectives.filter((p) => VALID_VIEW_TYPES.has(p)) as ViewType[];

  return {
    trace_id: result.id,
    mode: "decide",
    status: "ok",
    meta: {
      version: "arcus-v1.0",
      model: result.participants.join(", "),
      created_at: result.timestamp,
      principles: ["non_judgement", "external_decider", "neutrality"],
    },
    cognitive_trace: {
      mode_path: ["decide"],
      activated_views: activatedViews,
      suppressed_views: [],
      assumptions_used: [],
      decision_boundary: {
        reached: result.status === "finalized",
        stop_reason: result.status === "finalized" ? "quorum_reached" : undefined,
        blocked_by: "multi_perspective_deliberation",
      },
      selected_style: "clear",
      overall_confidence: result.consensus.confidenceScore,
    },
    sections: buildSections(result),
    guardrails: {
      did_not_do: ["make_final_decision", "recommend_single_option", "override_user_values"],
      triggered_rules: ["multi_perspective_deliberation"],
    },
    deliberation,
  };
}
