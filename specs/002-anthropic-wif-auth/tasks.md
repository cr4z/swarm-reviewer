---

description: "Task list template for feature implementation"
---

# Tasks: Anthropic Workload Identity Federation Auth

**Input**: Design documents from `/specs/002-anthropic-wif-auth/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not explicitly requested in the spec; unit tests for the new logic (config
validation, the token-exchange function, the adapter's header branching) land in Polish,
matching spec 001's approach.

**Scope note**: This feature extends the existing spec-001 codebase — every task below
modifies an existing file unless marked otherwise. No new project structure is introduced.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: The shared config/type/credential-exchange plumbing every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T001 [P] Implement `src/lib/federation.ts` — `exchangeGithubOidcForAnthropicToken()`: one `POST https://api.anthropic.com/v1/oauth/token` per `contracts/federation-auth-contract.md`, returning `{accessToken, expiresInSeconds}`; never includes the JWT or response body verbatim in a thrown error message
- [ ] T002 Update `src/config/schema.ts` — make `apiKeySecret` optional on `reviewAgent`, add the `federationAuth` `$def` (`type`, `federationRuleId`, `organizationId`, `serviceAccountId`, optional `workspaceId`) and a `properties.auth` reference to it, per `contracts/federation-auth-contract.md` (depends on nothing, but precedes T003)
- [ ] T003 Update `src/config/validate.ts` — add: exactly one of `apiKeySecret`/`auth` per agent (FR-004), `auth` only valid when `provider === "anthropic"` (FR-002); both errors name the specific offending agent (depends on T002)
- [ ] T004 [P] Update `src/providers/types.ts` — add optional `authScheme?: "api_key" | "bearer"` to `ReviewRequest` and `AggregateRequest` per `contracts/federation-auth-contract.md`
- [ ] T005 Update `src/providers/anthropic.ts` — `callAnthropic` sends `x-api-key` when `authScheme` is `"api_key"`/omitted (unchanged default) or `Authorization: Bearer <apiKey>` when `authScheme === "bearer"` (depends on T004)

**Checkpoint**: Config accepts the new `auth` block with correct validation; `anthropic.ts` compiles against the extended request types. No agent can actually use WIF yet (that's US1).

---

## Phase 2: User Story 1 - Run a Claude agent with no stored API key (Priority: P1) 🎯 MVP

**Goal**: An agent configured with `provider: "anthropic"` and `auth` instead of
`apiKeySecret` authenticates via a GitHub-OIDC-derived token and its findings appear in the
report exactly as an `apiKeySecret` agent's would.

**Independent Test**: quickstart.md "Validate: happy path" — one agent on `auth`, real
federation rule, confirm findings appear and no long-lived Anthropic credential appears
anywhere in logs/artifacts.

### Implementation for User Story 1

- [ ] T006 [US1] Update `actions/run-agent/src/index.ts` — when `agent.auth` is present: call `@actions/core`'s `getIDToken("https://api.anthropic.com")`, then `exchangeGithubOidcForAnthropicToken()` (T001) with the agent's `auth` fields, then call the adapter's `review()` with `apiKey: result.accessToken, authScheme: "bearer"`; when `agent.apiKeySecret` is present, behavior is unchanged (`authScheme` omitted) (depends on T001, T003, T005)
- [ ] T007 [US1] Update `actions/aggregate/src/index.ts` — identical resolution for the single aggregator agent, since it may also use `auth` (data-model.md) (depends on T001, T003, T005)
- [ ] T008 [US1] Update `.github/workflows/review.yml` — add a job-scoped `permissions: { id-token: write }` to the `review` job and the `aggregate` job (research.md #4); leave `validate` and `deliver` unchanged (depends on T006, T007)
- [ ] T009 [US1] Run `npm run build` and commit the rebuilt `dist/index.js` for `run-agent` and `aggregate` (depends on T008)

**Checkpoint**: An anthropic agent can authenticate via WIF end-to-end; `apiKeySecret` agents are provably untouched by this phase's diff (git diff shows no change to their code path).

---

## Phase 3: User Story 2 - Adopt federation auth without breaking existing agents (Priority: P2)

**Goal**: A maintainer can move one Anthropic agent to `auth` while every other agent —
any provider, any auth mode — keeps working unchanged, and a repo that adopts nothing sees no
behavior change.

**Independent Test**: quickstart.md "Validate: mixed auth modes, no breakage" — a config with
agents spanning providers and both auth modes produces one report covering all of them.

### Implementation for User Story 2

- [ ] T010 [P] [US2] Add a mixed-auth example to `examples/` (either extend `examples/swarm-reviewer.config.json` or add a sibling file) showing one `apiKeySecret` anthropic agent and one `auth`-based anthropic agent side by side
- [ ] T011 [US2] Add a "Workload Identity Federation" section to `README.md`: what it is, that it's opt-in per Anthropic agent, a pointer to `specs/002-anthropic-wif-auth/quickstart.md` for full setup, and the `contracts/federation-auth-contract.md` config shape

**Checkpoint**: Documentation and an example exist proving mixed-mode composition; no code in this phase — US1's implementation already provides the actual non-breaking guarantee, this phase evidences it.

---

## Phase 4: User Story 3 - Federation misconfiguration fails clearly and stays isolated (Priority: P3)

**Goal**: A bad federation setup for one agent (rejected exchange, missing permission) fails
that agent with a specific, federation-related error, and never blocks the other agents or
produces a partial/misleading report.

**Independent Test**: quickstart.md "Validate: federation misconfiguration is isolated and clear" plus "Validate: config validation".

### Implementation for User Story 3

- [ ] T012 [US3] Review and harden `actions/run-agent/src/index.ts` and `actions/aggregate/src/index.ts`'s WIF path: confirm `getIDToken()`/exchange failures are caught by the same try/catch that already classifies `AgentResult.status` as `"failed"`/`"timed_out"` (T006/T007), confirm the GitHub JWT and any minted access token are redacted from thrown error messages the same way an `apiKeySecret` value already is, and confirm a missing `id-token: write` permission surfaces `getIDToken()`'s own error text verbatim (it already names the problem) rather than being swallowed (depends on T006, T007)

**Checkpoint**: All three user stories independently functional; failure paths verified against quickstart.md's misconfiguration scenarios.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Automated test coverage and live validation before this lands on `main`.

- [ ] T013 [P] Add `tests/unit/federation.test.ts` (Vitest) covering `exchangeGithubOidcForAnthropicToken()` against a mocked `fetch`: success shape, a 401 `authentication_error` response, and confirm no thrown error contains the input JWT
- [ ] T014 [P] Add cases to `tests/unit/config.test.ts`: agent with both `apiKeySecret` and `auth` (rejected), agent with neither (rejected), non-anthropic agent with `auth` (rejected, FR-002), anthropic agent with `auth` only (accepted)
- [ ] T015 [P] Add cases to `tests/unit/providers.test.ts`: `anthropic.ts` sends `x-api-key` when `authScheme` is omitted (regression guard) and `Authorization: Bearer` when `authScheme: "bearer"`
- [ ] T016 Execute `quickstart.md` end-to-end against a real Anthropic organization with a configured federation rule (constitution Development Workflow gate — required before merging to `main`)
- [ ] T017 Once T016 passes clean, note this as a MINOR version bump per the constitution's versioning policy (new capability, fully backward compatible) — coordinate the actual `v1.x.0` tag with whatever spec 001 features have landed by then

---

## Dependencies & Execution Order

### Phase Dependencies

- **Foundational (Phase 1)**: no dependencies on other 002 work — BLOCKS every user story.
- **User Story 1 (Phase 2)**: depends on Foundational only. This is the MVP — nothing else in
  this feature is demonstrable before it exists.
- **User Story 2 (Phase 3)**: depends on Foundational; in practice also depends on US1 (it
  documents/exemplifies behavior US1 already implements — no new code path).
- **User Story 3 (Phase 4)**: depends on US1's `run-agent`/`aggregate` changes existing to
  harden.
- **Polish (Phase 5)**: depends on all three stories being complete.

### Parallel Opportunities

- Foundational: T001 and T004 are independent of each other and of T002 (all touch different
  files); T003 waits on T002, T005 waits on T004.
- US1: T006 and T007 touch different files and can proceed in parallel once Foundational is
  done.
- US2's T010 and T011 can run in parallel with US3's T012 — different files, no shared
  dependency beyond both needing US1 complete.
- Polish: T013, T014, T015 in parallel.

---

## Parallel Example: Foundational

```bash
Task: "Implement src/lib/federation.ts"
Task: "Update src/providers/types.ts to add authScheme"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1: Foundational
2. Phase 2: User Story 1 — an Anthropic agent authenticates via WIF end-to-end
3. Run quickstart.md's happy-path validation against a real federation rule
4. That is the complete value of this feature; US2 and US3 harden and document it

### Incremental Delivery

1. Foundational → US1 → validate independently → this is the MVP.
2. US2 → docs/example proving non-breakage → validate independently.
3. US3 → failure-path hardening review → validate independently.
4. Polish → unit tests, live quickstart run, version-bump note.

---

## Notes

- [P] tasks touch different files with no unmet dependency.
- This feature intentionally adds only one new source file (`src/lib/federation.ts`) — every
  other task modifies existing spec-001 code, per plan.md's Project Structure.
- T009 (`dist/` rebuild-and-commit) is its own task for the same reason spec 001 called it out
  separately: bundling is easy to forget and this project's reusability model depends on it.
