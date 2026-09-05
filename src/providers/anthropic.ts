import type { AggregateRequest, AggregateResponse, AuthScheme, ProviderAdapter, ReviewRequest, ReviewResponse } from "./types.js";
import { buildAggregatePrompt, buildReviewPrompt, parseReviewResponse } from "./prompts.js";
import { fetchWithTimeout } from "./http.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const MAX_TOKENS = 4096;

interface AnthropicMessageResponse {
  content?: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

async function callAnthropic(params: {
  apiKey: string;
  authScheme?: AuthScheme;
  model: string;
  system: string;
  user: string;
  timeoutMs: number;
}): Promise<{ text: string; usage?: { inputTokens?: number; outputTokens?: number } }> {
  // "bearer" is a WIF-minted access token (spec 002); default "api_key" is unchanged
  // apiKeySecret behavior (spec 001).
  const authHeaders: Record<string, string> =
    params.authScheme === "bearer"
      ? { authorization: `Bearer ${params.apiKey}` }
      : { "x-api-key": params.apiKey };

  const response = await fetchWithTimeout(
    ANTHROPIC_API_URL,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authHeaders,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: MAX_TOKENS,
        system: params.system,
        messages: [{ role: "user", content: params.user }],
      }),
    },
    params.timeoutMs,
  );

  const data = (await response.json()) as AnthropicMessageResponse;
  const text = data.content?.find((block) => block.type === "text")?.text;
  if (!text) {
    throw new Error("Anthropic response contained no text content block.");
  }

  return {
    text,
    usage: data.usage
      ? { inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens }
      : undefined,
  };
}

export const anthropicAdapter: ProviderAdapter = {
  key: "anthropic",

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    const { system, user } = buildReviewPrompt(request);
    const { text, usage } = await callAnthropic({
      apiKey: request.apiKey,
      authScheme: request.authScheme,
      model: request.model,
      system,
      user,
      timeoutMs: request.timeoutMs,
    });
    return { findingSet: parseReviewResponse(request.model, text), usage };
  },

  async aggregate(request: AggregateRequest): Promise<AggregateResponse> {
    const { system, user } = buildAggregatePrompt(request);
    const { text, usage } = await callAnthropic({
      apiKey: request.apiKey,
      authScheme: request.authScheme,
      model: request.model,
      system,
      user,
      timeoutMs: request.timeoutMs,
    });
    return {
      report: {
        // pullRequest is a placeholder — actions/aggregate fills it in, since it owns
        // run-level context the adapter never receives.
        pullRequest: { owner: "", repo: "", number: 0 },
        generatedAt: new Date().toISOString(),
        body: text,
        agentsReported: request.findingSets.map((fs) => fs.agentId),
        agentsMissing: request.missingAgents,
        diffTruncated: request.diffTruncated,
      },
      usage,
    };
  },
};
