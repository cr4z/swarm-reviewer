import * as core from "@actions/core";
import * as github from "@actions/github";
import { createGithubClient } from "../../../src/lib/github-client.js";
import { fetchPullRequestDiff, DEFAULT_MAX_DIFF_BYTES } from "../../../src/lib/diff.js";
import { logAgentResult } from "../../../src/lib/observability.js";
import { AGENT_OUTPUT_DIR, AGENT_RESULT_FILENAME, FINDING_FILENAME, writeJsonFile } from "../../../src/lib/agent-io.js";
import { getProvider } from "../../../src/providers/registry.js";
import { exchangeGithubOidcForAnthropicToken, WIF_AUDIENCE } from "../../../src/lib/federation.js";
import type { ReviewAgentConfig, SwarmReviewerConfig } from "../../../src/config/schema.js";
import type { AuthScheme } from "../../../src/providers/types.js";
import type { AgentResult, AgentResultStatus } from "../../../src/lib/types.js";
import "../../../src/providers/all.js"; // registers every MVP provider adapter (side effect)

const DEFAULT_TIMEOUT_SECONDS = 180;

function redact(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join("[redacted]");
}

async function run(): Promise<void> {
  const agentJson = core.getInput("agent_json", { required: true });
  const apiKeyInput = core.getInput("api_key"); // required only for an apiKeySecret agent
  const configJson = core.getInput("config_json", { required: true });
  const token = core.getInput("github_token", { required: true });

  if (apiKeyInput) core.setSecret(apiKeyInput); // defensive — secrets sourced via secrets[] should already be masked

  const agent = JSON.parse(agentJson) as ReviewAgentConfig;
  const config = JSON.parse(configJson) as SwarmReviewerConfig;
  const timeoutSeconds = agent.timeoutSeconds ?? DEFAULT_TIMEOUT_SECONDS;
  const timeoutMs = timeoutSeconds * 1000;

  const startedAt = Date.now();
  let result: AgentResult;
  // Whichever credential this run actually used, resolved inside the try block below —
  // kept in outer scope so the catch block can redact it from any thrown error message.
  let credentialValue = "";

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

    let authScheme: AuthScheme | undefined;
    if (agent.auth) {
      // Federation auth (spec 002): exchange GitHub's own OIDC identity for a short-lived
      // Anthropic access token. Requires the job to have `permissions: id-token: write`.
      const githubOidcToken = await core.getIDToken(WIF_AUDIENCE);
      const { accessToken } = await exchangeGithubOidcForAnthropicToken({
        githubOidcToken,
        federationRuleId: agent.auth.federationRuleId,
        organizationId: agent.auth.organizationId,
        serviceAccountId: agent.auth.serviceAccountId,
        workspaceId: agent.auth.workspaceId,
      });
      core.setSecret(accessToken);
      credentialValue = accessToken;
      authScheme = "bearer";
    } else {
      credentialValue = apiKeyInput;
    }

    const octokit = createGithubClient(token);
    const { diff, diffTruncated } = await fetchPullRequestDiff(
      octokit,
      { owner, repo, pullNumber: pullRequest.number },
      config.diff?.maxBytes ?? DEFAULT_MAX_DIFF_BYTES,
    );

    const { findingSet, usage } = await adapter.review({
      model: agent.model,
      apiKey: credentialValue,
      authScheme,
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
    const message = redact(rawMessage, credentialValue);
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
