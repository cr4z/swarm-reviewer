import * as core from "@actions/core";
import * as github from "@actions/github";
import { createGithubClient } from "../../../src/lib/github-client.js";
import { fetchPullRequestDiff, DEFAULT_MAX_DIFF_BYTES } from "../../../src/lib/diff.js";
import { logAgentResult } from "../../../src/lib/observability.js";
import { AGENT_OUTPUT_DIR, AGENT_RESULT_FILENAME, FINDING_FILENAME, writeJsonFile } from "../../../src/lib/agent-io.js";
import { getProvider } from "../../../src/providers/registry.js";
import type { ReviewAgentConfig, SwarmReviewerConfig } from "../../../src/config/schema.js";
import type { AgentResult, AgentResultStatus } from "../../../src/lib/types.js";
import "../../../src/providers/all.js"; // registers every MVP provider adapter (side effect)

const DEFAULT_TIMEOUT_SECONDS = 180;

function redact(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}

async function run(): Promise<void> {
  const agentJson = core.getInput("agent_json", { required: true });
  const apiKey = core.getInput("api_key", { required: true });
  const configJson = core.getInput("config_json", { required: true });
  const token = core.getInput("github_token", { required: true });

  core.setSecret(apiKey); // defensive — secrets sourced via secrets[] should already be masked

  const agent = JSON.parse(agentJson) as ReviewAgentConfig;
  const config = JSON.parse(configJson) as SwarmReviewerConfig;
  const timeoutSeconds = agent.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const timeoutMs = timeoutSeconds * 1000;

  const startedAt = Date.now();
  let result: AgentResult;

  try {
    const adapter = getProvider(agent.provider);
    if (!adapter) {
      throw new Error(`No provider adapter registered for "${agent.provider}" (this should have been caught by validate-config).`);
    }

    const { owner, repo } = github.context.repo;
    const pullRequest = github.context.payload.pull_request;
    if (!pullRequest) {
      throw new Error("This action must run from a pull_request-triggered workflow_call; no pull_request payload found.");
    }

    const octokit = createGithubClient(token);
    const { diff, diffTruncated } = await fetchPullRequestDiff(
      octokit,
      { owner, repo, pullNumber: pullRequest.number },
      config.diff?.maxBytes ?? DEFAULT_MAX_DIFF_BYTES,
    );

    const { findingSet, usage } = await adapter.review({
      model: agent.model,
      apiKey,
      diff,
      diffTruncated,
      pullRequestContext: { title: pullRequest.title ?? "", description: pullRequest.body ?? "" },
      timeoutMs,
    });
    findingSet.agentId = agent.id;
    findingSet.model = agent.model;

    await writeJsonFile(AGENT_OUTPUT_DIR, FINDING_FILENAME, findingSet);

    result = {
      agentId: agent.id,
      status: "succeeded",
      durationMs: Date.now() - startedAt,
      approxCost:
        usage?.inputTokens !== undefined || usage?.outputTokens !== undefined
          ? { inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0, estimatedUsd: null }
          : null,
      error: null,
    };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const message = redact(rawMessage, apiKey);
    const status: AgentResultStatus = /timed out/i.test(message) ? "timed_out" : "failed";
    result = {
      agentId: agent.id,
      status,
      durationMs: Date.now() - startedAt,
      approxCost: null,
      error: message,
    };
  }

  await writeJsonFile(AGENT_OUTPUT_DIR, AGENT_RESULT_FILENAME, result);
  logAgentResult(result);

  if (result.status !== "succeeded") {
    core.setFailed(`Agent "${agent.id}" ${result.status}: ${result.error}`);
  }
}

run().catch((err: unknown) => {
  core.setFailed(`swarm-reviewer run-agent crashed: ${(err as Error).message}`);
});
