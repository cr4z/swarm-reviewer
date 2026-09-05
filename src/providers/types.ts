// Contract: contracts/provider-adapter-contract.md
// Realizes Principle I (Model-Agnostic by Design): a new provider is a new module
// implementing ProviderAdapter, registered in registry.ts — never a change to fan-out,
// aggregation, or any other adapter.

import type { FindingSet, UnifiedReport } from "../lib/types.js";

export interface PullRequestContext {
  title: string;
  description: string;
}

/**
 * Which header style `apiKey` should be sent with. Defaults to `"api_key"` (unchanged
 * behavior). `"bearer"` is used for a WIF-minted access token (spec 002,
 * contracts/federation-auth-contract.md) — currently only ever set by the caller for the
 * anthropic adapter, which is the only one that branches on it.
 */
export type AuthScheme = "api_key" | "bearer";

export interface ReviewRequest {
  /** ReviewAgent.model, passed through opaquely. */
  model: string;
  /** Resolved secret value, or a WIF-minted access token. Never log this or include it in a thrown error. */
  apiKey: string;
  authScheme?: AuthScheme;
  diff: string;
  diffTruncated: boolean;
  pullRequestContext: PullRequestContext;
  timeoutMs: number;
}

export interface UsageInfo {
  inputTokens?: number;
  outputTokens?: number;
}

export interface ReviewResponse {
  findingSet: FindingSet;
  usage?: UsageInfo;
}

export interface AggregateRequest {
  model: string;
  apiKey: string;
  authScheme?: AuthScheme;
  findingSets: FindingSet[];
  missingAgents: { agentId: string; reason: string }[];
  diffTruncated: boolean;
  pullRequestContext: PullRequestContext;
  timeoutMs: number;
}

export interface AggregateResponse {
  report: UnifiedReport;
  usage?: UsageInfo;
}

export interface ProviderAdapter {
  /** Adapter key, matched against ReviewAgent.provider from config (e.g. "anthropic"). */
  readonly key: string;

  /**
   * Perform one review call. Must not throw for a "the model declined" style response —
   * only for transport/auth/timeout failures, which the caller records as AgentResult.error.
   */
  review(request: ReviewRequest): Promise<ReviewResponse>;

  /**
   * Perform the aggregation call for the one agent configured with role "aggregator".
   * Synthesizes existing findings, does not independently re-review (Principle III).
   */
  aggregate(request: AggregateRequest): Promise<AggregateResponse>;
}
