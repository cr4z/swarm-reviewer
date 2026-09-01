// Shared HTTP call for the OpenAI-compatible chat-completions shape that OpenAI, DeepSeek,
// and Moonshot AI (Kimi) all expose. Each provider still gets its own adapter file
// (openai.ts / deepseek.ts / kimi.ts) per contracts/provider-adapter-contract.md — this
// only factors out the identical request/response wire format, not the adapter identity.
import { fetchWithTimeout } from "./http.js";

export interface OpenAiCompatibleChatResult {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export async function openAiCompatibleChat(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  system: string;
  user: string;
  timeoutMs: number;
}): Promise<OpenAiCompatibleChatResult> {
  const response = await fetchWithTimeout(
    params.baseUrl,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: "system", content: params.system },
          { role: "user", content: params.user },
        ],
      }),
    },
    params.timeoutMs,
  );

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error("Provider response contained no message content.");
  }

  return {
    text,
    usage: data.usage
      ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens }
      : undefined,
  };
}
