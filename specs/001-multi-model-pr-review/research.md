# Phase 0 Research: Multi-Model PR Review

## 1. Getting per-agent secrets into a matrix job from a reusable workflow

**Decision**: Consuming repositories call this workflow with `secrets: inherit`. Inside the
matrix job, each agent's credential is read via bracket-indexed dynamic secrets context —
`${{ secrets[matrix.agent.api_key_secret] }}` — where `api_key_secret` is the secret *name*
declared for that agent in the config file, not the credential value itself.

**Rationale**: `workflow_call` requires every accepted secret to be declared statically in the
called workflow's `on.workflow_call.secrets` block — there is no way to declare "N secrets,
name unknown until the config file is read." `secrets: inherit` sidesteps this by handing the
called workflow the caller's whole secret set, and GitHub Actions' `secrets` context (like
`vars`, `env`, and `matrix`) supports index-by-expression, so `secrets[matrix.agent.api_key_secret]`
resolves at run time to the correctly named secret without ever naming it in the workflow file.
This is the standard, documented pattern for "one secret per matrix entry."

**Alternatives considered**:
- Declaring a fixed set of named secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...) in
  `workflow_call.secrets` — rejected: caps the provider list at design time, violating
  Principle I (Model-Agnostic by Design); adding a provider would require a workflow change.
- Passing all keys as one JSON blob input — rejected: forces consumers to serialize secrets
  into a plain input (inputs are not secret-masked the way `secrets` are), and violates
  Principle VI (Secret Safety).

## 2. Passing per-agent findings from the matrix job to the aggregator

**Decision**: Each matrix leg uploads its finding set as a build artifact named
`finding-<agent-id>` (via `actions/upload-artifact`). The aggregator job downloads all
artifacts matching `finding-*` (via `actions/download-artifact` with a pattern) after the
matrix job completes.

**Rationale**: Reusable-workflow job outputs from a matrix job do not fan back in cleanly —
each matrix leg's `outputs` overwrites the same job-level output key, and outputs are capped
well below what N findings' worth of review text would need. Artifacts have no such collision
and comfortably hold larger payloads; they are also inspectable after the run, which helps
Principle VIII (Observability).

**Alternatives considered**: Job outputs with a manual reduce step — rejected, fragile with a
variable-length matrix and too small for real findings text.

## 3. Idempotent PR comment delivery

**Decision**: Every report comment includes an HTML marker
(`<!-- swarm-reviewer:report:v1 -->`) as its first line. On each run, the PR-comment channel
lists existing issue comments on the PR via the GitHub REST API, finds one whose body starts
with that marker, and `PATCH`es it if found or `POST`s a new one if not.

**Rationale**: This is the standard bot-comment-upsert pattern and satisfies Principle IV
directly (no duplicate comments across re-runs, stable permalink).

**Alternatives considered**: Deleting and recreating the comment — explicitly disallowed by
the constitution (Principle IV); sticky-comment third-party Actions — rejected to avoid a
non-first-party dependency for something this small to implement directly.

## 4. Obtaining the PR diff

**Decision**: Fetch the diff via the GitHub REST API
(`GET /repos/{owner}/{repo}/pulls/{pull_number}` with `Accept: application/vnd.github.v3.diff`)
rather than a local `git diff`.

**Rationale**: Works without a full/deep checkout in every job (each matrix leg would
otherwise need its own checkout just to diff), is provider-symmetric (every review agent
gets the exact same bytes), and is what gets truncated/logged for Principle VI compliance.

**Alternatives considered**: `actions/checkout` + local `git diff` per matrix leg — rejected as
redundant work and CI time per agent for no benefit.

## 5. Email delivery mechanism

**Decision**: The default email channel calls a configurable transactional email provider's
HTTP API (e.g. Resend or SendGrid) directly via `fetch`, selected by a `provider` field in
delivery config, with the API key referenced the same way agent credentials are.

**Rationale**: Keeps the email channel a plain HTTP adapter with no additional Action
dependency, consistent with the same adapter pattern used for model providers, and satisfies
Principle VII (channel behind a common interface, swappable independently).

**Alternatives considered**: A third-party "send email" Action (e.g. an SMTP action) —
rejected as an unnecessary non-first-party dependency for a single HTTP POST; raw SMTP from a
script — rejected, meaningfully more code (auth handshake, MIME) for no gain over a
transactional API.

## 6. Implementation language and packaging

**Decision**: TypeScript on Node.js 20, using `@actions/core` and `@actions/github` (first-
party GitHub Actions toolkit) plus `ajv` for config schema validation. Each composite action
runs a bundled (`esbuild`) single-file JS output committed under `dist/`, following the same
pattern official GitHub Actions use.

**Rationale**: TypeScript's interfaces are the natural fit for the provider-adapter and
delivery-channel contracts the constitution requires (Principles I and VII); bundling to
`dist/` means consuming repositories never run `npm install` at use time, keeping the
"reference it, don't build it" experience in Principle V. `@actions/core`/`@actions/github`
are first-party toolkit packages, not an orchestration framework, so this stays inside the
Technical Constraints.

**Alternatives considered**: Plain Bash + `curl`/`jq` — rejected as the provider-adapter and
channel-interface abstractions become unenforceable string-matching in Bash, at odds with
Principle VII's SOLID/Clean-Code requirement; a Python implementation — workable, but Node
is the native language of the GitHub Actions toolkit and its `actions/*-artifact` ecosystem.

## 7. Workflow YAML validation

**Decision**: `actionlint` runs in this repository's own CI on every change to workflow/action
YAML, per the constitution's Development Workflow gate.

**Rationale**: Directly required by the constitution; catches matrix/`secrets[]`-expression and
schema errors that only otherwise surface on a consumer's real PR run.
