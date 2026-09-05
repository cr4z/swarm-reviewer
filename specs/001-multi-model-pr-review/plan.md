# Implementation Plan: Multi-Model PR Review

**Branch**: `001-multi-model-pr-review` (developed on `claude/spec-kit-swarm-reviewer`) | **Date**: 2026-08-31 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-multi-model-pr-review/spec.md`

## Summary

A reusable GitHub Actions workflow (`workflow_call`) that runs an arbitrary, config-defined
set of model-provider review agents in parallel against a pull request's diff, then has one
designated aggregator agent synthesize their findings into a single report delivered as an
idempotent PR comment and an email. Implemented as TypeScript composite actions (bundled to
`dist/`) orchestrated by one workflow YAML: a config-validation job, a matrix job (one leg per
configured agent, `fail-fast: false`), an aggregation job, and a delivery job — each provider
and each delivery channel is a small adapter behind a shared interface so the panel of models
and the set of delivery channels are both open to extension without touching orchestration
logic.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 20 (GitHub Actions' current LTS `node20` runtime).

**Primary Dependencies**: `@actions/core`, `@actions/github` (first-party Actions toolkit,
not an orchestration framework); `ajv` (config JSON Schema validation); `esbuild` (bundles
each action's TypeScript to a single committed `dist/index.js`, dev-time only). Provider and
email-provider HTTP calls use Node 20's built-in `fetch` — no per-provider SDK dependency.

**Storage**: N/A — stateless per run; inter-job data passed as build artifacts
(`finding-<agentId>.json`), not persisted beyond the run's artifact retention window.

**Testing**: Vitest for unit tests (config validation, adapters against recorded
fixtures, comment-upsert logic against a mocked GitHub API); `actionlint` for workflow/action
YAML; the `quickstart.md` scratch-repo run stands in for integration testing, per the
constitution's Development Workflow gate (no scratch-repo test harness is committed to this
repo itself — see Complexity Tracking).

**Target Platform**: GitHub Actions runners (`ubuntu-latest`).

**Project Type**: GitHub Action / reusable workflow repository (not a library, CLI, or
service — consumers reference it via `uses:`, they never install or run it directly).

**Performance Goals**: Total run time dominated by the slowest configured agent's API call,
not this repo's own code; target p95 under 5 minutes for a diff at the default truncation
limit, consistent with a PR-review turnaround expectation (SC-007 sets the email-vs-comment
gap at 5 minutes).

**Constraints**: Diff sent to any agent capped at a default 200 KB (configurable via
`diff.maxBytes`), truncation surfaced in the report (FR-014); every agent call bounded by its
own `timeoutSeconds` (default 180s, FR-004/Principle VI); no credential value may appear in
logs, artifacts, comments, or email (FR-015).

**Scale/Scope**: Consumer-defined number of agents per run, practically bounded by GitHub
Actions' 256-job matrix ceiling — far above any realistic panel size; one PR per run, no
cross-PR or cross-run state.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design below.*

| Principle | Check | Status |
|---|---|---|
| I. Model-Agnostic by Design | Agents fully defined in `Configuration.agents[]`; provider dispatch via `ProviderAdapter` registry (contracts/provider-adapter-contract.md) — new provider = new file + registry entry, no orchestration change. Invalid/missing config fails fast (FR-011, data-model.md validation rules). | PASS |
| II. Fan-Out / Fan-In Architecture | Matrix job over `agents[]`, `fail-fast: false`; each leg's result persisted as its own artifact (research.md #2) independent of the others. | PASS |
| III. Single Aggregator Synthesis | Exactly one `role: "aggregator"` enforced by config validation; aggregator consumes `FindingSet[]`, does not call `review()` (contracts/provider-adapter-contract.md separates `review` and `aggregate`). | PASS |
| IV. Dual-Channel Delivery | `prComment` and `email` channels both run off one `UnifiedReport`; upsert-by-marker (research.md #3), never delete+recreate; FR-009 isolation captured in `DeliveryOutcome` per channel (contracts/delivery-channel-contract.md). | PASS |
| V. Reusability via workflow_call | `on: workflow_call` with a minimal, versioned input/secrets contract (contracts/workflow-call-contract.md); consumers integrate with `uses:` + `secrets: inherit` + one config file, no copied logic. | PASS |
| VI. Secret Safety & Cost Awareness | Secrets resolved only by name from config, never logged (adapter contract explicitly forbids credential values in thrown errors); diff truncation + per-agent timeout are first-class config fields. | PASS |
| VII. Clean Code & Extensible Architecture (SOLID) | Provider adapters and delivery channels are both registry-based Open/Closed extension points (contracts/*-contract.md); TypeScript interfaces make the contracts enforceable, not just documented. | PASS |
| VIII. Observability | `AgentResult` records status/duration/approxCost per agent (data-model.md); run's job summary is the log surface (FR-013), no local reproduction needed. | PASS |
| Licensing & Distribution Posture | No code change implied; `TODO(LICENSE)` remains open per constitution, tracked outside this feature. | N/A (governance-only) |

No violations — Complexity Tracking table below is empty as a result.

## Project Structure

### Documentation (this feature)

```text
specs/001-multi-model-pr-review/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output
├── quickstart.md         # Phase 1 output
├── contracts/            # Phase 1 output
│   ├── workflow-call-contract.md
│   ├── provider-adapter-contract.md
│   ├── delivery-channel-contract.md
│   ├── config.schema.json
│   └── finding-set.schema.json
└── tasks.md              # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

**Structure Decision**: Single project. This repository has no "frontend/backend" split and
is not a conventional app — it is a set of composite GitHub Actions plus the one reusable
workflow YAML that wires them together, backed by a `src/` of adapters and shared logic that
every action's bundled `dist/` is built from.

```text
.github/
└── workflows/
    └── review.yml                # workflow_call entrypoint (Project Structure — the contract)

actions/
├── validate-config/
│   ├── action.yml                 # composite action: parse+validate config & agent list
│   └── dist/index.js              # bundled, committed
├── run-agent/
│   ├── action.yml                 # composite action: one matrix leg — dispatch to a ProviderAdapter
│   └── dist/index.js
├── aggregate/
│   ├── action.yml                 # composite action: run the aggregator agent, build UnifiedReport
│   └── dist/index.js
└── deliver/
    ├── action.yml                 # composite action: run all enabled DeliveryChannels
    └── dist/index.js

src/
├── config/
│   ├── schema.ts                  # ajv schema (source of contracts/config.schema.json)
│   └── validate.ts                # fail-fast validation incl. "exactly one aggregator"
├── providers/
│   ├── types.ts                   # ProviderAdapter, ReviewRequest/Response, etc.
│   ├── registry.ts
│   ├── anthropic.ts               # Claude
│   ├── openai.ts                  # ChatGPT
│   ├── deepseek.ts
│   └── kimi.ts                    # Moonshot AI
├── delivery/
│   ├── types.ts                   # DeliveryChannel, DeliveryOutcome
│   ├── registry.ts
│   ├── pr-comment.ts               # upsert-by-marker (research.md #3)
│   ├── email.ts                    # dispatches to email-providers/*
│   └── email-providers/
│       ├── resend.ts
│       └── sendgrid.ts
└── lib/
    ├── diff.ts                     # fetch + truncate PR diff (research.md #4)
    ├── github-client.ts             # thin wrapper over @actions/github
    └── observability.ts             # per-agent status/duration/cost -> job summary (Principle VIII)

tests/
├── unit/                           # Vitest: config, adapters (fixture-driven), comment upsert
└── fixtures/                       # recorded provider responses used by adapter unit tests

examples/
└── swarm-reviewer.config.json      # copy-paste starting config for consumers (quickstart.md)

specs/
└── 001-multi-model-pr-review/      # this feature's spec-kit artifacts
```

## Complexity Tracking

*No entries — Constitution Check above passed with no violations requiring justification.*
