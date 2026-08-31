# Feature Specification: Multi-Model PR Review

**Feature Branch**: `001-multi-model-pr-review`

**Created**: 2026-08-31

**Status**: Draft

**Input**: User description: "Swarm Reviewer: a reusable GitHub Actions workflow (workflow_call) that consuming repos reference to get automated multi-model PR review. On PR events, N review agents (each independently configured to any model/provider via its own API key, driven by a config file) run in parallel against the PR diff. Once all agents complete (or fail, without blocking each other), a single designated \"core\" aggregator model synthesizes all findings into one unified report. That report is delivered via pluggable channels: posted/upserted as a PR comment (edit-in-place on re-run, no duplicates) and emailed to a configured recipient. Config/credential errors fail fast with clear errors. Every run logs per-agent status, approximate cost/duration for observability. Repo will be public but license/contribution model is undecided (deferred)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get a unified multi-model review on a PR (Priority: P1)

A maintainer has added Swarm Reviewer to their repository's PR workflow. A contributor opens
a pull request. Without anyone doing anything further, the maintainer and the contributor see
one review comment on the PR summarizing findings gathered from every configured review model,
and the maintainer also receives that same summary by email.

**Why this priority**: This is the entire value proposition — a review appears without anyone
running or maintaining review logic by hand. Nothing else in the feature matters if this
doesn't work.

**Independent Test**: Configure the workflow in a test repository with at least two review
agents and an aggregator, open a pull request, and confirm a single report comment appears on
the PR and an email is received, both reflecting findings from all configured agents.

**Acceptance Scenarios**:

1. **Given** a repository with Swarm Reviewer configured with three review agents and an
   aggregator, **When** a pull request is opened, **Then** exactly one report comment appears
   on the PR containing synthesized findings, and an email containing the same report is sent
   to the configured recipient.
2. **Given** a run already produced a report comment on a PR, **When** the PR receives a new
   commit and review runs again, **Then** the existing report comment is updated in place and
   no second report comment is created.

---

### User Story 2 - Configure which models review PRs (Priority: P2)

A maintainer wants to control exactly which models participate in review, and change that mix
over time (add a model, drop one, swap providers) without editing workflow logic.

**Why this priority**: The tool's value over a single fixed-model review bot is that the panel
of reviewers is entirely up to the maintainer. Without easy reconfiguration, it is no different
from a single-vendor review action.

**Independent Test**: Edit only the configuration file to add a new review agent pointed at a
different model/provider, open a new pull request, and confirm the new agent's findings appear
in the next report without any workflow file changes.

**Acceptance Scenarios**:

1. **Given** a working configuration with two review agents, **When** a maintainer adds a third
   agent entry (model, provider, credential reference) to the configuration file only, **Then**
   the next PR run includes that agent's findings in the unified report.
2. **Given** a working configuration, **When** a maintainer removes an agent entry, **Then**
   subsequent runs no longer invoke that agent and the run still completes successfully with
   the remaining agents.

---

### User Story 3 - Review still completes when something goes wrong (Priority: P3)

Some review agents occasionally fail — an expired key, a rate limit, a provider outage. A
maintainer still wants a useful report from whichever agents did succeed, and wants to be told
plainly when the setup itself (not a single agent) is broken.

**Why this priority**: Unattended automation that goes silent or blocks entirely on a single
failure is worse than no automation — it either produces nothing or produces a report a reader
wrongly assumes is complete. This is what makes the feature trustworthy enough to leave running.

**Independent Test**: Configure one review agent with a deliberately invalid credential and
others valid; confirm the run still produces a report noting which agent failed. Separately,
configure the run with a malformed configuration file and confirm the run fails immediately
with a specific, actionable error rather than producing any report.

**Acceptance Scenarios**:

1. **Given** four configured review agents, **When** one agent's call fails or times out,
   **Then** the unified report is still produced from the remaining three agents' findings and
   explicitly states that the fourth agent did not report in.
2. **Given** a configuration file missing a required field or referencing an unset credential,
   **When** the workflow runs, **Then** the run fails immediately with an error identifying the
   specific configuration problem, and no partial or misleading report is posted or emailed.

---

### Edge Cases

- What happens when every configured review agent fails (e.g., all credentials invalid)? The
  aggregator has no findings to synthesize — the run must fail visibly rather than post an
  empty or misleadingly generic report.
- What happens when the PR diff is very large? The system must bound what is sent to each
  agent and the final report must state that truncation occurred, rather than silently
  reviewing only part of the change.
- What happens when the aggregator itself fails after all review agents succeeded? Individual
  agent findings exist but no unified report can be produced — the run must fail visibly and
  must not deliver a partial/unsynthesized dump in place of the report.
- What happens when a PR is updated again while a previous run for that PR is still in
  progress? The system must not produce two competing report comments; the most recent
  completed run's report is what reviewers end up seeing.
- What happens when the email channel is unreachable (bad address, delivery failure) but the
  PR comment succeeds, or vice versa? The reachable channel's delivery must not be blocked by
  the other channel's failure.
- What happens when a consuming repository has not set up any review agents at all? The run
  must fail fast with a clear configuration error rather than silently doing nothing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow a consuming repository to invoke Swarm Reviewer against its own
  pull requests by referencing it, supplying its own configuration and credentials, without
  copying review logic into the consuming repository.
- **FR-002**: System MUST allow a maintainer to configure any number of review agents, each
  independently specifying a model/provider identity and a credential reference, entirely
  through a configuration file.
- **FR-003**: System MUST run all configured review agents in parallel against the same pull
  request diff for a given run.
- **FR-004**: System MUST ensure one review agent's failure, timeout, or error does not prevent
  the other configured review agents from completing.
- **FR-005**: System MUST designate exactly one configured agent, per run, as the aggregator
  responsible for synthesizing all other agents' findings into a single unified report after
  all agents have finished (successfully or not).
- **FR-006**: The unified report MUST explicitly identify any configured agent that did not
  successfully produce findings for that run.
- **FR-007**: System MUST deliver the unified report as a comment on the pull request that
  triggered the run.
- **FR-008**: System MUST deliver the unified report by email to a recipient configured by the
  maintainer.
- **FR-009**: A failure delivering the report through one channel (PR comment or email) MUST
  NOT prevent delivery through the other channel.
- **FR-010**: When a run for a pull request follows an earlier run that already posted a report
  comment on that same pull request, the system MUST update the existing report comment rather
  than create an additional one.
- **FR-011**: System MUST validate configuration and required credentials before invoking any
  review agent, and MUST fail the run with a specific, actionable error when configuration is
  invalid or a required credential is missing, rather than proceeding partially or silently.
- **FR-012**: System MUST fail the run visibly, without posting or emailing a report, when no
  review agent produces usable findings or when the aggregator itself fails.
- **FR-013**: System MUST record, for each run, whether each configured agent ran, succeeded,
  or failed, along with its approximate cost/usage and duration, in a location the run's owner
  can inspect without reproducing the run elsewhere.
- **FR-014**: System MUST bound the size of the pull request diff supplied to each review
  agent, and MUST state in the unified report when truncation occurred.
- **FR-015**: System MUST NOT include any credential value in logs, comments, emails, or any
  other output it produces.

### Key Entities

- **Review Agent**: A single configured reviewer for a run — its model/provider identity and
  the credential used to call it. One review agent per run is additionally designated as the
  Aggregator.
- **Aggregator**: The one review agent, per run, responsible for synthesizing all other agents'
  findings into the Unified Report rather than reviewing the diff independently.
- **Configuration**: The maintainer-owned definition of which review agents (and how many)
  participate in a consuming repository's runs, plus delivery settings such as the email
  recipient.
- **Run**: One execution against one pull request event — encompassing every review agent's
  attempt, the aggregation step, and the resulting delivery outcomes.
- **Finding Set**: The output produced by a single review agent for a single run, before
  synthesis.
- **Unified Report**: The aggregator's synthesized output for a run, delivered as a PR comment
  and an email.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A maintainer can enable multi-model review on a new repository using
  configuration alone, in under 15 minutes, without writing or copying any review logic.
- **SC-002**: A pull request never accumulates more than one active report comment, regardless
  of how many times it is updated.
- **SC-003**: When any subset of configured review agents fails, a report is still delivered
  reflecting the agents that succeeded, with every failed agent explicitly named in it.
- **SC-004**: Every run with invalid or missing configuration fails with an error that
  identifies the specific problem, with no report delivered through either channel.
- **SC-005**: For any run, a maintainer can determine which agents ran, how long each took, and
  their approximate cost, using only that run's own output.
- **SC-006**: A maintainer can add or remove a review model from the panel by changing
  configuration only, with no other files edited.
- **SC-007**: The email report is received within 5 minutes of the PR comment being posted for
  the same run.

## Assumptions

- Consuming repositories are hosted on GitHub and use GitHub Actions as their CI platform.
- Each review agent's credential is provisioned as a platform secret by the consuming
  repository, outside of Swarm Reviewer itself; Swarm Reviewer only references it.
- Runs trigger on pull requests being opened and on new commits pushed to an open pull request;
  draft pull requests and closed/merged pull requests are out of scope for this feature.
- The email recipient is a fixed address (or address list) set once in configuration per
  repository, not derived per PR author.
- Exactly one aggregator is designated per run; configuring zero or more than one aggregator is
  a configuration error handled under FR-011.
- The exact diff size limit used for truncation (FR-014) is a tunable default, not a
  user-facing decision this specification fixes.
- **MVP provider scope**: the architecture is model-agnostic (Principle I) and imposes no
  fixed limit on providers, but the MVP itself ships working adapters for exactly four
  providers — Anthropic (Claude), OpenAI (ChatGPT), DeepSeek, and Moonshot AI (Kimi) — chosen
  as the providers actually needed at launch. Any other provider is explicitly out of scope
  for the MVP and is follow-up work, added the same way (one adapter file + a registry entry)
  without touching fan-out, aggregation, or delivery logic.
- This repository will be public, but its license and whether it accepts external
  contributions are undecided and out of scope for this feature (tracked separately per the
  project constitution).
