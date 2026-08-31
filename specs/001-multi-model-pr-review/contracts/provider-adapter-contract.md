# Contract: Provider Adapter

Realizes Principle I (Model-Agnostic by Design): adding a provider is adding one module that
implements this interface and registering it — never a change to fan-out, aggregation, or any
other adapter.

## Interface (TypeScript)

```ts
interface ProviderAdapter {
  /** Adapter key, matched against ReviewAgent.provider from config (e.g. "anthropic"). */
  readonly key: string;

  /**
   * Perform one review call. Must not throw for a "the model declined" style response —
   * only for transport/auth/timeout failures, which the caller records as AgentResult.error.
   */
  review(request: ReviewRequest): Promise<ReviewResponse>;

  /**
   * Perform the aggregation call for the one agent configured with role "aggregator".
   * Synthesizes, does not independently re-review (Principle III).
   */
  aggregate(request: AggregateRequest): Promise<AggregateResponse>;
}

interface ReviewRequest {
  model: string;              // ReviewAgent.model, passed through opaquely
  apiKey: string;              // resolved secret value; adapter must never log it
  diff: string;                 // possibly truncated
  diffTruncated: boolean;
  pullRequestContext: { title: string; description: string };
  timeoutMs: number;
}

interface ReviewResponse {
  findingSet: FindingSet;       // see data-model.md
  usage?: { inputTokens: number; outputTokens: number };
}

interface AggregateRequest {
  model: string;
  apiKey: string;
  findingSets: FindingSet[];    // from every agent that succeeded
  missingAgents: { agentId: string; reason: string }[];
  diffTruncated: boolean;
  pullRequestContext: { title: string; description: string };
  timeoutMs: number;
}

interface AggregateResponse {
  report: UnifiedReport;         // see data-model.md; body MUST NOT include raw secrets
  usage?: { inputTokens: number; outputTokens: number };
}
```

## Registration

Adapters are registered in a single `providers/registry.ts` keyed by `ProviderAdapter.key`.
Config validation (FR-011) rejects any `agents[].provider` value with no matching registered
key, before any network call is made.

## Failure semantics

- A thrown error (timeout, transport, non-2xx, malformed provider response) is caught by the
  caller (the `run-agent` action), recorded as `AgentResult.status = "failed"` or
  `"timed_out"`, and MUST NOT propagate to fail the matrix job as a whole — Principle II.
- Credential values MUST never appear in a thrown error's message — Principle VI.

## Initial adapters (v1)

`anthropic`, `openai`, `google` — chosen as the three providers referenced in project
discussion. Additional providers (`mistral`, `cohere`, self-hosted OpenAI-compatible
endpoints, etc.) are additive follow-up work, not required for v1 (see spec Assumptions on
scope), and each is exactly one new file plus a registry entry.
