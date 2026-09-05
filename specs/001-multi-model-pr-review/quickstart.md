# Quickstart: Validate Multi-Model PR Review End-to-End

This validates the feature the way SC-001–SC-007 describe it, using a disposable consumer
repository — the constitution's Development Workflow gate requires exercising the reusable
workflow against a real PR before it is tagged for consumption.

## Prerequisites

- A `swarm-reviewer` repo with `.github/workflows/review.yml` (the `workflow_call` entrypoint)
  built per this plan, pushed to a branch or tag.
- A separate scratch consumer repository you can open PRs against.
- At least two model-provider API keys (e.g. Anthropic + OpenAI) and one transactional-email
  provider API key (e.g. Resend), added as secrets on the consumer repo.

## Setup

1. In the consumer repo, add secrets: `AGENT_A_KEY`, `AGENT_B_KEY`, `AGGREGATOR_KEY`,
   `EMAIL_API_KEY`.
2. Add `swarm-reviewer.config.json` at the consumer repo root:

   ```json
   {
     "version": 1,
     "agents": [
       { "id": "reviewer-a", "provider": "anthropic", "model": "<model-id>", "apiKeySecret": "AGENT_A_KEY" },
       { "id": "reviewer-b", "provider": "openai", "model": "<model-id>", "apiKeySecret": "AGENT_B_KEY" },
       { "id": "core", "provider": "anthropic", "model": "<model-id>", "apiKeySecret": "AGGREGATOR_KEY", "role": "aggregator" }
     ],
     "delivery": {
       "email": {
         "recipients": ["you@example.com"],
         "provider": "resend",
         "apiKeySecret": "EMAIL_API_KEY"
       }
     }
   }
   ```

3. Add `.github/workflows/pr-review.yml` per the
   [workflow-call contract](contracts/workflow-call-contract.md):

   ```yaml
   name: PR Review
   on:
     pull_request:
       types: [opened, synchronize]
   jobs:
     swarm-review:
       uses: <org>/swarm-reviewer/.github/workflows/review.yml@<branch-or-tag-under-test>
       secrets: inherit
   ```

## Validate: happy path (User Story 1)

1. Open a pull request in the consumer repo with a small, real code change.
2. Confirm: exactly one report comment appears on the PR, containing findings attributable
   to both `reviewer-a` and `reviewer-b`, synthesized by `core`.
3. Confirm: an email arrives at the configured recipient with the same report.
4. Push an additional commit to the same PR.
5. Confirm: the same comment is updated in place (same comment ID/permalink) — not a second
   comment (FR-010, SC-002).

## Validate: reconfiguration without workflow changes (User Story 2)

1. Add a third agent entry to `swarm-reviewer.config.json` only (no `.yml` changes).
2. Push a commit to the open PR.
3. Confirm: the updated report includes the new agent's findings (SC-006).

## Validate: partial failure (User Story 3)

1. Temporarily point one agent's `apiKeySecret` at a secret holding an invalid value.
2. Push a commit to the open PR.
3. Confirm: the report still updates, includes the other agents' findings, and explicitly
   lists the broken agent under "did not report in" (FR-006, SC-003).
4. Restore the valid key.

## Validate: fail-fast on bad configuration (Edge Cases, FR-011)

1. Temporarily break the config file (e.g. remove a required field, or leave zero agents with
   `role: "aggregator"`).
2. Push a commit / open a new PR.
3. Confirm: the run fails immediately with an error naming the specific problem, and no
   report comment or email is produced (SC-004).
4. Revert the config break.

## Validate: observability (FR-013)

1. Open the Actions run for any of the above.
2. Confirm the run's own output shows, per agent: ran/succeeded/failed, approximate
   cost/tokens, and duration — without needing to reproduce anything locally (SC-005).

## Clean up

Remove the scratch consumer repo's temporary secrets/config once validation passes.
