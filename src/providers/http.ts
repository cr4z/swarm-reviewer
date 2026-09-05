/**
 * fetch with an enforced timeout (Principle VI / FR-004) shared by every provider adapter.
 * Throws a plain Error on timeout/network/non-2xx — callers (run-agent) catch this and
 * record it as an AgentResult, never let it propagate and fail the whole matrix job.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${bodyText.slice(0, 500)}`);
    }
    return response;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracts a JSON object from a model response that may wrap it in a ```json fenced block
 * or include leading/trailing prose despite being asked for JSON only.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("Model response did not contain a JSON object.");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}
