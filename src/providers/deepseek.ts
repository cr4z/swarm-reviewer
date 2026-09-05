import type { AggregateRequest, AggregateResponse, ProviderAdapter, ReviewRequest, ReviewResponse } from "./types.js";
import { buildAggregatePrompt, buildReviewPrompt, parseReviewResponse } from "./prompts.js";
import { openAiCompatibleChat } from "./openai-compatible.js";

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

export const deepseekAdapter: ProviderAdapter = {
  key: "deepseek",

  async review(request: ReviewRequest): Promise<ReviewResponse> {
    const { system, user } = buildReviewPrompt(request);
    const { text, usage } = await openAiCompatibleChat({
      baseUrl: DEEPSEEK_API_URL,
      apiKey: request.apiKey,
      model: request.model,
      system,
      user,
      timeoutMs: request.timeoutMs,
    });
    return { findingSet: parseReviewResponse(request.model, text), usage };
  },

  async aggregate(request: AggregateRequest): Promise<AggregateResponse> {
    const { system, user } = buildAggregatePrompt(request);
    const { text, usage } = await openAiCompatibleChat({
      baseUrl: DEEPSEEK_API_URL,
      apiKey: request.apiKey,
      model: request.model,
      system,
      user,
      timeoutMs: request.timeoutMs,
    });
    return {
      report: {
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
