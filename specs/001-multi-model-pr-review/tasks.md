---

description: "Task list template for feature implementation"
---

# Tasks: Multi-Model PR Review

**Input**: Design documents from `/specs/001-multi-model-pr-review/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not explicitly requested in the spec; unit tests for the riskiest logic (config
validation, comment upsert, provider adapters) are included in Polish rather than as
per-story TDD gates, since Vitest was already committed to in plan.md's Technical Context.

**Organization**: Tasks are grouped by user story (spec.md P1/P2/P3) to enable independent
implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- File paths are exact, per plan.md's Project Structure

---

## Phase 1: Setup

**Purpose**: Repository scaffolding, shared toolchain — no feature logic yet.

- [ ] T001 Create the directory structure from plan.md's Project Structure (`.github/workflows/`, `actions/{validate-config,run-agent,aggregate,deliver}/`, `src/{config,providers,delivery,lib}/`, `tests/{unit,fixtures}/`, `examples/`)
- [ ] T002 Initialize `package.json` and `tsconfig.json` at repo root: TypeScript 5.x, Node 20 target, dependencies `@actions/core`, `@actions/github`, `ajv`; devDependencies `esbuild`, `vitest`, `typescript`
- [ ] T003 Add `.github/workflows/ci.yml` for this repository's own CI: run `npm run build`, `npm test`, and `actionlint` against `.github/workflows/**` and `actions/*/action.yml` on every push/PR (constitution Development Workflow gate)
- [ ] T004 [P] Add `package.json` scripts: `build` (esbuild-bundles each of the 4 actions' `src` entry to its own `dist/index.js`), `test` (vitest run), `lint` (actionlint)
- [ ] T005 [P] Add `examples/swarm-reviewer.config.json` as a starter config matching `contracts/config.schema.json` (one aggregator + one reviewer, both provider `"anthropic"`, to keep Setup buildable before other providers exist)

**Checkpoint**: Toolchain builds and runs (even with empty `src/`), CI skeleton exists.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared infrastructure every user story's actions depend on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T006 [P] Implement `src/config/schema.ts` — ajv schema mirroring `contracts/config.schema.json`
- [ ] T007 Implement `src/config/validate.ts` — fail-fast validation: schema check via T006, exactly-one-`role:"aggregator"` rule, non-empty `agents[]`, unsupported `version` rejection; accepts an injected `knownProviders: string[]` so it doesn't depend on the provider registry directly (depends on T006)
- [ ] T008 [P] Implement `src/lib/diff.ts` — fetch a PR's diff via `GET /repos/{owner}/{repo}/pulls/{pull_number}` (`Accept: application/vnd.github.v3.diff`), truncate to `diff.maxBytes` (default from data-model.md), return `{ diff, diffTruncated }`
- [ ] T009 [P] Implement `src/lib/github-client.ts` — thin wrapper over `@actions/github`'s Octokit for the calls T008/pr-comment/deliver need
- [ ] T010 [P] Implement `src/lib/observability.ts` — records per-agent `{status, durationMs, approxCost}` and writes a GitHub Actions job summary table (Principle VIII)
- [ ] T011 [P] Implement `src/providers/types.ts` — `ProviderAdapter`, `ReviewRequest/Response`, `AggregateRequest/Response` per `contracts/provider-adapter-contract.md`
- [ ] T012 Implement `src/providers/registry.ts` — `Map<string, ProviderAdapter>` with a `register`/`get` API (depends on T011)
- [ ] T013 [P] Implement `src/delivery/types.ts` — `DeliveryChannel`, `DeliveryOutcome` per `contracts/delivery-channel-contract.md`
- [ ] T014 Implement `src/delivery/registry.ts` — `Map<string, DeliveryChannel>` with a `register`/`get` API (depends on T013)
- [ ] T015 Implement `actions/validate-config/action.yml` + entry script — reads the config file, resolves `knownProviders` from T012's registry, runs T007, fails the job with the specific problem on any violation (depends on T007, T012)

**Checkpoint**: Shared config/provider/delivery scaffolding compiles; `validate-config` runs standalone against `examples/swarm-reviewer.config.json`.

---

## Phase 3: User Story 1 - Get a unified multi-model review on a PR (Priority: P1) 🎯 MVP

**Goal**: A PR gets exactly one synthesized report comment plus an email, sourced from every
configured agent, and a re-run updates that same comment in place.

**Independent Test**: quickstart.md "Validate: happy path" — open a PR against a scratch
consumer repo configured with ≥2 review agents + 1 aggregator; confirm one report comment,
one email, and that a follow-up commit updates the same comment rather than adding a new one.

### Implementation for User Story 1

- [ ] T016 [P] [US1] Implement `src/providers/anthropic.ts` — first `ProviderAdapter`, implementing both `review()` and `aggregate()` (depends on T011)
- [ ] T017 [US1] Register the anthropic adapter in `src/providers/registry.ts` (depends on T016, T012)
- [ ] T018 [US1] Implement `actions/run-agent/action.yml` + entry — resolve `secrets[matrix.agent.apiKeySecret]`, fetch/truncate the diff via T008, call the matching adapter's `review()` with `timeoutSeconds`, write `finding-<agentId>.json` as a build artifact, record an `AgentResult` via T010 even on failure (depends on T008, T009, T010, T012, T017)
- [ ] T019 [US1] Implement `actions/aggregate/action.yml` + entry — download all `finding-*` artifacts, call the aggregator agent's adapter `aggregate()`, build a `UnifiedReport` whose `body` starts with the `<!-- swarm-reviewer:report:v1 -->` marker (depends on T012, T017)
- [ ] T020 [P] [US1] Implement `src/delivery/pr-comment.ts` — list PR issue comments, find one whose body starts with the marker, `PATCH` it if found else `POST` a new one (research.md #3, FR-010) (depends on T009, T013)
- [ ] T021 [P] [US1] Implement `src/delivery/email-providers/resend.ts` — POST a `UnifiedReport` render to the Resend HTTP API (depends on T013)
- [ ] T022 [US1] Implement `src/delivery/email.ts` — dispatches to the configured email provider adapter (depends on T021)
- [ ] T023 [US1] Register `pr-comment` and `email` channels in `src/delivery/registry.ts` (depends on T020, T022, T014)
- [ ] T024 [US1] Implement `actions/deliver/action.yml` + entry — invoke every channel enabled in config from the registry, isolate each in its own try/catch, collect `DeliveryOutcome[]` and log via T010 (FR-009) (depends on T014, T023, T010)
- [ ] T025 [US1] Implement `.github/workflows/review.yml` — the `workflow_call` entrypoint wiring `validate-config` → matrix over `agents[]` (`fail-fast: false`) running `run-agent` → `aggregate` (`if: always()`) → `deliver`, matching `contracts/workflow-call-contract.md`'s inputs (depends on T015, T018, T019, T024)
- [ ] T026 [US1] Run `npm run build` and commit the resulting `dist/index.js` for `validate-config`, `run-agent`, `aggregate`, `deliver` (depends on T025)

**Checkpoint**: User Story 1 is fully functional and independently testable via quickstart.md.

---

## Phase 4: User Story 2 - Configure which models review PRs (Priority: P2)

**Goal**: The panel of reviewing models is genuinely maintainer-controlled, not just
multi-agent-on-one-vendor.

**Independent Test**: quickstart.md "Validate: reconfiguration without workflow changes" —
add a third agent entry (a different provider) to the config file only; confirm its findings
appear in the next report with no `.yml` changes.

### Implementation for User Story 2

- [ ] T027 [P] [US2] Implement `src/providers/openai.ts` — second `ProviderAdapter` (depends on T011)
- [ ] T028 [P] [US2] Implement `src/providers/google.ts` — third `ProviderAdapter` (depends on T011)
- [ ] T029 [US2] Register the openai and google adapters in `src/providers/registry.ts` (depends on T027, T028, T012)
- [ ] T030 [US2] Rebuild and commit `dist/index.js` for `run-agent` and `aggregate` so the new adapters are actually bundled (depends on T029, T026)
- [ ] T031 [P] [US2] Update `examples/swarm-reviewer.config.json` to a 3-agent, 2-provider example (e.g. anthropic + openai, one as aggregator) demonstrating config-only composition
- [ ] T032 [US2] Add a "Configuring agents" section to `README.md` documenting add/remove-agent-via-config-only and how to add a new provider (points at `contracts/provider-adapter-contract.md`)

**Checkpoint**: User Stories 1 and 2 both independently functional.

---

## Phase 5: User Story 3 - Review still completes when something goes wrong (Priority: P3)

**Goal**: Partial agent failure still yields a trustworthy report; total misconfiguration
fails loudly instead of producing anything.

**Independent Test**: quickstart.md "Validate: partial failure" and "Validate: fail-fast on
bad configuration" — break one agent's credential (report still arrives, names the failure);
break the config itself (run fails immediately, nothing is posted or emailed).

### Implementation for User Story 3

- [ ] T033 [US3] Harden `actions/run-agent` entry: enforce `timeoutSeconds` explicitly, classify failures as `"failed"` vs `"timed_out"`, and ensure no thrown error message can contain a credential value (Principle VI) (depends on T018)
- [ ] T034 [US3] Harden `actions/aggregate` entry: build `agentsMissing[]` from any expected `finding-<id>.json` that is absent or fails to parse, and make the `UnifiedReport.body` explicitly name each missing agent (FR-006) (depends on T019)
- [ ] T035 [US3] Handle total-failure in `actions/aggregate` entry: when zero `FindingSet`s are available, fail the job instead of producing a `UnifiedReport` (FR-012) (depends on T019, T034)
- [ ] T036 [US3] Harden `src/config/validate.ts` error messages so each failure names the exact offending field/agent (missing field, zero/multiple aggregators, unknown provider key, unsupported `version`) (FR-011) (depends on T007)
- [ ] T037 [US3] In `.github/workflows/review.yml`, gate the `deliver` job on `aggregate` having actually produced a report (job-level `if:`), so a failed aggregation never reaches delivery (depends on T025, T035)

**Checkpoint**: All three user stories independently functional; failure paths verified against quickstart.md.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Quality gates and documentation spanning all stories.

- [ ] T038 [P] Add `tests/unit/config.test.ts` (Vitest) covering `src/config/validate.ts`: valid config, missing required field, zero aggregators, two aggregators, unknown provider, unsupported version
- [ ] T039 [P] Add `tests/unit/pr-comment.test.ts` (Vitest) covering `src/delivery/pr-comment.ts` against a mocked GitHub client: no existing marker comment → POST; existing marker comment → PATCH, never delete+recreate
- [ ] T040 [P] Add `tests/fixtures/` recorded provider responses and `tests/unit/providers.test.ts` exercising each adapter's request/response mapping without live network calls
- [ ] T041 [P] Write top-level `README.md`: what this is, quickstart summary, link to `contracts/config.schema.json` and `quickstart.md`
- [ ] T042 Execute `quickstart.md` end-to-end against a real scratch consumer repo (constitution Development Workflow gate — required before tagging)
- [ ] T043 Tag `v1.0.0` and the rolling `v1` ref per Principle V, only after T042 passes clean

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup — BLOCKS all user stories.
- **User Story 1 (Phase 3)**: depends on Foundational only. This is the MVP; nothing else can
  be demonstrated before it exists, since it builds the whole pipeline's first working slice.
- **User Story 2 (Phase 4)**: depends on Foundational; in practice also depends on US1's
  `run-agent`/`aggregate`/registries existing to register additional adapters into (T027-T030
  extend files US1 created).
- **User Story 3 (Phase 5)**: depends on Foundational; hardens `run-agent`/`aggregate`/
  `validate-config`/`review.yml` that US1 created, so it follows US1 (and can proceed in
  parallel with US2 — they touch different files).
- **Polish (Phase 6)**: depends on the stories being polished existing (T038-T040 need Phase
  2/3 code to exist; T042/T043 need all desired stories complete).

### Parallel Opportunities

- Setup: T004, T005 in parallel.
- Foundational: T006, T008, T009, T010, T011, T013 in parallel (independent files); T007
  waits on T006, T012 waits on T011, T014 waits on T013, T015 waits on T007+T012.
- US1: T016 can start immediately after Foundational; T020, T021 are parallel with T016-T019
  (different files, no shared dependency until T023).
- US2 and US3 can be worked in parallel by different people once US1 is done — US2 only adds
  provider files and docs, US3 only hardens existing action entry scripts and config
  validation messages; they don't touch the same lines.
- Polish: T038, T039, T040, T041 in parallel.

---

## Parallel Example: User Story 1

```bash
# After Foundational is done, these have no dependency on each other:
Task: "Implement src/providers/anthropic.ts"
Task: "Implement src/delivery/pr-comment.ts"
Task: "Implement src/delivery/email-providers/resend.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Setup
2. Phase 2: Foundational (blocks everything)
3. Phase 3: User Story 1
4. Run quickstart.md's happy-path validation against a scratch consumer repo
5. That's a working, single-provider, dual-channel, idempotent-comment review pipeline —
   already the whole value proposition for one model.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. User Story 1 → validate independently → this is the MVP.
3. User Story 2 → adds real multi-provider proof + docs → validate independently.
4. User Story 3 → hardens failure paths → validate independently.
5. Polish → tests, docs, quickstart sign-off, v1.0.0 tag.

---

## Notes

- [P] tasks touch different files with no unmet dependency.
- [Story] labels trace every user-story-phase task back to spec.md.
- Commit after each task or logical group (per this repo's own git conventions).
- T026/T030 (`dist/` rebuild-and-commit) are deliberately separate tasks, not folded into the
  source-change tasks — bundling is a distinct, easy-to-forget step this project's whole
  reusability model (Principle V) depends on.
