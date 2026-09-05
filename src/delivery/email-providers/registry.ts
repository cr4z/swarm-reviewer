import type { EmailProviderAdapter } from "./types.js";

const providers = new Map<string, EmailProviderAdapter>();

export function registerEmailProvider(provider: EmailProviderAdapter): void {
  if (providers.has(provider.key)) {
    throw new Error(`Email provider already registered for key "${provider.key}"`);
  }
  providers.set(provider.key, provider);
}

export function getEmailProvider(key: string): EmailProviderAdapter | undefined {
  return providers.get(key);
}
