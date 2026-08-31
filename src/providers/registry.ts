import type { ProviderAdapter } from "./types.js";

const adapters = new Map<string, ProviderAdapter>();

export function registerProvider(adapter: ProviderAdapter): void {
  if (adapters.has(adapter.key)) {
    throw new Error(`Provider adapter already registered for key "${adapter.key}"`);
  }
  adapters.set(adapter.key, adapter);
}

export function getProvider(key: string): ProviderAdapter | undefined {
  return adapters.get(key);
}

export function knownProviderKeys(): string[] {
  return [...adapters.keys()];
}

/** Test-only: clears all registered adapters. */
export function _resetProviderRegistry(): void {
  adapters.clear();
}
