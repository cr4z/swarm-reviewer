import type { EmailProviderAdapter, SendEmailParams } from "./types.js";

const RESEND_API_URL = "https://api.resend.com/emails";
// Resend requires a verified sender; consumers without a custom domain can use this
// shared onboarding address for a quick start (documented in README.md / quickstart.md).
const DEFAULT_FROM = "Swarm Reviewer <onboarding@resend.dev>";

export const resendAdapter: EmailProviderAdapter = {
  key: "resend",

  async send(params: SendEmailParams): Promise<void> {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        from: DEFAULT_FROM,
        to: params.recipients,
        subject: params.subject,
        text: params.markdownBody,
      }),
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`Resend API returned HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
    }
  },
};
