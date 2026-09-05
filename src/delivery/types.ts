// Contract: contracts/delivery-channel-contract.md
// Realizes Principle VII (Open/Closed on delivery channels): a new channel is one module
// implementing DeliveryChannel, registered in registry.ts — never a change to the
// aggregator or to other channels.

import type { UnifiedReport } from "../lib/types.js";

export interface DeliveryOutcome {
  channel: string;
  delivered: boolean;
  /** Present when delivered = false. Must never contain a credential value. */
  error?: string;
}

export interface DeliveryChannel<TConfig = unknown> {
  /** Channel key, matched against Configuration.delivery.<key>.enabled. */
  readonly key: string;

  /**
   * Deliver a UnifiedReport. Must catch its own errors and return them in the result rather
   * than throwing — one channel's failure must never block another (FR-009).
   */
  deliver(report: UnifiedReport, config: TConfig): Promise<DeliveryOutcome>;
}
