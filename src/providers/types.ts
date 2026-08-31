// Contract: contracts/provider-adapter-contract.md
// Realizes Principle I (Model-Agnostic by Design): a new provider is a new module
// implementing ProviderAdapter, registered in registry.ts — never a change to fan-out,
// aggregation, or any other adapter.

import type { FindingSet, UnifiedReport } from "../lib/types.js";

export interface PullRequestContext {
  title: string;
  description: string;
}

export interface ReviewRequest {
  /** ReviewAgent.model, passed through opaquely. */
  model: string;
  /** Resolved secret value. Adapters must never log this or include it in a thrown error. */
  apiKey: string;
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
