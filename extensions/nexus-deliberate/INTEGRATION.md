# nexus-deliberate ↔ Nexus Sphere 接続設計

## 概要

nexus-deliberate（OpenClaw 拡張）と Nexus Sphere（プロダクション）は
同じ合議エンジンの異なる実装である。Phase B でこれらを接続するための設計。

---

## 現行アーキテクチャの比較

| 観点            | Nexus Sphere (`/api/hybrid/execute`) | nexus-deliberate (`/v1/deliberate`)    |
| --------------- | ------------------------------------ | -------------------------------------- |
| 実行方式        | 単一プロセス内で決定的生成           | `runEmbeddedPiAgent` で実 LLM 呼び出し |
| コンセンサス    | テンプレート + ハッシュベース        | Harmony Index + 重み付きクォーラム     |
| ストリーミング  | SSE（Gen 1）                         | なし（同期 JSON）                      |
| 視点            | 8 ViewType（モード依存で動的選択）   | 8 ViewType（全視点 or 指定）           |
| Adversarial     | Gen 4 Devil's Advocate               | 未実装                                 |
| Decision Memory | Gen 2 類似判断参照                   | 未実装                                 |
| User Profile    | Gen 3 重み調整                       | 未実装                                 |
| 状態管理        | SQLite (SessionManager)              | in-memory Map                          |

---

## Phase B 接続パターン

### パターン 1: Nexus Sphere → nexus-deliberate（推奨）

Nexus Sphere のフロントエンドが nexus-deliberate の HTTP API を呼び出す。

```
[Browser] → [Next.js /api/hybrid/execute]
              ├─ ARCUS_USE_BACKEND=1 の場合
              │   → [OpenClaw Gateway /v1/deliberate]  ← nexus-deliberate
              │       → [LLM A] [LLM B] [LLM C] (並列)
              │       → Harmony Index 計算
              │       → JSON 応答
              │   ← Deliberation 型に変換
              └─ フォールバック
                  → buildDeliberation()（現行テンプレート）
```

**接続ポイント**: route.ts L749-777 の `useBackend` 分岐が既に存在。
現在は `GET /api/v1/traces/:id/deliberation` を呼んでいるが、
これを `POST /v1/deliberate` に差し替える。

**型変換が必要なフィールド**:

```typescript
// nexus-deliberate の DeliberationResult → Nexus Sphere の Deliberation
function convertToNexusSphereDeliberation(
  result: DeliberationResult,
  activated_views: ViewType[],
): Deliberation {
  return {
    participants: result.votes.map((v) => ({
      id: `participant-${v.perspective}`,
      role: perspectiveToRole(v.perspective),
      perspective: perspectiveToDescription(v.perspective),
    })),
    steps: result.votes.map((v) => ({
      participant_id: `participant-${v.perspective}`,
      analysis: v.reasoning,
      confidence: v.confidence,
      key_points: extractKeyPoints(v.reasoning),
    })),
    synthesis: {
      method: "マルチLLM合議によるHarmony Index統合",
      agreements:
        result.consensus.harmonyIndex >= 0.66
          ? [
              `${result.votes.length}視点中${result.votes.length - result.consensus.divergenceCount}視点が合意`,
            ]
          : [],
      tensions:
        result.consensus.divergenceCount > 0
          ? [`${result.consensus.divergenceCount}視点が異なる結論`]
          : [],
      resolution: result.conclusion ?? "合意に至らず",
    },
    depth: activated_views.length >= 4 ? 2 : 1,
    total_perspectives: result.votes.length,
    processing_time_ms: 0, // 実測値で上書き
  };
}
```

### パターン 2: 共有コンセンサスエンジン

harmony.ts と weighted-quorum.ts を npm パッケージとして切り出し、
両方のプロジェクトから参照する。

```
@nexus-sphere/consensus
├── harmony.ts          (← nexus-deliberate から移動)
├── weighted-quorum.ts
├── normalize.ts
└── types.ts
```

Nexus Sphere の route.ts は `buildDeliberation()` 内でこのパッケージを使い、
テンプレート生成から実コンセンサス計算に移行する。

---

## SSE ストリーミング対応（Phase B）

nexus-deliberate が SSE を返す場合のイベントマッピング：

| nexus-deliberate イベント | Nexus Sphere StreamEvent                           |
| ------------------------- | -------------------------------------------------- |
| (開始)                    | `deliberation:start`                               |
| 各 perspective 結果到着   | `deliberation:participant` + `deliberation:step`   |
| (Adversarial 追加時)      | `deliberation:challenge` + `deliberation:rebuttal` |
| consensus 計算完了        | `deliberation:synthesis`                           |
| 最終結果                  | `deliberation:complete`                            |

---

## 環境変数

```bash
# Nexus Sphere 側
ARCUS_USE_BACKEND=1
ARCUS_BACKEND_URL=http://localhost:18789  # OpenClaw Gateway

# OpenClaw 側（nexus-deliberate プラグイン設定）
# openclaw.config.yaml:
# extensions:
#   nexus-deliberate:
#     defaultProviders:
#       - "anthropic/claude-sonnet-4-5-20250929"
#       - "openai/gpt-4o"
#     consensusThreshold: 0.66
```

---

## 不足機能（Phase B で実装）

1. **SSE ストリーミング**: nexus-deliberate に SSE エンドポイント追加
2. **Adversarial Deliberation**: harmony.ts に Devil's Advocate ロジック追加
3. **Decision Memory 統合**: Nexus Sphere の SessionManager からの類似判断注入
4. **User Profile 統合**: view_weights パラメータの受け渡し
5. **Embedding ベース正規化**: normalizePosition を意味的類似度に拡張
6. **永続化**: in-memory Map → SQLite or Nexus Sphere SessionManager 共有
