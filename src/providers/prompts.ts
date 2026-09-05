import Ajv from "ajv";
import type { Finding, FindingSet } from "../lib/types.js";
import type { AggregateRequest, PullRequestContext, ReviewRequest } from "./types.js";
import { extractJson } from "./http.js";

const ajv = new Ajv({ allErrors: true, strict: true });

// Matches contracts/finding-set.schema.json's "findings"/"summary" shape, minus the
// agentId/model fields the caller (not the model) fills in.
const reviewResponseSchema = {
  type: "object",
  required: ["summary", "findings"],
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "description"],
        additionalProperties: false,
        properties: {
          severity: { type: "string", enum: ["blocking", "warning", "note"] },
          file: { type: ["string", "null"] },
          line: { type: ["integer", "null"] },
          description: { type: "string" },
        },
      },
    },
  },
} as const;

const validateReviewResponse = ajv.compile(reviewResponseSchema);

export function buildReviewPrompt(request: ReviewRequest): { system: string; user: string } {
  const system =
    "You are one of several independent code reviewers examining a single pull request. " +
    "Review only the diff you are given. Respond with ONLY a JSON object of the exact shape " +
    '{"summary": string, "findings": [{"severity": "blocking"|"warning"|"note", "file": string|null, "line": number|null, "description": string}]}. ' +
    "No prose outside the JSON. An empty findings array is fine if you have nothing to flag.";

  const user = renderPullRequestAndDiff(request.pullRequestContext, request.diff, request.diffTruncated);

  return { system, user };
}

/**
 * Parses a model's review response into a FindingSet. `agentId` is left empty — the
 * ProviderAdapter has no notion of which configured agent it's running as, so the caller
 * (actions/run-agent) fills that in from the config it already has.
 */
export function parseReviewResponse(model: string, text: string): FindingSet {
  const parsed = extractJson(text);
  if (!validateReviewResponse(parsed)) {
    const detail = (validateReviewResponse.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join("; ");
    throw new Error(`Model response did not match the expected review JSON shape: ${detail}`);
  }
  const { summary, findings } = parsed as { summary: string; findings: Finding[] };
  return { agentId: "", model, summary, findings };
}

export function buildAggregatePrompt(request: AggregateRequest): { system: string; user: string } {
  const system =
    "You are the aggregator for a multi-model pull request review. You are given the raw " +
    "findings already produced by other review agents. Synthesize them into ONE clear " +
    "Markdown report for a human reading a GitHub PR comment. Do not re-review the diff " +
    "yourself or introduce findings the other agents did not raise — your job is synthesis: " +
    "deduplicate overlapping findings, organize by severity, and write a short overall " +
    "verdict. If any agents are listed as missing, explicitly say so near the top of the " +
    "report, naming each one and the reason given. Respond with ONLY the Markdown report " +
    "body — no preamble, no code fences around the whole thing.";

  const findingsBlock = request.findingSets
    .map(
      (fs) =>
        `### Findings from agent "${fs.agentId}" (model: ${fs.model})\nSummary: ${fs.summary}\n` +
        (fs.findings.length === 0
          ? "No findings.\n"
          : fs.findings
              .map((f) => `- [${f.severity}] ${f.file ?? "(general)"}${f.line ? `:${f.line}` : ""} — ${f.description}`)
              .join("\n") + "\n"),
    )
    .join("\n");

  const missingBlock =
    request.missingAgents.length === 0
      ? ""
      : "\n### Agents that did not report in\n" +
        request.missingAgents.map((m) => `- ${m.agentId}: ${m.reason}`).join("\n") +
        "\n";

  const prContext = renderPullRequestAndDiff(request.pullRequestContext, undefined, request.diffTruncated);

  const user = `${prContext}\n\n${findingsBlock}${missingBlock}`;

  return { system, user };
}

function renderPullRequestAndDiff(context: PullRequestContext, diff: string | undefined, diffTruncated: boolean): string {
  const truncatedNote = diffTruncated ? "\n\n(Note: the diff below was truncated to stay within size limits.)" : "";
  const diffBlock = diff !== undefined ? `\n\n## Diff\n\`\`\`diff\n${diff}\n\`\`\`` : "";
  return `## Pull Request\nTitle: ${context.title}\nDescription: ${context.description || "(none)"}${truncatedNote}${diffBlock}`;
}
