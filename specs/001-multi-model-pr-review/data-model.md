# Phase 1 Data Model: Multi-Model PR Review

These are logical entities realized as JSON documents flowing between jobs/artifacts, not
database rows — this feature has no persistent storage (see constitution: Technical
Constraints).

## Configuration

The maintainer-owned file (default path `swarm-reviewer.config.json`) read once per run and
validated before anything else executes (FR-011).

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | integer | yes | Config schema version; run fails if unsupported. |
| `agents` | array<ReviewAgent> | yes, non-empty | See below. Exactly one entry MUST have `role: "aggregator"` (validation rule). |
| `diff.maxBytes` | integer | no | Overrides the default truncation limit (Research #4). |
| `delivery.prComment.enabled` | boolean | no, default `true` | |
| `delivery.email.enabled` | boolean | no, default `true` | |
| `delivery.email.recipients` | array<string> | required if email enabled | Fixed address list (spec Assumptions). |
| `delivery.email.provider` | string | required if email enabled | e.g. `"resend"`, `"sendgrid"` — selects the email adapter. |
| `delivery.email.apiKeySecret` | string | required if email enabled | Name of the secret holding the provider API key. |

**Validation rules** (enforced fail-fast, FR-011):
- `agents` non-empty.
- Exactly one `role: "aggregator"` entry.
- Every `provider` value has a registered adapter (Provider Registry, Research #6).
- Every `apiKeySecret` / `email.apiKeySecret` name is non-empty (existence of the actual
  secret is checked when the run tries to resolve it — see Run.agentResults[].error).
- Unknown/unsupported `version` rejected explicitly (not silently ignored).

## ReviewAgent

One configured reviewer for a run.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Unique within `agents`; used as artifact key (`finding-<id>`) and in logs/report. |
| `provider` | string | yes | Adapter key, e.g. `"anthropic"`, `"openai"`, `"google"`. |
| `model` | string | yes | Provider-specific model identifier, passed through opaquely. |
| `apiKeySecret` | string | yes | Name of the GitHub secret holding this agent's credential. |
| `role` | `"reviewer"` \| `"aggregator"` | no, default `"reviewer"` | Exactly one `"aggregator"` per config. |
| `timeoutSeconds` | integer | no, default 180 | Per-agent call timeout (Principle VI). |

The Aggregator is not a separate type — it is the one `ReviewAgent` entry with
`role: "aggregator"`, and is invoked differently (Research consolidation, not independent
review) per Principle III.

## Run

One execution against one pull request event. Not persisted as a single object; represented
by the state of its jobs/artifacts/logs while the workflow executes.

| Field | Type | Notes |
|---|---|---|
| `pullRequest` | {owner, repo, number, headSha} | Identifies what was reviewed. |
| `diff` | string, truncated | Fetched once (Research #4), shared read-only by all agents. |
| `diffTruncated` | boolean | Surfaced in the Unified Report per FR-014. |
| `agentResults` | array<AgentResult> | One per configured `ReviewAgent` (including the aggregator's own execution record). |
| `startedAt` / `finishedAt` | timestamp | For SC-007 timing and observability logs. |

### AgentResult

| Field | Type | Notes |
|---|---|---|
| `agentId` | string | References `ReviewAgent.id`. |
| `status` | `"succeeded"` \| `"failed"` \| `"timed_out"` | Never blocks other agents (FR-004). |
| `durationMs` | integer | Logged per FR-013. |
| `approxCost` | {inputTokens, outputTokens, estimatedUsd} \| null | Best-effort; `null` if the provider response omits usage data. |
| `error` | string \| null | Present when `status != "succeeded"`. |

## FindingSet

The artifact (`finding-<agentId>.json`) one review agent produces for one run — the unit
consumed by the aggregator.

| Field | Type | Notes |
|---|---|---|
| `agentId` | string | |
| `model` | string | Echoed from config for traceability in the report. |
| `findings` | array<Finding> | Empty array on a run that succeeded but found nothing. |
| `summary` | string | Agent's own short overview, if it produced one. |

### Finding

| Field | Type | Notes |
|---|---|---|
| `severity` | `"blocking"` \| `"warning"` \| `"note"` | Normalizes across providers' own vocabularies. |
| `file` | string \| null | Path, if applicable. |
| `line` | integer \| null | |
| `description` | string | |

## UnifiedReport

The Aggregator's synthesized output for a run (Principle III) — the payload every delivery
channel receives.

| Field | Type | Notes |
|---|---|---|
| `pullRequest` | {owner, repo, number} | |
| `generatedAt` | timestamp | |
| `body` | string (Markdown) | Rendered report content; begins with the idempotency marker (Research #3) when used for the PR-comment channel. |
| `agentsReported` | array<string> | `ReviewAgent.id`s whose findings were included. |
| `agentsMissing` | array<{agentId, reason}> | Per FR-006. |
| `diffTruncated` | boolean | Passed through from Run. |

## Delivery Channel (interface, not a data entity)

Every channel implementation (`prComment`, `email`, future ones) accepts a `UnifiedReport`
and delivery-specific config, and returns a delivery outcome independent of other channels
(Principle IV/VII):

```text
deliver(report: UnifiedReport, config: ChannelConfig) -> { delivered: boolean, error?: string }
```

A channel's failure is captured in its own outcome and MUST NOT throw in a way that stops
other channels from running (FR-009) — enforced at the orchration level, each channel call
isolated in its own try/catch (or its own job step).

## Entity relationships

```text
Configuration 1───* ReviewAgent (exactly one has role="aggregator")
Run 1───1 Configuration (as read at run start)
Run 1───* AgentResult (one per ReviewAgent)
AgentResult 0..1───1 FindingSet (present only when status="succeeded")
Run 1───0..1 UnifiedReport (absent if aggregation itself fails — FR-012)
UnifiedReport 1───* delivery outcomes (one per enabled channel)
```
