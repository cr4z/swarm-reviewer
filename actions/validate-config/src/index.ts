import * as core from "@actions/core";
import * as github from "@actions/github";
import { createGithubClient } from "../../../src/lib/github-client.js";
import { readRepoFile } from "../../../src/lib/repo-file.js";
import { validateConfig, ConfigValidationError } from "../../../src/config/validate.js";
import { knownProviderKeys } from "../../../src/providers/registry.js";
import "../../../src/providers/all.js"; // registers every MVP provider adapter (side effect)

async function run(): Promise<void> {
  const configPath = core.getInput("config_path") || "swarm-reviewer.config.json";
  const token = core.getInput("github_token", { required: true });

  const { owner, repo } = github.context.repo;
  const ref = github.context.payload.pull_request?.head?.sha as string | undefined;

  const octokit = createGithubClient(token);

  let raw: string;
  try {
    raw = await readRepoFile(octokit, { owner, repo, path: configPath, ref });
  } catch (err) {
    core.setFailed(
      `Could not read config file "${configPath}" in ${owner}/${repo}: ${(err as Error).message}`,
    );
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    core.setFailed(`Config file "${configPath}" is not valid JSON: ${(err as Error).message}`);
    return;
  }

  try {
    const config = validateConfig(parsed, { knownProviders: knownProviderKeys() });
    core.setOutput("config_json", JSON.stringify(config));
    core.info(`Configuration valid: ${config.agents.length} agent(s) configured.`);
  } catch (err) {
    if (err instanceof ConfigValidationError) {
      core.setFailed(err.message);
    } else {
      core.setFailed(`Unexpected error validating configuration: ${(err as Error).message}`);
    }
  }
}

run().catch((err: unknown) => {
  core.setFailed(`swarm-reviewer validate-config crashed: ${(err as Error).message}`);
});
