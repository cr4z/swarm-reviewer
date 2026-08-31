import type { Octokit } from "./github-client.js";

/**
 * Reads a text file from the calling repository via the Contents API, at the PR's head SHA
 * if this run is a pull_request event, else the repo's default branch. Used so no step in
 * this workflow needs actions/checkout (research.md #4's "no redundant checkout" reasoning
 * applies equally to reading the one config file).
 */
export async function readRepoFile(
  octokit: Octokit,
  params: { owner: string; repo: string; path: string; ref?: string },
): Promise<string> {
  const response = await octokit.rest.repos.getContent({
    owner: params.owner,
    repo: params.repo,
    path: params.path,
    ref: params.ref,
  });

  const data = response.data;
  if (Array.isArray(data) || data.type !== "file" || typeof data.content !== "string") {
    throw new Error(`"${params.path}" is not a readable file in ${params.owner}/${params.repo}.`);
  }

  return Buffer.from(data.content, data.encoding as BufferEncoding).toString("utf-8");
}
