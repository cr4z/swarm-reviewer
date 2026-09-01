import type { Octokit } from "../lib/github-client.js";
import type { UnifiedReport } from "../lib/types.js";
import type { DeliveryChannel, DeliveryOutcome } from "./types.js";
import { REPORT_MARKER } from "./marker.js";

export interface PrCommentChannelConfig {
  octokit: Octokit;
}

/**
 * Upserts the report comment by marker (research.md #3, FR-010): finds an existing issue
 * comment on the PR whose body starts with REPORT_MARKER and PATCHes it; otherwise POSTs a
 * new one. Never deletes and recreates (constitution Principle IV — explicit prohibition).
 */
export const prCommentChannel: DeliveryChannel<PrCommentChannelConfig> = {
  key: "prComment",

  async deliver(report: UnifiedReport, config: PrCommentChannelConfig): Promise<DeliveryOutcome> {
    try {
      const { owner, repo, number } = report.pullRequest;
      const octokit = config.octokit;

      const existing = await findExistingReportComment(octokit, owner, repo, number);

      if (existing) {
        await octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: existing.id,
          body: report.body,
        });
      } else {
        await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: number,
          body: report.body,
        });
      }

      return { channel: "prComment", delivered: true };
    } catch (err) {
      return { channel: "prComment", delivered: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};

async function findExistingReportComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
): Promise<{ id: number } | undefined> {
  const iterator = octokit.paginate.iterator(octokit.rest.issues.listComments, {
    owner,
    repo,
    issue_number: issueNumber,
    per_page: 100,
  });

  for await (const { data: comments } of iterator) {
    const match = comments.find((c) => c.body?.startsWith(REPORT_MARKER));
    if (match) {
      return { id: match.id };
    }
  }

  return undefined;
}
