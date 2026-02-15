/**
 * POST /v1/deliberate HTTP endpoint.
 *
 * Nexus Sphere フロントエンド完全互換:
 *   - SSE deliberation:complete → HybridExecuteResponse を送信
 *   - ChatMain.tsx が期待するラッパー構造
 *   - DeliberationMinutes.tsx が期待する participant_id 形式
 *
 * Supports:
 *   - POST JSON → HybridExecuteResponse (JSON)
 *   - POST JSON with stream=true → SSE streaming
 *   - GET → list recent results
 *   - In-memory rate limiting
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "../../../src/plugins/types.js";
import type { NexusDeliberateConfig } from "./types.js";
import { toHybridExecuteResponse } from "./compat/nexus-sphere.js";
import { runDeliberation } from "./orchestrator.js";
import { getResult, listResults } from "./state.js";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

// ─── Rate Limiter ────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

function checkRateLimit(
  clientId: string,
  maxPerMinute: number,
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(clientId);

  if (!entry || now >= entry.resetAt) {
    const resetAt = now + 60_000;
    rateLimitMap.set(clientId, { count: 1, resetAt });
    return { allowed: true, remaining: maxPerMinute - 1, resetAt };
  }

  if (entry.count >= maxPerMinute) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count++;
  return {
    allowed: true,
    remaining: maxPerMinute - entry.count,
    resetAt: entry.resetAt,
  };
}

// ─── SSE Helper ─────────────────────────────────────────────

function sendSSE(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

// ─── Handlers ───────────────────────────────────────────────

export function createDeliberateHttpHandler(api: OpenClawPluginApi) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const cfg = (api.pluginConfig ?? {}) as NexusDeliberateConfig;
    const maxPerMinute = cfg.rateLimitPerMinute ?? 10;

    // Rate limit check
    const clientId =
      req.headers["x-forwarded-for"]?.toString() ?? req.socket.remoteAddress ?? "unknown";
    const rateCheck = checkRateLimit(clientId, maxPerMinute);
    if (!rateCheck.allowed) {
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)),
      });
      res.end(
        JSON.stringify({
          error: "Rate limit exceeded",
          retryAfterMs: rateCheck.resetAt - Date.now(),
        }),
      );
      return;
    }

    // GET /v1/deliberate — list recent results
    if (req.method === "GET") {
      const results = listResults();
      sendJson(res, 200, { results });
      return;
    }

    // POST /v1/deliberate — run deliberation
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    let body: {
      query?: string;
      /** Nexus Sphere 互換: prompt → query のエイリアス */
      prompt?: string;
      perspectives?: string[];
      providers?: string[];
      consensus_threshold?: number;
      stream?: boolean;
      /** Nexus Sphere 互換: 無視するが受け付ける */
      mode?: string;
      style?: string;
      trace_id?: string;
    };
    try {
      const raw = await readBody(req);
      body = JSON.parse(raw);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    // query または prompt を受け付ける（Nexus Sphere 互換）
    const query = body.query ?? body.prompt;
    if (!query || typeof query !== "string" || !query.trim()) {
      sendJson(res, 400, { error: "query (or prompt) is required" });
      return;
    }

    const useStream = body.stream === true;
    const startTime = Date.now();

    try {
      const result = await runDeliberation(api, {
        query,
        perspectives: body.perspectives,
        providers: body.providers,
        consensusThreshold: body.consensus_threshold,
      });

      const elapsed = Date.now() - startTime;
      const response = toHybridExecuteResponse(result, elapsed);

      if (useStream) {
        // SSE streaming mode
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        sendSSE(res, "deliberation:start", {
          query,
          perspectives: body.perspectives ?? "all",
          timestamp: new Date().toISOString(),
        });

        // Stream each vote as a step (ChatMain.tsx counts these)
        for (const vote of result.votes) {
          sendSSE(res, "deliberation:step", {
            participant_id: `participant-${vote.perspective}`,
            perspective: vote.perspective,
            analysis: vote.reasoning,
            position: vote.position,
            confidence: vote.confidence,
          });
        }

        // Complete with HybridExecuteResponse (ChatMain.tsx L252 captures this)
        sendSSE(res, "deliberation:complete", response);
        res.end();
      } else {
        // Synchronous JSON: return HybridExecuteResponse
        sendJson(res, 200, response);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Internal error";
      if (useStream) {
        sendSSE(res, "error", { error: msg });
        res.end();
      } else {
        sendJson(res, 500, { error: msg });
      }
    }
  };
}

export function createDeliberateResultHttpHandler(_api: OpenClawPluginApi) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }

    // Extract ID from URL: /v1/deliberate/:id
    const url = new URL(req.url ?? "/", "http://localhost");
    const segments = url.pathname.split("/").filter(Boolean);
    const id = segments[segments.length - 1];

    if (!id) {
      sendJson(res, 400, { error: "Missing deliberation ID" });
      return;
    }

    const result = getResult(id);
    if (!result) {
      sendJson(res, 404, { error: "Deliberation not found" });
      return;
    }

    sendJson(res, 200, result);
  };
}
