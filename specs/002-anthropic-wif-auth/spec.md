# Feature Specification: Anthropic Workload Identity Federation Auth

**Feature Branch**: `002-anthropic-wif-auth`

**Created**: 2026-09-05

**Status**: Draft

**Input**: User description: "Anthropic Workload Identity Federation (WIF) support for the \"anthropic\" provider adapter. Today every configured agent authenticates to its provider via a static, long-lived API key stored as a GitHub Actions secret and referenced by name (apiKeySecret). For agents using the Anthropic provider specifically, a maintainer should be able to opt into GitHub Actions OIDC-based authentication instead: no static Anthropic API key stored anywhere, short-lived tokens exchanged per run via Anthropic's federation (a federation rule the org admin configures once in the Anthropic Console, mapping GitHub's OIDC issuer to a service account), using GitHub's native `id-token: write` permission and OIDC token. This is additive and opt-in per agent — apiKeySecret-based auth must keep working unchanged for every provider including Anthropic; WIF is only ever an alternative auth mode for agents whose provider is \"anthropic\" (the other three MVP providers don't support it and are out of scope for this feature). A single Configuration may mix agents using apiKeySecret and agents using WIF freely."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run a Claude agent with no stored API key (Priority: P1)

A maintainer wants a Claude review agent to authenticate using their organization's existing
trust relationship with GitHub, instead of generating and storing an Anthropic API key as a
repository secret.

**Why this priority**: This is the entire value of the feature — eliminating a long-lived
credential that could leak, need rotation, or be over-scoped. Nothing else matters if this
doesn't work.

**Independent Test**: Configure one agent with `provider: "anthropic"` and federation auth
(no `apiKeySecret`) against an Anthropic org with a working federation rule; open a pull
request and confirm that agent's findings appear in the report, with no Anthropic API key
ever having existed as a secret in the repository.

**Acceptance Scenarios**:

1. **Given** an agent configured with `provider: "anthropic"` and federation auth instead of
   `apiKeySecret`, **When** a run executes, **Then** that agent authenticates using a
   short-lived credential obtained via GitHub's OIDC identity for that run, and its findings
   appear in the unified report exactly as an `apiKeySecret`-based agent's would.
2. **Given** the same run, **When** it completes, **Then** no long-lived Anthropic credential
   for that agent appears in any log, artifact, or the report itself.

---

### User Story 2 - Adopt federation auth without breaking existing agents (Priority: P2)

A maintainer with an already-working configuration wants to move one Anthropic agent to
federation auth while every other agent — including other Anthropic agents still using
`apiKeySecret` — keeps working exactly as before.

**Why this priority**: Without this, adopting the feature would require an all-or-nothing,
risky cutover. Gradual adoption is what makes it safe to try.

**Independent Test**: Take a working multi-agent configuration, change only one Anthropic
agent's auth from `apiKeySecret` to federation, leave every other agent untouched, and
confirm a run still produces one unified report covering all agents.

**Acceptance Scenarios**:

1. **Given** a configuration with agents on multiple providers plus two Anthropic agents both
   using `apiKeySecret`, **When** a maintainer changes only one of the two Anthropic agents to
   federation auth, **Then** the next run succeeds for all agents with no other configuration
   or workflow change required.
2. **Given** a configuration where every agent still uses `apiKeySecret` (federation auth
   unused), **When** a run executes, **Then** behavior is identical to before this feature
   existed.

---

### User Story 3 - Federation misconfiguration fails clearly and stays isolated (Priority: P3)

A maintainer's federation setup is incomplete or wrong (the Anthropic-side federation rule
doesn't exist yet, or the run lacks the GitHub permission needed to obtain an OIDC token).
The maintainer needs to know exactly which agent and why, and every other agent must still
complete.

**Why this priority**: A new, unfamiliar auth mode that fails opaquely — or that takes down
unrelated agents when it fails — would make this feature something people are afraid to turn
on. Trustworthy failure is what makes it adoptable.

**Independent Test**: Configure one agent for federation auth against an org with no matching
federation rule (or omit the GitHub permission needed to mint the token), alongside other
working `apiKeySecret` agents; confirm the run still produces a report from the working
agents, explicitly naming the misconfigured one.

**Acceptance Scenarios**:

1. **Given** an agent configured for federation auth whose token exchange is rejected (no
   matching federation rule on the Anthropic side), **When** a run executes, **Then** that
   agent is recorded as failed with a specific, federation-related error, and the report still
   includes the other agents' findings.
2. **Given** a configuration where an agent declares federation auth but the workflow run
   lacks the GitHub permission required to obtain an OIDC token, **When** the run executes,
   **Then** the failure is specific to that permission problem, not a generic or unrelated
   error.

---

### Edge Cases

- What happens when an agent declares federation auth but its `provider` is not `"anthropic"`?
  Rejected as a configuration error before any agent runs — federation auth is Anthropic-only
  in this feature (per Assumptions).
- What happens when an agent declares both `apiKeySecret` and federation auth at once, or
  neither? Rejected as a configuration error identifying the specific agent — exactly one auth
  mode is required per agent, same fail-fast posture as every other configuration rule.
- What happens when the Anthropic-side federation rule exists but points at the wrong GitHub
  repository or service account? The token exchange is rejected by Anthropic; this surfaces as
  that agent's failure (User Story 3), not a workflow-wide failure.
- What happens when a maintainer removes the last `apiKeySecret`-based Anthropic agent and all
  remaining Anthropic agents use federation auth? The Anthropic API key secret, if still
  present in the repository, simply becomes unused — this feature does not require deleting it
  and does not fail if it's still there.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow an agent whose `provider` is `"anthropic"` to use either
  `apiKeySecret`-based authentication (existing) or GitHub OIDC-based federation
  authentication (new), selected per agent.
- **FR-002**: System MUST reject federation authentication for any agent whose `provider` is
  not `"anthropic"` as a configuration error, since no other MVP provider supports it.
- **FR-003**: A single Configuration MUST support agents using different auth modes at the
  same time, including multiple Anthropic agents where some use `apiKeySecret` and others use
  federation auth.
- **FR-004**: System MUST validate that every agent declares exactly one auth mode — never
  both `apiKeySecret` and federation auth, never neither — failing the run before any agent
  executes, with an error identifying the specific offending agent.
- **FR-005**: For an agent using federation auth, System MUST obtain its credential via
  GitHub's OIDC identity for that run, and MUST NOT write that credential (or the longer-lived
  Anthropic-issued token derived from it) to any log, artifact, or delivered report.
- **FR-006**: The reusable workflow MUST be able to obtain a GitHub OIDC token when any agent
  might need one, but MUST only actually request one for agents configured for federation
  auth — never for `apiKeySecret`-based agents, even when the permission to do so is present.
- **FR-007**: Consuming repositories MUST be able to adopt federation auth for one or more
  Anthropic agents without any change to other agents already working with `apiKeySecret`, on
  Anthropic or any other provider.
- **FR-008**: When federation authentication fails for an agent (rejected token exchange,
  missing GitHub permission, or any other federation-specific failure), System MUST record
  that agent's failure with a specific, federation-related error and MUST NOT block or fail
  the other configured agents (consistent with existing per-agent failure isolation).
- **FR-009**: System MUST document the one-time setup a maintainer performs outside the
  workflow itself — creating a federation rule in the Anthropic Console that maps GitHub's
  OIDC issuer to a service account — since this feature cannot automate or perform that setup.

### Key Entities

- **ReviewAgent** *(extended)*: gains an authentication mode alongside its existing fields —
  exactly one of `apiKeySecret` (existing) or a federation configuration (new) — instead of
  always requiring `apiKeySecret`.
- **Federation Auth Configuration**: the non-secret identifiers needed to request a
  short-lived credential from Anthropic's federation endpoint using GitHub's OIDC token for
  that run (e.g. the organization, service account, and federation rule to present against).
  These are configuration values, not secrets — none of them alone grants access without a
  live GitHub OIDC token from the same run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A maintainer can move an existing Anthropic agent from `apiKeySecret` to
  federation auth by editing only the configuration file — no other agent's configuration and
  no workflow file change is required.
- **SC-002**: A repository whose Anthropic agents all use federation auth requires zero
  Anthropic API keys stored as secrets for those agents to keep working.
- **SC-003**: A federation misconfiguration affecting one agent does not prevent a report from
  being produced from the other configured agents' results in the same run.
- **SC-004**: Every federation-related failure names the specific agent and the specific
  problem, distinguishable at a glance from an `apiKeySecret`-related failure.
- **SC-005**: A repository that adopts no part of this feature (all agents still on
  `apiKeySecret`) sees no behavior change after this feature ships.

## Assumptions

- The organization-level federation rule itself (issuer URL, key source, mapping GitHub's
  OIDC claims to a service account) is configured once, out-of-band, by an org admin in the
  Anthropic Console or Admin API — this feature consumes that setup but does not perform it.
- Federation auth is Anthropic-only for this feature; the other three MVP providers (OpenAI,
  DeepSeek, Kimi) are unaffected and out of scope, consistent with the project's existing MVP
  provider scope (spec 001's Assumptions).
- This feature assumes standard GitHub-hosted runners using GitHub's own OIDC token issuer
  (`token.actions.githubusercontent.com`); self-hosted-runner OIDC nuances are out of scope.
- The non-secret federation identifiers (organization ID, service account ID, federation rule
  identifier) live in the configuration file itself, not as secrets, since none of them alone
  is a usable credential without a live GitHub OIDC token from the same run.
- The default authentication mode when unspecified remains `apiKeySecret` — no existing
  configuration requires any change as a result of this feature shipping.
