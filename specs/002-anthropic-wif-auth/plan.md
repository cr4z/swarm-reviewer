# Implementation Plan: Anthropic Workload Identity Federation Auth

**Branch**: `002-anthropic-wif-auth` (developed on `refactor/anthropic-wif-auth`) | **Date**: 2026-09-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/002-anthropic-wif-auth/spec.md`

## Summary

Add a per-agent, opt-in alternative to `apiKeySecret` for `provider: "anthropic"` agents:
GitHub's own OIDC identity, exchanged at run time for a short-lived Anthropic access token via
an org-configured federation rule, so no static Anthropic API key needs to exist as a secret.
Implemented as a small, additive extension to the existing spec-001 codebase — a new
`auth` config block, an internal `authScheme` on the provider-adapter request types (only
`anthropic.ts` branches on it), a small hand-rolled token-exchange call (`fetch`, no SDK, per
the project's existing no-per-provider-SDK stance), and `getIDToken()` calls already available
via the `@actions/core` dependency every action already has. `apiKeySecret` remains the
default and is unaffected for every provider including Anthropic.

## Technical Context

**Language/Version**: TypeScript 5.x on Node 20 — unchanged from spec 001.

**Primary Dependencies**: No new dependencies. `@actions/core` (already a dependency) provides
`getIDToken()`; the token exchange is one more `fetch` call alongside the ones
`src/providers/anthropic.ts` already makes.

**Storage**: N/A — unchanged. The new config fields (`auth.*`) are non-secret identifiers
living in the same Configuration file as everything else (research.md #6).

**Testing**: Vitest, unchanged. New cases: config validation for the `auth`/`apiKeySecret`
exclusivity and provider-scoping rules; the token-exchange function against a mocked `fetch`;
`anthropic.ts`'s header branching on `authScheme`. Live validation against a real federation
rule is `quickstart.md`'s job, same posture as spec 001.

**Target Platform**: GitHub Actions runners (`ubuntu-latest`) — unchanged.

**Project Type**: GitHub Action / reusable workflow repository — unchanged; this feature
extends the existing repo, it does not add a new project.

**Performance Goals**: Negligible change — one additional `fetch` round-trip (`getIDToken()`'s
own HTTP call to the runner, then the token exchange) only for agents that opt into WIF,
before that agent's normal review/aggregate call. No impact on `apiKeySecret` agents.

**Constraints**: The token exchange must never write the GitHub OIDC JWT, the minted Anthropic
access token, or any part of either to a log, artifact, or the report (FR-005) — same
credential-safety bar as Principle VI, extended to a second kind of credential.

**Scale/Scope**: Anthropic-only (FR-002); no change to the other three MVP providers or to
fan-out/aggregation/delivery mechanics. A single Configuration may freely mix any number of
`apiKeySecret` and WIF-based Anthropic agents (FR-003).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design below.*

| Principle | Check | Status |
|---|---|---|
| I. Model-Agnostic by Design | WIF is additive to the `anthropic` adapter only; the `ProviderAdapter` interface gains one optional field (`authScheme`) that every other adapter ignores — no change to the registry or dispatch mechanism. | PASS |
| II. Fan-Out / Fan-In Architecture | No change — a WIF agent's failure (bad federation config) is recorded and isolated exactly like any other agent failure (FR-008), still under `fail-fast: false`. | PASS |
| III. Single Aggregator Synthesis | No change — the aggregator agent may itself use WIF (data-model.md), with identical isolation semantics. | PASS |
| IV. Dual-Channel Delivery | Unaffected — this feature is entirely about acquiring one agent's credential, not the report or its delivery. | PASS |
| V. Reusability via workflow_call | The reusable workflow's contract gains one job-scoped permission (`id-token: write`) — additive, does not change required `workflow_call` inputs/secrets (federation-auth-contract.md). Non-breaking for existing consumers who add nothing to their config. | PASS |
| VI. Secret Safety & Cost Awareness | Extends this principle to a second credential type: the GitHub OIDC JWT and the minted Anthropic token get the same never-logged treatment as an `apiKeySecret` value (FR-005). No new cost surface — one extra token exchange per WIF agent is negligible relative to the model call it precedes. | PASS |
| VII. Clean Code & Extensible Architecture (SOLID) | `run-agent`/`aggregate` own credential resolution end-to-end (whether via `apiKeySecret` or a live WIF exchange); `anthropic.ts` and every other adapter stay ignorant of *how* a credential was obtained, only *how to attach it* (Open/Closed preserved). | PASS |
| VIII. Observability | A WIF agent's failure surfaces through the same `AgentResult`/job-summary mechanism as any other failure — federation-specific errors are still just `AgentResult.error` text (FR-008, SC-004). | PASS |
| Licensing & Distribution Posture | Not implicated. | N/A |

No violations — Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/002-anthropic-wif-auth/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md         # Phase 1 output (extends spec 001's data-model.md)
├── quickstart.md         # Phase 1 output
└── contracts/
    └── federation-auth-contract.md   # Config/interface delta over spec 001's contracts
```

### Source Code (repository root)

**Structure Decision**: Same single-project layout as spec 001 — this feature extends existing
files and adds a small number of new ones; it does not introduce a new top-level area.

```text
src/
├── config/
│   ├── schema.ts                  # MODIFIED: apiKeySecret optional, add federationAuth $def
│   └── validate.ts                # MODIFIED: exactly-one-auth-mode + anthropic-only rules
├── providers/
│   ├── types.ts                   # MODIFIED: ReviewRequest/AggregateRequest gain authScheme
│   └── anthropic.ts               # MODIFIED: branch x-api-key vs Authorization: Bearer
└── lib/
    └── federation.ts              # NEW: exchangeGithubOidcForAnthropicToken()

actions/
├── run-agent/src/index.ts         # MODIFIED: resolve Credential (apiKeySecret or WIF) per agent
└── aggregate/src/index.ts         # MODIFIED: same, for the single aggregator agent

.github/workflows/
└── review.yml                     # MODIFIED: id-token: write on the review + aggregate jobs

tests/unit/
├── config.test.ts                  # MODIFIED: new validation cases
├── federation.test.ts              # NEW: token-exchange function against a mocked fetch
└── providers.test.ts               # MODIFIED: anthropic.ts authScheme header branching

examples/
└── swarm-reviewer.config.json      # MODIFIED (or a sibling example): one agent shown using auth

README.md                           # MODIFIED: WIF setup pointer + link to quickstart.md
```

## Complexity Tracking

*No entries — Constitution Check above passed with no violations requiring justification.*
