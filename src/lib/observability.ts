import * as core from "@actions/core";
import type { AgentResult } from "./types.js";

/**
 * Logs one agent's outcome to the current job's own log (Principle VIII). Called from
 * within a single run-agent matrix leg, which only ever knows about its own agent.
 * Never logs `error` verbatim without first checking it for credential leakage upstream —
 * callers are responsible for building AgentResult.error without embedding secret values.
 */
export function logAgentResult(result: AgentResult): void {
  const base = `agent=${result.agentId} status=${result.status} durationMs=${result.durationMs}`;
  const cost = result.approxCost
    ? ` inputTokens=${result.approxCost.inputTokens} outputTokens=${result.approxCost.outputTokens}`
    : " cost=unknown";

  if (result.status === "succeeded") {
    core.info(`${base}${cost}`);
  } else {
    core.warning(`${base}${cost} error=${result.error ?? "(none)"}`);
  }
}

/**
 * Writes a consolidated GitHub Actions job summary table across every agent's result
 * (called from the aggregate job, the one place that sees every AgentResult for a run).
 */
export async function writeRunSummary(
  results: AgentResult[],
  extra?: { diffTruncated?: boolean; deliveryOutcomes?: { channel: string; delivered: boolean; error?: string }[] },
): Promise<void> {
  const summary = core.summary.addHeading("Swarm Reviewer run summary", 2).addTable([
    [
      { data: "Agent", header: true },
      { data: "Status", header: true },
      { data: "Duration (ms)", header: true },
      { data: "Input tokens", header: true },
      { data: "Output tokens", header: true },
      { data: "Error", header: true },
    ],
    ...results.map((r) => [
      r.agentId,
      r.status,
      String(r.durationMs),
      r.approxCost ? String(r.approxCost.inputTokens) : "—",
      r.approxCost ? String(r.approxCost.outputTokens) : "—",
      r.error ?? "—",
    ]),
  ]);

  if (extra?.diffTruncated) {
    summary.addRaw("\n⚠️ The PR diff was truncated before being sent to any agent.\n", true);
  }

  if (extra?.deliveryOutcomes) {
    summary.addHeading("Delivery", 3).addTable([
      [
        { data: "Channel", header: true },
        { data: "Delivered", header: true },
        { data: "Error", header: true },
      ],
      ...extra.deliveryOutcomes.map((o) => [o.channel, o.delivered ? "yes" : "no", o.error ?? "—"]),
    ]);
  }

  await summary.write();
}
