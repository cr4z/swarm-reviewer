<!--
Sync Impact Report
- Version change: 1.0.0 → 1.1.0
- Modified principles:
  - I. Model-Agnostic by Design → expanded with fail-fast config/credential validation
  - IV. Dual-Channel Delivery → expanded with idempotent (edit-in-place) PR comment upsert
- Added sections:
  - Core Principles: VII. Clean Code & Extensible Architecture (SOLID), VIII. Observability
  - Licensing & Distribution Posture
- Removed sections: none
- Deferred TODOs: TODO(LICENSE) — public repo, license/contribution policy not yet decided
-->

# Swarm Reviewer Constitution

## Core Principles

### I. Model-Agnostic by Design
Swarm Reviewer MUST NOT hardcode behavior to any single model vendor or API shape. Every
review agent's model, provider, and credentials MUST be declared in a single, versioned
config file (not scattered across workflow YAML), so consuming repos can add, remove, or
swap any number of agents — across any providers — without editing workflow logic. Adding
a new provider MUST require only a new provider adapter, never a change to the fan-out or
aggregation logic. Invalid or missing config — a malformed entry, an unset/rejected API
key — MUST fail the run fast with a clear, specific error identifying the offending agent;
it MUST NOT be silently skipped or silently degrade to a partial run. Rationale: the value
of the tool is that it never locks a team into one vendor's models or pricing, and a
misconfigured agent that fails silently produces a review the user wrongly trusts as
complete.

### II. Fan-Out / Fan-In Architecture
Review agents MUST run as independent, parallel jobs (a matrix keyed off the config file)
against the same PR diff. Agents MUST run with `fail-fast: false`: one agent's failure,
timeout, or API error MUST NOT block or cancel the others. Each agent MUST persist its
findings as an artifact independent of the others, so the review is only as slow as the
slowest agent, not the sum of all agents. Rationale: parallelism is the entire point of
running N models instead of one; a single failure taking down the review defeats it.

### III. Single Aggregator Synthesis
After all review agents complete (successfully or not), exactly one designated "core"
model MUST run as an aggregation step that consumes every available agent artifact and
produces one unified report. The aggregator MUST run even if some agents failed, and MUST
state in the report which agents did not report in. The aggregator MUST NOT itself
re-review the diff from scratch — its job is synthesis of existing findings, not another
independent opinion. Rationale: N raw reports is noise; one synthesized verdict is the
deliverable.

### IV. Dual-Channel Delivery
The unified report MUST be delivered two ways on every run where synthesis succeeds: as a
comment on the originating PR, and as an email to the configured recipient. Delivery of
one channel failing (e.g. email misconfiguration) MUST NOT block delivery of the other.
A re-run against the same PR head MUST upsert the existing report comment in place (found
via a hidden marker) rather than posting a new comment; delete-then-recreate is
disallowed. Rationale: the PR comment serves reviewers in-context; the email serves the
user who may not be watching the PR; editing in place avoids duplicate-comment spam and
keeps a stable permalink for reviewers to reference.

### V. Reusability via workflow_call
Swarm Reviewer MUST be consumable by any repository as a reusable workflow
(`on: workflow_call`) referenced with `uses: <org>/swarm-reviewer/.github/workflows/<file>@<ref>`.
Consuming repos MUST be able to integrate by supplying secrets and a config file only —
never by copying job or step definitions out of this repository. Breaking changes to the
called workflow's required inputs/secrets MUST be released behind a new major tag so
existing consumers pinned to an older tag are unaffected. Rationale: this repo exists to
be referenced, not forked; copy-paste defeats its purpose and silent breaking changes
break every consumer at once.

### VI. Secret Safety & Cost Awareness
Per-agent API keys MUST be passed as GitHub Actions secrets and MUST NOT appear in logs,
job output, artifacts, or the final report under any circumstance. Every run MUST bound
its own cost and latency: diff size passed to any model MUST be capped/truncated with the
truncation made visible in the report, and each agent call MUST enforce a timeout.
Rationale: an unbounded workflow triggered on every PR is a live liability, both for
credential exposure and for runaway API spend.

### VII. Clean Code & Extensible Architecture (SOLID)
The codebase MUST follow SOLID and Clean Code practices, with the Open/Closed Principle
binding on delivery channels specifically: a PR comment, an email, and any future channel
(Slack, Teams, etc.) MUST each be an independent, swappable implementation behind a common
delivery interface. Adding a new channel MUST require only a new implementation of that
interface, never a modification to the aggregation step or to other channels. Rationale:
delivery is the part of this system most likely to grow, and hardwiring channels into the
aggregator would force a rewrite each time one is added.

### VIII. Observability
Every run MUST log, per agent: whether it ran, succeeded, or failed; its approximate token
usage/cost; and its duration — plus the aggregation step's own duration. This MUST be
visible from the GitHub Actions run log alone, without reproducing the failure locally.
Rationale: this workflow runs unattended on other people's PRs; when it misbehaves, the
Actions log is the only debugging surface available.

## Licensing & Distribution Posture

This repository will be public, but public visibility MUST NOT be read as an open-source
or open-contribution commitment. Whether Swarm Reviewer carries an OSS license and accepts
external contributions is a separate decision, not yet made.

TODO(LICENSE): decide and add a LICENSE file (or an explicit "all rights reserved, no
external PRs" notice) before or at public release; until decided, treat the repository as
source-visible only, not licensed for reuse.

## Technical Constraints

- Implemented as GitHub Actions (composite actions and/or a reusable workflow YAML) plus
  small scripts invoked from steps; no orchestration framework or long-running service.
- Agent configuration lives in one human-editable file (YAML or JSON) checked into the
  consuming repo or passed as workflow input — never generated at runtime from
  hardcoded lists.
- Each agent step calls its provider's API directly (native SDK or plain HTTP); no
  dependency on a single third-party gateway/proxy service as a hard requirement.
- Email delivery uses a pluggable step (SMTP action or transactional email API) configured
  via secrets, kept swappable without touching the aggregation logic.

## Development Workflow & Quality Gates

- Development follows the spec-kit flow: constitution → specify → plan → tasks →
  implement, before adding new capabilities.
- The workflow YAML MUST be linted (e.g. `actionlint`) before merge.
- Changes to the reusable workflow MUST be exercised against a real or sample PR (a
  scratch consumer repo or workflow_dispatch test harness) before being tagged for
  consumption, since GitHub Actions failures are otherwise only caught by consumers.
- Releases consumers depend on MUST be tagged using semantic versioning
  (`vMAJOR.MINOR.PATCH`, plus a rolling `vMAJOR` tag), per Principle V.

## Governance

This constitution supersedes ad hoc practice for this repository. Amendments require a
PR that updates this file, states the reasoning, and — for any change to Core Principles —
a version bump per the policy below; a maintainer must approve before merge.

Versioning policy (semantic versioning applied to this document):
- MAJOR: a principle is removed or redefined in a backward-incompatible way.
- MINOR: a new principle or section is added, or existing guidance materially expands.
- PATCH: wording, typo, or clarification changes with no rule change.

All future feature specs and plans produced via spec-kit for this repository MUST be
checked against these principles; a plan that conflicts with a principle must either be
revised or must amend this constitution first, with the conflict and resolution recorded
in that amendment's Sync Impact Report.

**Version**: 1.1.0 | **Ratified**: 2026-08-31 | **Last Amended**: 2026-08-31
