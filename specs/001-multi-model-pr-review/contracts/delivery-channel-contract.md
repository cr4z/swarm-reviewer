# Contract: Delivery Channel

Realizes Principle VII (Open/Closed on delivery channels): a new channel is one module
implementing this interface, registered alongside the existing ones — never a change to the
aggregator or to other channels.

## Interface (TypeScript)

```ts
interface DeliveryChannel {
  /** Channel key, matched against Configuration.delivery.<key>.enabled. */
  readonly key: string;

  /**
   * Deliver a UnifiedReport. Must catch its own errors and return them in the result rather
   * than throwing — one channel's failure must never block another (FR-009).
   */
  deliver(report: UnifiedReport, config: ChannelConfig): Promise<DeliveryOutcome>;
}

interface DeliveryOutcome {
  channel: string;
  delivered: boolean;
  error?: string;   // present when delivered = false; never contains credential values
}
```

## `prComment` channel contract

- Input `ChannelConfig` includes `{ owner, repo, pullNumber, githubToken }`.
- Behavior (research.md #3): list existing issue comments on the PR, find one whose body
  starts with the marker `<!-- swarm-reviewer:report:v1 -->`, `PATCH` it if found, otherwise
  `POST` a new comment. `UnifiedReport.body` already carries the marker as its first line.
- Never deletes and recreates a comment (constitution, Principle IV — explicit prohibition).

## `email` channel contract

- Input `ChannelConfig` includes `{ recipients, provider, apiKey }` (`provider` selects the
  email adapter the same way `ReviewAgent.provider` selects a model adapter — research.md #5).
- Behavior: render `UnifiedReport` to an email body (Markdown-to-plain/HTML as the chosen
  provider's API expects) and POST via that provider's transactional-email HTTP API.
- Email adapters (`resend`, `sendgrid`) live in `delivery/email-providers/`, registered the
  same way model provider adapters are — adding an email provider is additive, not a change
  to the `email` channel itself.

## Registration and orchestration

Channels are registered in `delivery/registry.ts` keyed by `DeliveryChannel.key`. The
`deliver` action invokes every channel whose `Configuration.delivery.<key>.enabled` is true
(default `true` for both channels), collects all `DeliveryOutcome`s, and the run's job summary
records which channels succeeded/failed (Principle VIII) — a channel failure does not fail the
overall run unless every enabled channel failed.
