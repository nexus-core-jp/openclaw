/**
 * Nexus Sphere 互換レイヤーのテスト
 *
 * フロントエンド（DeliberationMinutes.tsx, ChatMain.tsx）が
 * 期待する型構造に正しく変換されることを検証する。
 */

import { describe, expect, it } from "vitest";
import type { DeliberationResult } from "../types.js";
import { toDeliberation, toHybridExecuteResponse, extractKeyPoints } from "./nexus-sphere.js";

function makeResult(overrides?: Partial<DeliberationResult>): DeliberationResult {
  return {
    id: "delib_test123",
    query: "新規事業の方向性を検討して",
    votes: [
      {
        nodeId: "openai/gpt-4o",
        position: "Goを採用すべき",
        normalizedPosition: "goを採用すべき",
        reasoning: "コスト面で有利。採用市場が広い。学習コストが低い。",
        confidence: 0.8,
        weight: 1.0,
        perspective: "cost",
        timestamp: "2026-01-01T00:00:00Z",
      },
      {
        nodeId: "anthropic/claude-sonnet-4-5-20250929",
        position: "Goを採用すべき",
        normalizedPosition: "goを採用すべき",
        reasoning: "開発速度が速い。プロトタイプを2週間で構築可能。",
        confidence: 0.85,
        weight: 1.0,
        perspective: "time",
        timestamp: "2026-01-01T00:00:00Z",
      },
      {
        nodeId: "openai/gpt-4o",
        position: "Rustが長期的に有利",
        normalizedPosition: "rustが長期的に有利",
        reasoning: "パフォーマンスが高い。メモリ安全性が保証される。長期運用コストが低い。",
        confidence: 0.7,
        weight: 1.0,
        perspective: "long_term",
        timestamp: "2026-01-01T00:00:00Z",
      },
    ],
    consensus: {
      harmonyIndex: 0.625,
      semanticSimilarity: 0.75,
      divergenceCount: 1,
      agreementPercentage: 66.7,
      confidenceScore: 0.5,
    },
    harmonyLevel: "partial",
    status: "quorum_reached",
    conclusion: "Goを採用すべき",
    participants: ["openai/gpt-4o", "anthropic/claude-sonnet-4-5-20250929"],
    perspectives: ["cost", "time", "long_term"],
    timestamp: "2026-01-01T00:00:00Z",
    adversarialEnabled: true,
    adversarialDetails: [
      {
        perspective: "cost",
        challenge: "隠れたコストを過小評価していませんか？",
        challengeType: "assumption",
        severity: "significant",
        rebuttal: "間接コストを再試算しました。",
        originalConfidence: 0.8,
        revisedConfidence: 0.75,
      },
      {
        perspective: "time",
        challenge: "時間見積もりの根拠は？",
        challengeType: "evidence",
        severity: "significant",
        rebuttal: "バッファを30%追加しました。",
        originalConfidence: 0.85,
        revisedConfidence: 0.8,
      },
      {
        perspective: "long_term",
        challenge: "破壊的イノベーションのリスクは？",
        challengeType: "assumption",
        severity: "critical",
        rebuttal: "シナリオ分析を追加しました。",
        concession: "この点は重要な見落としでした。",
        originalConfidence: 0.7,
        revisedConfidence: 0.6,
      },
    ],
    ...overrides,
  };
}

// ─── extractKeyPoints ─────────────────────────────────────────

describe("extractKeyPoints", () => {
  it("splits Japanese sentences on 。", () => {
    const points = extractKeyPoints("コスト面で有利。採用市場が広い。学習コストが低い。");
    expect(points).toEqual(["コスト面で有利", "採用市場が広い", "学習コストが低い"]);
  });

  it("splits on . and newline", () => {
    const points = extractKeyPoints("Point one.\nPoint two.");
    expect(points).toEqual(["Point one", "Point two"]);
  });

  it("returns empty array for empty string", () => {
    expect(extractKeyPoints("")).toEqual([]);
  });

  it("returns single item for no separators", () => {
    const points = extractKeyPoints("単一のポイント");
    expect(points).toEqual(["単一のポイント"]);
  });
});

// ─── toDeliberation ──────────────────────────────────────────

describe("toDeliberation", () => {
  it("has all required top-level fields", () => {
    const delib = toDeliberation(makeResult(), 1500);
    expect(delib.participants).toBeDefined();
    expect(delib.steps).toBeDefined();
    expect(delib.synthesis).toBeDefined();
    expect(typeof delib.depth).toBe("number");
    expect(typeof delib.total_perspectives).toBe("number");
    expect(typeof delib.processing_time_ms).toBe("number");
  });

  it("generates correct participant IDs", () => {
    const delib = toDeliberation(makeResult(), 1000);
    for (const p of delib.participants) {
      expect(p.id).toMatch(/^participant-/);
      expect(p.role).toBeTruthy();
      expect(p.perspective).toBeTruthy();
    }
  });

  it("participant IDs are unique per perspective", () => {
    const delib = toDeliberation(makeResult(), 1000);
    const ids = delib.participants.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("step participant_ids match participant ids", () => {
    const delib = toDeliberation(makeResult(), 1000);
    const participantIds = new Set(delib.participants.map((p) => p.id));
    for (const step of delib.steps) {
      expect(participantIds.has(step.participant_id)).toBe(true);
    }
  });

  it("each step has required fields", () => {
    const delib = toDeliberation(makeResult(), 1000);
    for (const step of delib.steps) {
      expect(typeof step.participant_id).toBe("string");
      expect(typeof step.analysis).toBe("string");
      expect(step.analysis.length).toBeGreaterThan(0);
      expect(typeof step.confidence).toBe("number");
      expect(step.confidence).toBeGreaterThanOrEqual(0);
      expect(step.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(step.key_points)).toBe(true);
      expect(step.key_points.length).toBeGreaterThan(0);
    }
  });

  it("adversarial details are mapped to steps", () => {
    const delib = toDeliberation(makeResult(), 1000);
    const costStep = delib.steps.find((s) => s.participant_id === "participant-cost");
    expect(costStep?.challenge).toBeDefined();
    expect(costStep?.challenge?.challenge_type).toBe("assumption");
    expect(costStep?.challenge?.severity).toBe("significant");
    expect(costStep?.rebuttal).toBeDefined();
    expect(costStep?.rebuttal?.revised_confidence).toBe(0.75);
  });

  it("critical adversarial has concession", () => {
    const delib = toDeliberation(makeResult(), 1000);
    const longTermStep = delib.steps.find((s) => s.participant_id === "participant-long_term");
    expect(longTermStep?.challenge?.severity).toBe("critical");
    expect(longTermStep?.rebuttal?.concession).toBeTruthy();
  });

  it("synthesis has all required fields", () => {
    const delib = toDeliberation(makeResult(), 1000);
    expect(typeof delib.synthesis.method).toBe("string");
    expect(Array.isArray(delib.synthesis.agreements)).toBe(true);
    expect(Array.isArray(delib.synthesis.tensions)).toBe(true);
    expect(typeof delib.synthesis.resolution).toBe("string");
    expect(delib.synthesis.resolution.length).toBeGreaterThan(0);
  });

  it("synthesis resolution uses conclusion", () => {
    const delib = toDeliberation(makeResult(), 1000);
    expect(delib.synthesis.resolution).toBe("Goを採用すべき");
  });

  it("synthesis resolution falls back when no conclusion", () => {
    const delib = toDeliberation(makeResult({ conclusion: null }), 1000);
    expect(delib.synthesis.resolution).toContain("合意に至りませんでした");
  });

  it("processing_time_ms is passed through", () => {
    const delib = toDeliberation(makeResult(), 2345);
    expect(delib.processing_time_ms).toBe(2345);
  });

  it("adversarial_enabled is passed through", () => {
    const delib = toDeliberation(makeResult(), 1000);
    expect(delib.adversarial_enabled).toBe(true);
  });

  it("participants.length > 0 (prevents silent null in UI)", () => {
    const delib = toDeliberation(makeResult(), 1000);
    expect(delib.participants.length).toBeGreaterThan(0);
  });
});

// ─── toHybridExecuteResponse ─────────────────────────────────

describe("toHybridExecuteResponse", () => {
  it("has all required top-level fields", () => {
    const resp = toHybridExecuteResponse(makeResult(), 1000);
    expect(resp.trace_id).toBeTruthy();
    expect(resp.mode).toBe("decide");
    expect(resp.status).toBe("ok");
    expect(resp.meta).toBeDefined();
    expect(resp.cognitive_trace).toBeDefined();
    expect(Array.isArray(resp.sections)).toBe(true);
    expect(resp.guardrails).toBeDefined();
    expect(resp.deliberation).toBeDefined();
  });

  it("meta has correct structure", () => {
    const resp = toHybridExecuteResponse(makeResult(), 1000);
    expect(resp.meta.version).toBe("arcus-v1.0");
    expect(typeof resp.meta.model).toBe("string");
    expect(typeof resp.meta.created_at).toBe("string");
    expect(resp.meta.principles).toEqual(["non_judgement", "external_decider", "neutrality"]);
  });

  it("cognitive_trace has correct structure", () => {
    const resp = toHybridExecuteResponse(makeResult(), 1000);
    const ct = resp.cognitive_trace;
    expect(ct.mode_path).toEqual(["decide"]);
    expect(Array.isArray(ct.activated_views)).toBe(true);
    expect(ct.activated_views.length).toBeGreaterThan(0);
    expect(ct.decision_boundary.blocked_by).toBe("multi_perspective_deliberation");
    expect(typeof ct.overall_confidence).toBe("number");
  });

  it("guardrails match Nexus Sphere contract", () => {
    const resp = toHybridExecuteResponse(makeResult(), 1000);
    expect(resp.guardrails.did_not_do).toContain("make_final_decision");
    expect(resp.guardrails.did_not_do).toContain("recommend_single_option");
    expect(resp.guardrails.did_not_do).toContain("override_user_values");
    expect(resp.guardrails.triggered_rules).toContain("multi_perspective_deliberation");
  });

  it("sections are non-empty and renderable", () => {
    const resp = toHybridExecuteResponse(makeResult(), 1000);
    expect(resp.sections.length).toBeGreaterThan(0);
    for (const s of resp.sections) {
      expect(s.id).toBeTruthy();
      expect(s.type).toBeTruthy();
      expect(s.role).toBeTruthy();
      expect(s.title).toBeTruthy();
      expect(Array.isArray(s.derived_from)).toBe(true);
    }
  });

  it("deliberation is present and valid", () => {
    const resp = toHybridExecuteResponse(makeResult(), 1000);
    const delib = resp.deliberation!;
    expect(delib).toBeDefined();
    expect(delib.participants.length).toBeGreaterThan(0);
    expect(delib.steps.length).toBeGreaterThan(0);
    expect(delib.synthesis).toBeDefined();
  });

  it("trace_id matches deliberation id", () => {
    const resp = toHybridExecuteResponse(makeResult(), 1000);
    expect(resp.trace_id).toBe("delib_test123");
  });

  it("decision_boundary.reached = true for finalized status", () => {
    const resp = toHybridExecuteResponse(makeResult({ status: "finalized" }), 1000);
    expect(resp.cognitive_trace.decision_boundary.reached).toBe(true);
    expect(resp.cognitive_trace.decision_boundary.stop_reason).toBe("quorum_reached");
  });

  it("decision_boundary.reached = false for non-finalized", () => {
    const resp = toHybridExecuteResponse(makeResult({ status: "conflicted" }), 1000);
    expect(resp.cognitive_trace.decision_boundary.reached).toBe(false);
  });
});

// ─── End-to-End: ChatMain.tsx フロー検証 ─────────────────────

describe("ChatMain.tsx integration contract", () => {
  it("data?.deliberation path yields valid Deliberation", () => {
    // ChatMain.tsx L295: deliberation: data?.deliberation
    const data = toHybridExecuteResponse(makeResult(), 1000);
    const deliberation = data?.deliberation;
    expect(deliberation).toBeDefined();
    expect(deliberation!.participants.length).toBeGreaterThan(0);
  });

  it("sections generate non-empty content", () => {
    // ChatMain.tsx L278-288: sections → contentParts
    const data = toHybridExecuteResponse(makeResult(), 1000);
    const sections = Array.isArray(data?.sections) ? data.sections : [];
    const contentParts: string[] = [];
    for (const section of sections) {
      if (section.title) contentParts.push(`■ ${section.title}`);
      if (section.content) contentParts.push(section.content);
      if (Array.isArray(section.bullets)) {
        for (const b of section.bullets) contentParts.push(`・${b}`);
      }
      contentParts.push("");
    }
    const content = contentParts.join("\n").trim();
    expect(content.length).toBeGreaterThan(0);
    expect(content).not.toBe("（応答なし）");
  });

  it("synthesis.resolution is accessible for decision memory", () => {
    // ChatMain.tsx L307: data.deliberation.synthesis.resolution
    const data = toHybridExecuteResponse(makeResult(), 1000);
    expect(data.deliberation?.synthesis.resolution).toBe("Goを採用すべき");
  });
});
