import { getOctokit } from "@actions/github";

export type Octokit = ReturnType<typeof getOctokit>;

/** Thin wrapper so callers depend on this module, not directly on @actions/github. */
export function createGithubClient(token: string): Octokit {
  return getOctokit(token);
}
