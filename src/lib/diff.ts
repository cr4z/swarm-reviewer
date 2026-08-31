import type { Octokit } from "./github-client.js";

/** Default cap on diff bytes sent to any agent (data-model.md, FR-014). Overridable via config.diff.maxBytes. */
export const DEFAULT_MAX_DIFF_BYTES = 200 * 1024;

export interface FetchDiffResult {
  diff: string;
  diffTruncated: boolean;
}

/**
 * Fetches a PR's diff via the GitHub REST API (research.md #4) rather than a local
 * `git diff`, so every agent gets identical bytes without each needing its own checkout.
 */
export async function fetchPullRequestDiff(
  octokit: Octokit,
  params: { owner: string; repo: string; pullNumber: number },
  maxBytes: number = DEFAULT_MAX_DIFF_BYTES,
): Promise<FetchDiffResult> {
  const response = await octokit.rest.pulls.get({
    owner: params.owner,
    repo: params.repo,
    pull_number: params.pullNumber,
    mediaType: { format: "diff" },
  });

  // With mediaType format "diff", octokit returns the raw diff text as `data` (typed as
  // unknown by octokit's generic types since the schema doesn't model this response shape).
  const fullDiff = String(response.data);
  return truncateDiff(fullDiff, maxBytes);
}

export function truncateDiff(diff: string, maxBytes: number): FetchDiffResult {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(diff);
  if (bytes.length <= maxBytes) {
    return { diff, diffTruncated: false };
  }

  // Truncate on a byte boundary that still decodes cleanly (avoid splitting a multi-byte
  // UTF-8 character), then decode back to a string.
  const truncatedBytes = bytes.slice(0, maxBytes);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const truncated = decoder.decode(truncatedBytes);
  return {
    diff: `${truncated}\n\n[... diff truncated at ${maxBytes} bytes ...]`,
    diffTruncated: true,
  };
}
