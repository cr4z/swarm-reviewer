import type { DeliveryChannel } from "./types.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const channels = new Map<string, DeliveryChannel<any>>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerChannel(channel: DeliveryChannel<any>): void {
  if (channels.has(channel.key)) {
    throw new Error(`Delivery channel already registered for key "${channel.key}"`);
  }
  channels.set(channel.key, channel);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getChannel(key: string): DeliveryChannel<any> | undefined {
  return channels.get(key);
}

export function registeredChannelKeys(): string[] {
  return [...channels.keys()];
}

/** Test-only: clears all registered channels. */
export function _resetChannelRegistry(): void {
  channels.clear();
}
