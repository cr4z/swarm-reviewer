# Phase 0 Research: Anthropic Workload Identity Federation Auth

## 1. What the token exchange actually requires (live docs, 2026-09-05)

**Decision**: Implement the exchange as one hand-rolled `fetch` call, no SDK.

`POST https://api.anthropic.com/v1/oauth/token`, JSON body:

```json
{
  "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
  "assertion": "<GitHub OIDC JWT>",
  "federation_rule_id": "fdrl_...",
  "organization_id": "<uuid>",
  "service_account_id": "svac_...",
  "workspace_id": "wrkspc_..."
}
```

`workspace_id` is required only when the federation rule spans more than one workspace;
otherwise omit it. Response (RFC 6749 §5.1):

```json
{ "access_token": "sk-ant-oat01-...", "token_type": "Bearer", "expires_in": 3600, "scope": "workspace:developer" }
```

**Rationale**: This is a single JSON POST with no signing, no crypto, and a small fixed
response shape — exactly the kind of call the project already hand-rolls for every provider
(research.md #6 from spec 001: "no per-provider SDK dependency"). Pulling in `@anthropic-ai/sdk`
for this one path would contradict that decision for a call this simple.

**Alternatives considered**: `@anthropic-ai/sdk`'s `WorkloadIdentityCredentials` — does the
same exchange plus caching/refresh we don't need (each run-agent leg is a single short-lived
process; no refresh loop is meaningful within one leg's lifetime).

## 2. The credential's own auth header differs from a stored API key

**Decision**: The minted `access_token` (`sk-ant-oat01-...`) is sent as
`Authorization: Bearer <token>` — **not** `x-api-key`, which is what every `apiKeySecret`-based
call uses today (`src/providers/anthropic.ts`'s existing `callAnthropic` sets
`"x-api-key": params.apiKey`). Extend `ReviewRequest`/`AggregateRequest` with an
`authScheme?: "api_key" | "bearer"` field (default `"api_key"`, fully backward compatible);
`anthropic.ts` branches on it when building request headers. The other three adapters are
untouched — `openai-compatible.ts` already always sends `Authorization: Bearer <apiKey>` for
its own normal API-key scheme, so the new field is simply irrelevant there.

**Rationale**: Minimal, additive, and keeps the WIF concept entirely out of the
`ProviderAdapter` contract's shape — adapters only ever see "a credential string and which
header style to use," never anything WIF-specific.

## 3. Where the OIDC token comes from inside the action — no extra step needed

**Decision**: `actions/run-agent` and `actions/aggregate`'s own bundled Node scripts call
`@actions/core`'s `getIDToken(audience)` directly — no separate `actions/github-script` step,
no temp file. `getIDToken` reads the runner-provided `ACTIONS_ID_TOKEN_REQUEST_URL` /
`ACTIONS_ID_TOKEN_REQUEST_TOKEN` env vars and makes the HTTP call itself; these env vars are
available to *any* step in a job that has `permissions: id-token: write`, not just steps using
a specific marketplace action. Audience: `"https://api.anthropic.com"` (Anthropic's documented
recommendation for the GitHub Actions provider guide).

**Rationale**: `@actions/core` is already a direct dependency (used for every input/output/log
call in every action). One extra function call needs no new step, no new dependency, and no
composite-step wiring — simpler than the docs' own composite example, which predates having a
bundled script already in the loop.

**Alternatives considered**: A dedicated `actions/github-script` step writing the JWT to a
temp file (the pattern in Anthropic's own docs, written for teams without a pre-existing
script step) — unnecessary extra step/indirection given our script already runs `@actions/core`.

## 4. Permissions: `id-token: write`, job-scoped

**Decision**: Add `permissions: { id-token: write }` at the `review` and `aggregate` job level
in `review.yml` (not workflow-wide), alongside their existing needs. This is a static
grant — GitHub Actions permissions are evaluated from the YAML before any job runs, so the
permission cannot be conditioned on whether a given run's config actually uses WIF (FR-006).
Only *calling* `getIDToken()` is conditional, gated in code on the agent's `auth.type`.

**Rationale**: Matches FR-006 exactly and keeps `validate-config`/`deliver` (which never mint
an OIDC token) unchanged. A workflow-wide grant would be simpler to write but wider than
necessary — job-scoped is one extra line per job for a real least-privilege win.

## 5. Rule matching for a `pull_request`-triggered run

**Decision**: Documented as a maintainer setup note (FR-009), not something this feature
enforces in code: for a workflow triggered by `pull_request` (this project's only supported
trigger — spec 001 Assumptions), GitHub's OIDC token's `sub` claim takes the form
`repo:<owner>/<repo>:pull_request` — different from a push-triggered run's
`repo:<owner>/<repo>:ref:refs/heads/<branch>`. A federation rule's `subject_prefix` must
account for this (e.g. `repo:<owner>/<repo>:*` plus a `repository_owner` claim check, per
Anthropic's own "Restrict which workflows can authenticate" guidance) or every PR-triggered
exchange will fail with `match_subject_prefix`.

**Rationale**: This is entirely configured on the Anthropic Console side (Assumptions, FR-009)
and cannot be validated or corrected by this codebase — surfacing it in quickstart.md's setup
steps and the README is the only thing in scope.

## 6. Config identifiers are non-secret

**Decision**: `federationRuleId`, `organizationId`, `serviceAccountId`, and the optional
`workspaceId` are stored directly in the configuration file (not as secrets) alongside the
agent entry.

**Rationale**: None of the four alone is a usable credential — every exchange still requires a
live, single-use, minutes-old GitHub OIDC JWT (Anthropic's docs: JWTs with a `jti` claim are
single-use; GitHub's tokens carry one). This matches the project's existing pattern of keeping
non-secret identifiers in config and only naming *secrets* by reference (spec 001's
`apiKeySecret` is a secret *name*, not a value, for the same reason).
