import type { UnifiedReport } from "../lib/types.js";
import type { DeliveryChannel, DeliveryOutcome } from "./types.js";
import { getEmailProvider } from "./email-providers/registry.js";

export interface EmailChannelConfig {
  recipients: string[];
  provider: string;
  apiKey: string;
}

export const emailChannel: DeliveryChannel<EmailChannelConfig> = {
  key: "email",

  async deliver(report: UnifiedReport, config: EmailChannelConfig): Promise<DeliveryOutcome> {
    try {
      const provider = getEmailProvider(config.provider);
      if (!provider) {
        throw new Error(`No email provider adapter registered for "${config.provider}".`);
      }

      const subject = `Swarm Reviewer report — ${report.pullRequest.owner}/${report.pullRequest.repo}#${report.pullRequest.number}`;

      await provider.send({
        apiKey: config.apiKey,
        recipients: config.recipients,
        subject,
        markdownBody: report.body,
      });

      return { channel: "email", delivered: true };
    } catch (err) {
      return { channel: "email", delivered: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
};
