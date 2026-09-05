# Quickstart: Validate Anthropic WIF Auth End-to-End

Validates spec 002's user stories against a real Anthropic organization with Workload
Identity Federation configured (constitution Development Workflow gate — required before
tagging any release that includes this feature).

## Prerequisites

- An Anthropic organization where you (or an org admin) can create a federation issuer, rule,
  and service account (Settings → Workload identity → Connect workload → GitHub Actions).
- A scratch consumer repository already running Swarm Reviewer (spec 001's quickstart).
- Your Anthropic organization ID (Console → Settings → Organization).

## Setup: register GitHub Actions as a trusted issuer

1. In the Claude Console, **Connect workload** → **GitHub Actions**.
2. Accept the defaults (issuer `https://token.actions.githubusercontent.com`, discovery JWKS).
3. Set the rule's `subject_prefix` to match your scratch repo's **pull_request** trigger —
   `repo:<owner>/<repo>:*` plus a `repository_owner` claim check (research.md #5) — a plain
   `ref:refs/heads/main` prefix will NOT match PR-triggered runs and every exchange will fail
   with `match_subject_prefix`.
4. Note the `fdrl_...` (federation rule), `svac_...` (service account), and your `organization_id`.

## Validate: happy path (User Story 1)

1. In the scratch repo's `swarm-reviewer.config.json`, change one `provider: "anthropic"`
   agent from `apiKeySecret` to:
   ```json
   {
     "id": "claude-reviewer",
     "provider": "anthropic",
     "model": "claude-sonnet-4-5",
     "auth": {
       "type": "wif",
       "federationRuleId": "fdrl_...",
       "organizationId": "<your org id>",
       "serviceAccountId": "svac_..."
     }
   }
   ```
2. Confirm no `ANTHROPIC_API_KEY`-style secret exists for this agent anywhere in the repo.
3. Open a pull request. Confirm that agent's findings appear in the report exactly as before.
4. Inspect the run's logs: confirm no long-lived Anthropic credential appears anywhere.

## Validate: mixed auth modes, no breakage (User Story 2)

1. In the same config, leave at least one other Anthropic agent on `apiKeySecret` and add
   agents on other providers if not already present.
2. Push a commit. Confirm the report includes findings from every agent regardless of auth
   mode, and that nothing about the `apiKeySecret` agents' behavior changed.

## Validate: federation misconfiguration is isolated and clear (User Story 3)

1. Temporarily set the WIF agent's `federationRuleId` to a nonexistent value (e.g. append
   `-wrong`).
2. Push a commit. Confirm: the report still arrives, includes the other agents' findings, and
   explicitly names the WIF agent as failed with a federation-specific error (not a generic or
   unrelated one).
3. Separately, temporarily remove `id-token: write` from a local copy of `review.yml` (or, if
   testing against the published workflow directly, skip this step and rely on the code review
   of `review.yml` instead) and confirm the failure names the missing permission specifically.
4. Restore the correct `federationRuleId`.

## Validate: config validation (Edge Cases, FR-004)

1. Temporarily set an anthropic agent to have both `apiKeySecret` and `auth`, or neither.
2. Push a commit. Confirm the run fails immediately at config validation, naming the specific
   agent — no agents run, no report is produced.
3. Temporarily set a non-anthropic agent (e.g. `provider: "openai"`) to include an `auth`
   block. Confirm the same fail-fast behavior (FR-002).
4. Revert both changes.

## Clean up

Archive or delete the scratch federation rule/service account once validation passes, unless
you intend to keep using it.
