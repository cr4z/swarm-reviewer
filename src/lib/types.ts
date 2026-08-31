// Shared data model types — see specs/001-multi-model-pr-review/data-model.md.
// Kept separate from providers/types.ts and delivery/types.ts so both can import the
// entities they pass around without a circular dependency between the two.

export type Severity = "blocking" | "warning" | "note";

export interface Finding {
  severity: Severity;
  file: string | null;
  line: number | null;
  description: string;
}

export interface FindingSet {
  agentId: string;
  model: string;
  summary: string;
  findings: Finding[];
}

export interface MissingAgent {
  agentId: string;
  reason: string;
}

export interface PullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export interface UnifiedReport {
  pullRequest: PullRequestRef;
  generatedAt: string;
  /** Rendered Markdown. For the PR-comment channel this begins with the marker (see pr-comment.ts). */
  body: string;
  agentsReported: string[];
  agentsMissing: MissingAgent[];
  diffTruncated: boolean;
}

export type AgentResultStatus = "succeeded" | "failed" | "timed_out";

export interface AgentResult {
  agentId: string;
  status: AgentResultStatus;
  durationMs: number;
  approxCost: { inputTokens: number; outputTokens: number; estimatedUsd: number | null } | null;
  error: string | null;
}
