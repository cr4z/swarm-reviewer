export interface SendEmailParams {
  apiKey: string;
  recipients: string[];
  subject: string;
  markdownBody: string;
}

export interface EmailProviderAdapter {
  /** Matches Configuration.delivery.email.provider (e.g. "resend"). */
  readonly key: string;
  send(params: SendEmailParams): Promise<void>;
}
