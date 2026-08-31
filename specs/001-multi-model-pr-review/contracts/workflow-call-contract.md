# Contract: Reusable Workflow (`workflow_call`)

This is the external contract consuming repositories integrate against (Principle V —
integrate via `uses:` + inputs/secrets only, never copied job/step definitions).

## Consumer usage

```yaml
# .github/workflows/pr-review.yml in a consuming repository
name: PR Review
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  swarm-review:
    uses: <org>/swarm-reviewer/.github/workflows/review.yml@v1
    secrets: inherit   # required — see research.md #1
    with:
      config_path: swarm-reviewer.config.json   # optional, this is the default
```

## Inputs (`on.workflow_call.inputs`)

| Input | Type | Required | Default | Notes |
|---|---|---|---|---|
| `config_path` | string | no | `swarm-reviewer.config.json` | Path, relative to the consumer repo root, to the Configuration file (data-model.md). |

## Secrets (`on.workflow_call.secrets`)

None declared explicitly. Consumers MUST pass `secrets: inherit`, because the set of
credentials needed is determined by the config file's `agents[].apiKeySecret` /
`delivery.email.apiKeySecret` entries, which cannot be known when this workflow file is
authored (research.md #1). This workflow only ever reads secrets by the names the config
file names — it does not have or need blanket access beyond what it looks up.

## Required consumer permissions

The calling job (or the consumer's default `GITHUB_TOKEN` permissions) MUST grant:
- `pull-requests: write` — to read the PR diff and upsert the report comment.
- `contents: read` — no checkout is required (research.md #4), but this is the workflow's
  floor permission.

## Triggering events

This workflow is designed to be called from `pull_request` events of type `opened` and
`synchronize` (spec Assumptions). Other trigger types are not a contract violation to call
with, but idempotent-upsert behavior (FR-010) is only meaningful across `synchronize` re-runs
of the same PR.

## Outputs

None. All observable effects are the PR comment and the email (FR-007, FR-008); the run's own
job summary/logs carry the observability data (FR-013, data-model.md `AgentResult`).

## Breaking-change policy

Any change to this contract (input names/types, the secrets-inherit requirement, minimum
permissions) is a MAJOR version bump per the constitution's versioning policy and Principle V,
released behind a new major tag so pinned consumers are unaffected.
