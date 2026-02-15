/**
 * Type definitions for the nexus-deliberate extension.
 *
 * Nexus Sphere の Python dataclass (consensus.py, weighted_quorum.py) と
 * フロントエンド型定義 (hybrid/execute/types.ts) の両方に整合。
 */

// ─── Nexus Sphere ViewType 互換 ─────────────────────────────
export type ViewType =
  | "cost"
  | "time"
  | "risk"
  | "feasibility"
  | "ethics"
  | "long_term"
  | "emotion"
  | "uncertainty";

// ─── Consensus Core ─────────────────────────────────────────

/** 単一 LLM の構造化投票。 */
export interface SemanticVote {
  nodeId: string;
  /** LLM が返した結論（正規化前の原文）。 */
  position: string;
  /** 正規化済み position（合意判定に使用）。 */
  normalizedPosition: string;
  reasoning: string;
  confidence: number;
  weight: number;
  perspective: ViewType | string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/** Harmony Index メトリクス。 */
export interface ConsensusMetric {
  harmonyIndex: number;
  semanticSimilarity: number;
  divergenceCount: number;
  agreementPercentage: number;
  confidenceScore: number;
}

/** Harmony レベル分類。 */
export type HarmonyLevel = "dissonance" | "partial" | "harmony" | "perfect";

/** コンセンサスラウンドの状態。 */
export type ConsensusStatus =
  | "initiated"
  | "voting"
  | "quorum_reached"
  | "finalized"
  | "failed"
  | "conflicted";

// ─── Deliberation Result ────────────────────────────────────

/** 合議ラウンドの完全な結果。 */
export interface DeliberationResult {
  id: string;
  query: string;
  votes: SemanticVote[];
  consensus: ConsensusMetric;
  harmonyLevel: HarmonyLevel;
  status: ConsensusStatus;
  /** 最も支持された position（原文）。 */
  conclusion: string | null;
  participants: string[];
  perspectives: string[];
  timestamp: string;
  /** Adversarial Deliberation が有効だったか。 */
  adversarialEnabled?: boolean;
  /** Adversarial Challenge/Rebuttal の詳細。 */
  adversarialDetails?: Array<{
    perspective: string;
    challenge: string;
    challengeType: string;
    severity: string;
    rebuttal: string;
    concession?: string;
    originalConfidence: number;
    revisedConfidence: number;
  }>;
  /** Guardrails: Nexus Sphere 互換。 */
  guardrails?: {
    didNotDo: string[];
    triggeredRules: string[];
  };
}

// ─── Perspective ────────────────────────────────────────────

/** 視点定義。 */
export interface Perspective {
  id: ViewType | string;
  label: string;
  systemPrompt: string;
}

// ─── Provider ───────────────────────────────────────────────

/** プロバイダー解決結果。 */
export interface ResolvedProvider {
  provider: string;
  model: string;
  authProfileId?: string;
}

// ─── Quorum ─────────────────────────────────────────────────

/** 重み付きクォーラム判定結果。 */
export interface QuorumResult {
  hasQuorum: boolean;
  supportWeight: number;
  totalWeight: number;
  requiredWeight: number;
  supportRatio: number;
  quorumRatio: number;
  winningPosition: string | null;
}

// ─── Plugin Config ──────────────────────────────────────────

/** プラグイン設定。 */
export interface NexusDeliberateConfig {
  defaultProviders?: string[];
  defaultAuthProfileId?: string;
  consensusThreshold?: number;
  timeoutMs?: number;
  maxTokens?: number;
  /** Adversarial Deliberation (Devil's Advocate) を有効化。デフォルト true。 */
  enableAdversarial?: boolean;
  /** HTTP API のレート制限（リクエスト/分）。デフォルト 10。 */
  rateLimitPerMinute?: number;
}
