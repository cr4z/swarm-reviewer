import * as core from "@actions/core";
import * as github from "@actions/github";
import { getProvider } from "../../../src/providers/registry.js";
import { REPORT_MARKER } from "../../../src/delivery/marker.js";
import { createGithubClient } from "../../../src/lib/github-client.js";
import { fetchPullRequestDiff, DEFAULT_MAX_DIFF_BYTES } from "../../../src/lib/diff.js";
import {
  readAllJsonFiles,
  writeJsonFile,
  REPORT_FILENAME,
} from "../../../src/lib/agent-io.js";
import { writeRunSummary } from "../../../src/lib/observability.js";
import { exchangeGithubOidcForAnthropicToken, WIF_AUDIENCE } from "../../../src/lib/federation.js";
import type { ReviewAgentConfig, SwarmReviewerConfig } from "../../../src/config/schema.js";
import type { AuthScheme } from "../../../src/providers/types.js";
import type { AgentResult, FindingSet } from "../../../src/lib/types.js";
import "../../../src/providers/all.js"; // registers every MVP provider adapter (side effect)

const AGGREGATE_OUTPUT_DIR = "swarm-reviewer-out";
const DEFAULT_TIMEOUT_SECONDS = 180;

function redact(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}

async function run(): Promise<void> {
  const config = JSON.parse(core.getInput("config_json", { required: true })) as SwarmReviewerConfig;
  const aggregator = JSON.parse(core.getInput("aggregator_json", { required: true })) as ReviewAgentConfig;
  const reviewerAgents = JSON.parse(
    core.getInput("reviewer_agents_json", { required: true }),
  ) as ReviewAgentConfig[];
  const aggregatorApiKeyInput = core.getInput("aggregator_api_key"); // required only when aggregator.apiKeySecret is set
  const token = core.getInput("github_token", { required: true });

  if (aggregatorApiKeyInput) core.setSecret(aggregatorApiKeyInput);

  const findingSets = await readAllJsonFiles<FindingSet>("swarm-reviewer-in/findings", "finding.json");
  const reviewerResults = await readAllJsonFiles<AgentResult>(
    "swarm-reviewer-in/agent-results",
    "agent-result.json",
  );

  // FR-006: every configured reviewer agent that doesn't have a successful FindingSet is
  // "missing" — reason comes from its own AgentResult if we have one, else a generic note.
  const succeededIds = new Set(findingSets.map((fs) => fs.agentId));
  const missingAgents = reviewerAgents
    .filter((agent) => !succeededIds.has(agent.id))
    .map((agent) => {
      const matchingResult = reviewerResults.find((r) => r.agentId === agent.id);
      return { agentId: agent.id, reason: matchingResult?.error ?? "No result was reported for this agent." };
    });

  // FR-012: if literally nothing succeeded, there is nothing to synthesize — fail visibly,
  // never post/email a partial or empty report.
  if (findingSets.length === 0) {
    core.setOutput("report_produced", "false");
    await writeRunSummary(reviewerResults);
    core.setFailed(
      "No review agent produced findings — aggregation cannot proceed. " +
        `Missing/failed agents: ${missingAgents.map((m) => `${m.agentId} (${m.reason})`).join("; ")}`,
    );
    return;
  }

  const { owner, repo } = github.context.repo;
  const pullRequest = github.context.payload.pull_request;
  if (!pullRequest) {
    core.setFailed("This action must run from a pull_request-triggered workflow_call; no pull_request payload found.");
    return;
  }

  const adapter = getProvider(aggregator.provider);
  if (!adapter) {
    core.setFailed(`No provider adapter registered for aggregator provider "${aggregator.provider}".`);
    return;
  }

  // Every reviewer agent fetched the same diff with the same maxBytes, so re-fetching once
  // here (metadata only — the text itself isn't sent to the aggregator model, which
  // synthesizes existing findings rather than re-reviewing, Principle III) tells us whether
  // FR-014 truncation applied to this run, without needing to plumb it through FindingSet.
  const octokit = createGithubClient(token);
  const { diffTruncated } = await fetchPullRequestDiff(
    octokit,
    { owner, repo, pullNumber: pullRequest.number },
    config.diff?.maxBytes ?? DEFAULT_MAX_DIFF_BYTES,
  );

  const startedAt = Date.now();
  let aggregatorResult: AgentResult;
  // Whichever credential this run actually used, resolved inside the try block below —
  // kept in outer scope so the catch block can redact it from any thrown error message.
  let credentialValue = "";

  try {
    let authScheme: AuthScheme | undefined;
    if (aggregator.auth) {
      // Federation auth (spec 002) — same exchange as run-agent's, for the aggregator agent.
      const githubOidcToken = await core.getIDToken(WIF_AUDIENCE);
      const { accessToken } = await exchangeGithubOidcForAnthropicToken({
        githubOidcToken,
        federationRuleId: aggregator.auth.federationRuleId,
        organizationId: aggregator.auth.organizationId,
        serviceAccountId: aggregator.auth.serviceAccountId,
        workspaceId: aggregator.auth.workspaceId,
      });
      core.setSecret(accessToken);
      credentialValue = accessToken;
      authScheme = "bearer";
    } else {
      credentialValue = aggregatorApiKeyInput;
    }

    const { report, usage } = await adapter.aggregate({
      model: aggregator.model,
      apiKey: credentialValue,
      authScheme,
      findingSets,
      missingAgents,
      diffTruncated,
      pullRequestContext: { title: pullRequest.title ?? "", description: pullRequest.body ?? "" },
      timeoutMs: (aggregator.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS) * 1000,
    });

    report.pullRequest = { owner, repo, number: pullRequest.number };
    report.body = `${REPORT_MARKER}\n\n${report.body}`;

    await writeJsonFile(AGGREGATE_OUTPUT_DIR, REPORT_FILENAME, report);
    core.setOutput("report_produced", "true");

    aggregatorResult = {
      agentId: aggregator.id,
      status: "succeeded",
      durationMs: Date.now() - startedAt,
      approxCost:
        usage?.inputTokens !== undefined || usage?.outputTokens !== undefined
          ? { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, estimatedUsd: null }
          : null,
      error: null,
    };
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err), credentialValue);
    aggregatorResult = {
      agentId: aggregator.id,
      status: /timed out/i.test(message) ? "timed_out" : "failed",
      durationMs: Date.now() - startedAt,
      approxCost: null,
      error: message,
    };
    core.setOutput("report_produced", "false");
    await writeRunSummary([...reviewerResults, aggregatorResult]);
    core.setFailed(`Aggregation failed: ${message}`);
    return;
  }

  await writeRunSummary([...reviewerResults, aggregatorResult], { diffTruncated });
}

run().catch((err: unknown) => {
  core.setFailed(`swarm-reviewer aggregate crashed: ${(err as Error).message}`);
});
