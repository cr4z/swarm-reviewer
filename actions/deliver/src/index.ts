import * as core from "@actions/core";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createGithubClient } from "../../../src/lib/github-client.js";
import { getChannel } from "../../../src/delivery/registry.js";
import type { DeliveryOutcome } from "../../../src/delivery/types.js";
import type { PrCommentChannelConfig } from "../../../src/delivery/pr-comment.js";
import type { EmailChannelConfig } from "../../../src/delivery/email.js";
import type { SwarmReviewerConfig } from "../../../src/config/schema.js";
import type { UnifiedReport } from "../../../src/lib/types.js";
import "../../../src/delivery/all.js"; // registers prComment + email channels (side effect)

async function run(): Promise<void> {
  const config = JSON.parse(core.getInput("config_json", { required: true })) as SwarmReviewerConfig;
  const emailApiKey = core.getInput("email_api_key");
  const token = core.getInput("github_token", { required: true });

  if (emailApiKey) core.setSecret(emailApiKey);

  const reportPath = join("swarm-reviewer-in", "report", "unified-report.json");
  const report = JSON.parse(await readFile(reportPath, "utf-8")) as UnifiedReport;

  const octokit = createGithubClient(token);
  const outcomes: DeliveryOutcome[] = [];

  const prCommentEnabled = config.delivery?.prComment?.enabled !== false;
  if (prCommentEnabled) {
    const channel = getChannel("prComment");
    if (!channel) {
      outcomes.push({ channel: "prComment", delivered: false, error: "prComment channel not registered." });
    } else {
      const config_: PrCommentChannelConfig = { octokit };
      outcomes.push(await channel.deliver(report, config_));
    }
  }

  const emailConfig = config.delivery?.email;
  const emailEnabled = emailConfig?.enabled !== false && !!emailConfig;
  if (emailEnabled && emailConfig) {
    const channel = getChannel("email");
    if (!channel) {
      outcomes.push({ channel: "email", delivered: false, error: "email channel not registered." });
    } else if (!emailApiKey) {
      outcomes.push({ channel: "email", delivered: false, error: "Email delivery is enabled but no API key was resolved." });
    } else {
      const config_: EmailChannelConfig = {
        recipients: emailConfig.recipients ?? [],
        provider: emailConfig.provider ?? "",
        apiKey: emailApiKey,
      };
      outcomes.push(await channel.deliver(report, config_));
    }
  }

  for (const outcome of outcomes) {
    if (outcome.delivered) {
      core.info(`Delivered via "${outcome.channel}".`);
    } else {
      core.warning(`Delivery via "${outcome.channel}" failed: ${outcome.error}`);
    }
  }

  await core.summary
    .addHeading("Swarm Reviewer delivery", 2)
    .addTable([
      [
        { data: "Channel", header: true },
        { data: "Delivered", header: true },
        { data: "Error", header: true },
      ],
      ...outcomes.map((o) => [o.channel, o.delivered ? "yes" : "no", o.error ?? "—"]),
    ])
    .write();

  // FR-009: one channel's failure must not block another — only fail the job if every
  // enabled channel failed, i.e. nothing was delivered at all.
  const anyEnabled = outcomes.length > 0;
  const anyDelivered = outcomes.some((o) => o.delivered);
  if (anyEnabled && !anyDelivered) {
    core.setFailed("All enabled delivery channels failed — the report was not delivered anywhere.");
  }
}

run().catch((err: unknown) => {
  core.setFailed(`swarm-reviewer deliver crashed: ${(err as Error).message}`);
});
