import { describe, it, expect, vi } from "vitest";
import { prCommentChannel } from "../../src/delivery/pr-comment.js";
import { REPORT_MARKER } from "../../src/delivery/marker.js";
import type { UnifiedReport } from "../../src/lib/types.js";

function report(overrides: Partial<UnifiedReport> = {}): UnifiedReport {
  return {
    pullRequest: { owner: "o", repo: "r", number: 1 },
    generatedAt: new Date().toISOString(),
    body: `${REPORT_MARKER}\n\nHello world`,
    agentsReported: ["a"],
    agentsMissing: [],
    diffTruncated: false,
    ...overrides,
  };
}

function fakeOctokit(existingComments: { id: number; body: string }[]) {
  const updateComment = vi.fn().mockResolvedValue({});
  const createComment = vi.fn().mockResolvedValue({});
  const listComments = vi.fn();

  return {
    updateComment,
    createComment,
    octokit: {
      paginate: {
        iterator: () =>
          (async function* () {
            yield { data: existingComments };
          })(),
      },
      rest: {
        issues: {
          listComments,
          updateComment,
          createComment,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
}

describe("prCommentChannel", () => {
  it("posts a new comment when no marker comment exists", async () => {
    const { octokit, createComment, updateComment } = fakeOctokit([{ id: 1, body: "unrelated comment" }]);

    const outcome = await prCommentChannel.deliver(report(), { octokit });

    expect(outcome.delivered).toBe(true);
    expect(createComment).toHaveBeenCalledTimes(1);
    expect(updateComment).not.toHaveBeenCalled();
  });

  it("updates the existing marker comment in place instead of creating a new one", async () => {
    const existingBody = `${REPORT_MARKER}\n\nOld report`;
    const { octokit, createComment, updateComment } = fakeOctokit([
      { id: 1, body: "unrelated comment" },
      { id: 42, body: existingBody },
    ]);

    const outcome = await prCommentChannel.deliver(report(), { octokit });

    expect(outcome.delivered).toBe(true);
    expect(updateComment).toHaveBeenCalledTimes(1);
    expect(updateComment.mock.calls[0]![0]).toMatchObject({ comment_id: 42 });
    expect(createComment).not.toHaveBeenCalled();
  });

  it("never deletes a comment", async () => {
    const { octokit } = fakeOctokit([{ id: 42, body: `${REPORT_MARKER}\n\nOld` }]);
    // deleteComment is intentionally absent from the fake — if pr-comment.ts ever called it,
    // this test would throw "octokit.rest.issues.deleteComment is not a function".
    await expect(prCommentChannel.deliver(report(), { octokit })).resolves.toMatchObject({ delivered: true });
  });

  it("returns a failed outcome (not a throw) when the GitHub API errors", async () => {
    const octokit = {
      paginate: {
        iterator: () => {
          throw new Error("API down");
        },
      },
      rest: { issues: {} },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    const outcome = await prCommentChannel.deliver(report(), { octokit });
    expect(outcome.delivered).toBe(false);
    expect(outcome.error).toContain("API down");
  });
});
