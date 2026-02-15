/**
 * Multi-LLM orchestrator using runEmbeddedPiAgent.
 * Pattern follows extensions/llm-task/src/llm-task-tool.ts.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import type {
  DeliberationResult,
  NexusDeliberateConfig,
  Perspective,
  ResolvedProvider,
  SemanticVote,
} from "./types.js";
import { applyAdversarial } from "./adversarial.js";
import { calculateHarmony, classifyHarmony, normalizePosition } from "./consensus/harmony.js";
import { checkWeightedQuorum } from "./consensus/weighted-quorum.js";
import { resolvePerspectives } from "./perspectives.js";
import { saveResult } from "./state.js";

type RunEmbeddedPiAgentFn = (params: Record<string, unknown>) => Promise<unknown>;

const RUNNER_PATHS = [
  "../../../src/agents/pi-embedded-runner.js",
  "../../../agents/pi-embedded-runner.js",
] as const;

async function loadRunEmbeddedPiAgent(): Promise<RunEmbeddedPiAgentFn> {
  const errors: string[] = [];
  for (const modPath of RUNNER_PATHS) {
    try {
      const mod = await import(modPath);
      // oxlint-disable-next-line typescript/no-explicit-any
      if (typeof (mod as any).runEmbeddedPiAgent === "function") {
        // oxlint-disable-next-line typescript/no-explicit-any
        return (mod as any).runEmbeddedPiAgent;
      }
      errors.push(`${modPath}: module loaded but runEmbeddedPiAgent is not a function`);
    } catch (e) {
      errors.push(`${modPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(
    `runEmbeddedPiAgent not available. Tried:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
  );
}

function stripCodeFences(s: string): string {
  const trimmed = s.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (m) return (m[1] ?? "").trim();
  return trimmed;
}

function collectText(payloads: Array<{ text?: string; isError?: boolean }> | undefined): string {
  return (payloads ?? [])
    .filter((p) => !p.isError && typeof p.text === "string")
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
}

/** Resolve providers from params, plugin config, or OpenClaw config. */
export function resolveProviders(
  api: OpenClawPluginApi,
  explicitProviders?: string[],
): ResolvedProvider[] {
  const cfg = (api.pluginConfig ?? {}) as NexusDeliberateConfig;

  // 1. Explicit providers
  const providerKeys =
    explicitProviders && explicitProviders.length > 0
      ? explicitProviders
      : cfg.defaultProviders && cfg.defaultProviders.length > 0
        ? cfg.defaultProviders
        : [];

  if (providerKeys.length > 0) {
    return providerKeys.map((key) => {
      const parts = key.split("/");
      return {
        provider: parts[0]!,
        model: parts.slice(1).join("/"),
        authProfileId: cfg.defaultAuthProfileId,
      };
    });
  }

  // 3. Fall back to OpenClaw primary model
  const primary = api.config?.agents?.defaults?.model?.primary;
  if (typeof primary === "string" && primary.includes("/")) {
    const parts = primary.split("/");
    return [
      {
        provider: parts[0]!,
        model: parts.slice(1).join("/"),
        authProfileId: cfg.defaultAuthProfileId,
      },
    ];
  }

  return [];
}

function buildPrompt(query: string, perspective: Perspective): string {
  const system = [
    perspective.systemPrompt,
    "",
    "あなたは多視点合議に参加しています。",
    "以下のフィールドを持つ有効な JSON オブジェクトのみを返してください：",
    '  - "position": 簡潔な一文の結論（短く、他の視点と比較可能な表現で）',
    '  - "reasoning": 詳細な分析（2〜4文）',
    '  - "confidence": この結論に対する確信度（0.0〜1.0）',
    "",
    "マークダウンのコードフェンスで囲まないでください。JSON 以外のコメントも不要です。",
  ].join("\n");

  return `${system}\n\n質問:\n${query}\n`;
}

/** Run a single LLM call for one perspective. */
async function runSinglePerspective(
  runEmbeddedPiAgent: RunEmbeddedPiAgentFn,
  api: OpenClawPluginApi,
  query: string,
  perspective: Perspective,
  resolved: ResolvedProvider,
  timeoutMs: number,
  maxTokens?: number,
  temperatureOverride?: number,
): Promise<SemanticVote | null> {
  let tmpDir: string | null = null;
  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nexus-deliberate-"));
    const uuid = crypto.randomUUID();
    const sessionId = `deliberate-${uuid}`;
    const sessionFile = path.join(tmpDir, "session.json");
    const prompt = buildPrompt(query, perspective);

    const result = await runEmbeddedPiAgent({
      sessionId,
      sessionFile,
      workspaceDir: api.config?.agents?.defaults?.workspace ?? process.cwd(),
      config: api.config,
      prompt,
      timeoutMs,
      runId: `deliberate-${uuid}`,
      provider: resolved.provider,
      model: resolved.model,
      authProfileId: resolved.authProfileId,
      authProfileIdSource: resolved.authProfileId ? "user" : "auto",
      streamParams: {
        maxTokens,
        ...(temperatureOverride !== undefined ? { temperature: temperatureOverride } : {}),
      },
      disableTools: true,
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    const text = collectText((result as any).payloads);
    if (!text) return null;

    const raw = stripCodeFences(text);
    let parsed: { position?: string; reasoning?: string; confidence?: number };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (!parsed.position || typeof parsed.position !== "string") return null;

    const position = parsed.position.trim();
    return {
      nodeId: `${resolved.provider}/${resolved.model}`,
      position,
      normalizedPosition: normalizePosition(position),
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
      confidence:
        typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.8,
      weight: 1.0,
      perspective: perspective.id,
      timestamp: new Date().toISOString(),
    };
  } finally {
    if (tmpDir) {
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

export interface DeliberateParams {
  query: string;
  perspectives?: string[];
  providers?: string[];
  consensusThreshold?: number;
}

/** Execute a full deliberation round across multiple LLMs and perspectives. */
export async function runDeliberation(
  api: OpenClawPluginApi,
  params: DeliberateParams,
): Promise<DeliberationResult> {
  const cfg = (api.pluginConfig ?? {}) as NexusDeliberateConfig;
  const threshold = params.consensusThreshold ?? cfg.consensusThreshold ?? 0.66;
  const timeoutMs = cfg.timeoutMs ?? 60_000;
  const maxTokens = cfg.maxTokens;

  const perspectives = resolvePerspectives(params.perspectives);
  const providers = resolveProviders(api, params.providers);

  if (providers.length === 0) {
    throw new Error(
      "No LLM providers configured. Set defaultProviders in plugin config or agents.defaults.model.primary in OpenClaw config.",
    );
  }

  const runEmbeddedPiAgent = await loadRunEmbeddedPiAgent();

  // Create tasks: each perspective × providers (round-robin if multiple)
  // 単一プロバイダーの場合は temperature を視点ごとにずらし多様性を確保
  const singleProvider = providers.length === 1;
  const tasks: Array<{
    perspective: Perspective;
    provider: ResolvedProvider;
    temperature?: number;
  }> = [];
  for (let i = 0; i < perspectives.length; i++) {
    const provider = providers[i % providers.length]!;
    const temperature = singleProvider
      ? 0.4 + (i / Math.max(perspectives.length - 1, 1)) * 0.6
      : undefined;
    tasks.push({ perspective: perspectives[i]!, provider, temperature });
  }

  // Execute all in parallel
  const results = await Promise.allSettled(
    tasks.map(({ perspective, provider, temperature }) =>
      runSinglePerspective(
        runEmbeddedPiAgent,
        api,
        params.query,
        perspective,
        provider,
        timeoutMs,
        maxTokens,
        temperature,
      ),
    ),
  );

  // Collect successful votes
  const votes: SemanticVote[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      votes.push(r.value);
    }
  }

  // Adversarial Deliberation (Devil's Advocate)
  const enableAdversarial = cfg.enableAdversarial !== false; // デフォルト true
  const deliberationId = `delib_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  let finalVotes = votes;
  let adversarialDetails: DeliberationResult["adversarialDetails"];

  if (enableAdversarial && votes.length > 0) {
    const { adjustedVotes, adversarialDetails: details } = applyAdversarial(votes, deliberationId);
    finalVotes = adjustedVotes;
    adversarialDetails = details.map((d) => ({
      perspective: d.vote.perspective as string,
      challenge: d.challenge.challenge,
      challengeType: d.challenge.challengeType,
      severity: d.challenge.severity,
      rebuttal: d.rebuttal.rebuttal,
      concession: d.rebuttal.concession,
      originalConfidence: d.vote.confidence,
      revisedConfidence: d.rebuttal.revisedConfidence,
    }));
  }

  // Calculate consensus（クラスタリング有効化で意味的類似度を考慮）
  const clusteringOpts = { enableClustering: true, similarityThreshold: 0.5 };
  const consensus = calculateHarmony(finalVotes, undefined, clusteringOpts);
  const harmonyLevel = classifyHarmony(consensus.harmonyIndex);
  const quorum = checkWeightedQuorum(finalVotes, threshold, clusteringOpts);

  // Determine status
  let status: DeliberationResult["status"];
  if (finalVotes.length === 0) {
    status = "failed";
  } else if (quorum.hasQuorum && consensus.harmonyIndex >= 0.66) {
    status = "finalized";
  } else if (quorum.hasQuorum) {
    status = "quorum_reached";
  } else {
    status = "conflicted";
  }

  const result: DeliberationResult = {
    id: deliberationId,
    query: params.query,
    votes: finalVotes,
    consensus,
    harmonyLevel,
    status,
    conclusion: quorum.winningPosition,
    participants: [...new Set(finalVotes.map((v) => v.nodeId))],
    perspectives: perspectives.map((p) => p.id),
    timestamp: new Date().toISOString(),
    adversarialEnabled: enableAdversarial,
    adversarialDetails,
    guardrails: {
      didNotDo: ["make_final_decision", "recommend_single_option", "override_user_values"],
      triggeredRules: ["multi_perspective_deliberation"],
    },
  };

  saveResult(result);
  return result;
}
