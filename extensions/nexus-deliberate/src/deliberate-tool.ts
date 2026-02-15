/**
 * "deliberate" tool definition for OpenClaw agent use.
 * Uses @sinclair/typebox for schema, following llm-task pattern.
 */

import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import { runDeliberation } from "./orchestrator.js";

export function createDeliberateTool(api: OpenClawPluginApi) {
  return {
    name: "deliberate",
    description:
      "Run a multi-LLM deliberation: multiple AI models analyze a query from different perspectives, then a Harmony Index consensus is calculated. Returns structured results with positions, reasoning, and agreement metrics.",
    parameters: Type.Object({
      query: Type.String({
        description: "The question or topic to deliberate on.",
      }),
      perspectives: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'Perspective IDs to use (default: all 8 Nexus Sphere views: cost, time, risk, feasibility, ethics, long_term, emotion, uncertainty). Example: ["cost", "risk", "feasibility"]',
        }),
      ),
      providers: Type.Optional(
        Type.Array(Type.String(), {
          description:
            'LLM provider/model keys to use. Example: ["openai/gpt-4o", "anthropic/claude-sonnet-4-5-20250929"]',
        }),
      ),
      consensus_threshold: Type.Optional(
        Type.Number({
          description: "Harmony threshold for quorum (0-1, default 0.66).",
        }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>) {
      const query = typeof params.query === "string" ? params.query : "";
      if (!query.trim()) {
        throw new Error("query is required");
      }

      const result = await runDeliberation(api, {
        query,
        perspectives: Array.isArray(params.perspectives)
          ? (params.perspectives as string[])
          : undefined,
        providers: Array.isArray(params.providers) ? (params.providers as string[]) : undefined,
        consensusThreshold:
          typeof params.consensus_threshold === "number" ? params.consensus_threshold : undefined,
      });

      // Format output for the agent
      const lines: string[] = [
        `## Deliberation Result`,
        "",
        `**Query:** ${result.query}`,
        `**Status:** ${result.status}`,
        `**Harmony Index:** ${result.consensus.harmonyIndex.toFixed(3)} (${result.harmonyLevel})`,
        `**Agreement:** ${result.consensus.agreementPercentage.toFixed(1)}%`,
        `**Participants:** ${result.participants.join(", ")}`,
        "",
      ];

      if (result.conclusion) {
        lines.push(`### Conclusion`, `${result.conclusion}`, "");
      }

      lines.push(`### Perspectives`);
      for (const vote of result.votes) {
        lines.push(
          `- **${vote.perspective}** (${vote.nodeId}, confidence: ${vote.confidence.toFixed(2)})`,
          `  Position: ${vote.position}`,
          `  ${vote.reasoning}`,
          "",
        );
      }

      // Adversarial details
      if (result.adversarialDetails && result.adversarialDetails.length > 0) {
        lines.push(`### Adversarial Challenges (Devil's Advocate)`);
        for (const ad of result.adversarialDetails) {
          lines.push(
            `- **${ad.perspective}** [${ad.severity}] ${ad.challenge}`,
            `  Rebuttal: ${ad.rebuttal}`,
            `  Confidence: ${ad.originalConfidence.toFixed(2)} → ${ad.revisedConfidence.toFixed(2)}`,
            "",
          );
        }
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: result,
      };
    },
  };
}
