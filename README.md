# Swarm Reviewer

A reusable GitHub Actions workflow that gives any repository automated, multi-model pull
request review: a config-defined panel of model-provider agents reviews each PR in parallel,
and one designated aggregator agent synthesizes their findings into a single report — posted
as a PR comment and emailed to you.

## Quickstart

1. In your repository, add one GitHub Actions secret per agent's API key, plus one for your
   email provider (see [`examples/swarm-reviewer.config.json`](examples/swarm-reviewer.config.json)
   for the names a starter config expects).
2. Add `swarm-reviewer.config.json` at your repo root (copy the example above/linked below).
3. Add `.github/workflows/pr-review.yml`:

   ```yaml
   name: PR Review
   on:
     pull_request:
       types: [opened, synchronize]
   jobs:
     swarm-review:
       uses: cr4z/swarm-reviewer/.github/workflows/review.yml@v1
       secrets: inherit
   ```

4. Open a pull request. A synthesized review comment appears (and updates in place on new
   commits), plus an email to your configured recipient.

Full walkthrough, including testing partial-failure and fail-fast behavior, is in
[`specs/001-multi-model-pr-review/quickstart.md`](specs/001-multi-model-pr-review/quickstart.md).
The complete `workflow_call` contract (inputs, required permissions, the `secrets: inherit`
requirement) is in
[`contracts/workflow-call-contract.md`](specs/001-multi-model-pr-review/contracts/workflow-call-contract.md).

## Configuring agents

Every agent — including which model reviews your PRs and how many run — is controlled
entirely by `swarm-reviewer.config.json` in your repository. **You never edit the workflow
file to add, remove, or change an agent.**

```json
{
  "version": 1,
  "agents": [
    { "id": "claude-reviewer", "provider": "anthropic", "model": "claude-sonnet-4-5", "apiKeySecret": "ANTHROPIC_API_KEY" },
    { "id": "chatgpt-reviewer", "provider": "openai", "model": "gpt-5.1", "apiKeySecret": "OPENAI_API_KEY" },
    { "id": "deepseek-reviewer", "provider": "deepseek", "model": "deepseek-chat", "apiKeySecret": "DEEPSEEK_API_KEY" },
    { "id": "kimi-aggregator", "provider": "kimi", "model": "kimi-k2", "apiKeySecret": "KIMI_API_KEY", "role": "aggregator" }
  ]
}
```

- **Add an agent**: append an entry to `agents`. It shows up in the next PR run — no
  `.yml` change.
- **Remove an agent**: delete its entry. The rest keep running unaffected.
- **Change the aggregator**: move `"role": "aggregator"` to a different entry — exactly one
  agent must carry it.
- Every agent's credential is a GitHub Actions secret named by `apiKeySecret`; the workflow
  resolves it dynamically at run time (see
  [`contracts/workflow-call-contract.md`](specs/001-multi-model-pr-review/contracts/workflow-call-contract.md)),
  so it never needs to be listed in the calling workflow either.

Full schema: [`specs/001-multi-model-pr-review/contracts/config.schema.json`](specs/001-multi-model-pr-review/contracts/config.schema.json).
See [`examples/swarm-reviewer.config.json`](examples/swarm-reviewer.config.json) for a
complete starting point using all four MVP providers.

### Built-in providers (v1)

`anthropic` (Claude), `openai` (ChatGPT), `deepseek`, `kimi` (Moonshot AI). Any other
provider is a small, additive follow-up — see
[`contracts/provider-adapter-contract.md`](specs/001-multi-model-pr-review/contracts/provider-adapter-contract.md)
for the interface a new provider adapter implements: one new file under `src/providers/`
plus a registry entry, with no change to the fan-out, aggregation, or delivery logic.

## Development

```sh
npm install
npm run typecheck
npm test
npm run build   # bundles each actions/*/src to its committed actions/*/dist/index.js
npm run lint    # actionlint
```

`actions/*/dist/index.js` is committed intentionally (Principle V — consuming repositories
never run `npm install`). CI fails if `dist/` is stale relative to source.

## Project status

Built spec-first with [spec-kit](https://github.com/github/spec-kit); the full spec, plan,
and task breakdown live under
[`specs/001-multi-model-pr-review/`](specs/001-multi-model-pr-review/), governed by
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).
