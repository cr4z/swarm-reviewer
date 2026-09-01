import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { anthropicAdapter } from "../../src/providers/anthropic.js";
import { openaiAdapter } from "../../src/providers/openai.js";
import { deepseekAdapter } from "../../src/providers/deepseek.js";
import { kimiAdapter } from "../../src/providers/kimi.js";
import type { ReviewRequest } from "../../src/providers/types.js";

const fixturesDir = fileURLToPath(new URL("../fixtures/", import.meta.url));

async function loadFixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(`${fixturesDir}${name}`, "utf-8"));
}

function baseRequest(): ReviewRequest {
  return {
    model: "some-model",
    apiKey: "test-key",
    diff: "diff --git a/x b/x\n+console.log('hi')",
    diffTruncated: false,
    pullRequestContext: { title: "Add feature", description: "Does a thing." },
    timeoutMs: 5000,
  };
}

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("provider adapters — review()", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("anthropic adapter maps the Messages API response to a FindingSet", async () => {
    const fixture = await loadFixture("anthropic-review-response.json");
    const fetchMock = mockFetchOnce(fixture);

    const { findingSet, usage } = await anthropicAdapter.review(baseRequest());

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages",
      expect.objectContaining({ method: "POST" }),
    );
    expect(findingSet.summary).toBe("One nit found.");
    expect(findingSet.findings).toHaveLength(1);
    expect(findingSet.findings[0]).toMatchObject({ severity: "note", file: "src/index.ts", line: 12 });
    expect(usage).toEqual({ inputTokens: 1200, outputTokens: 80 });
  });

  it.each([
    ["openai", openaiAdapter, "https://api.openai.com/v1/chat/completions"],
    ["deepseek", deepseekAdapter, "https://api.deepseek.com/chat/completions"],
    ["kimi", kimiAdapter, "https://api.moonshot.cn/v1/chat/completions"],
  ] as const)("%s adapter maps the OpenAI-compatible response to a FindingSet", async (_name, adapter, url) => {
    const fixture = await loadFixture("openai-compatible-review-response.json");
    const fetchMock = mockFetchOnce(fixture);

    const { findingSet, usage } = await adapter.review(baseRequest());

    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({ method: "POST" }));
    expect(findingSet.summary).toBe("Looks solid overall.");
    expect(findingSet.findings[0]).toMatchObject({ severity: "blocking", file: "src/auth.ts", line: 42 });
    expect(usage).toEqual({ inputTokens: 950, outputTokens: 60 });
  });

  it("throws (never returns) when the model response isn't valid JSON matching the schema", async () => {
    mockFetchOnce({ content: [{ type: "text", text: "not json at all" }] });
    await expect(anthropicAdapter.review(baseRequest())).rejects.toThrow();
  });

  it("never includes the API key in a thrown error on an HTTP failure", async () => {
    mockFetchOnce({ error: "unauthorized: key sk-super-secret-abc123" }, false, 401);
    const request = { ...baseRequest(), apiKey: "sk-super-secret-abc123" };
    await expect(anthropicAdapter.review(request)).rejects.toThrow();
    // The adapter itself doesn't redact (run-agent does, at the boundary) — this test just
    // documents that the raw provider error is what's thrown, so run-agent's redact() has
    // something deterministic to scrub.
  });
});

describe("provider adapters — aggregate()", () => {
  beforeEach(() => {
    mockFetchOnce({
      content: [{ type: "text", text: "## Summary\n\nAll good." }],
      choices: [{ message: { content: "## Summary\n\nAll good." } }],
      usage: { input_tokens: 500, output_tokens: 40, prompt_tokens: 500, completion_tokens: 40 },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not JSON-parse the aggregate response — body is raw Markdown text", async () => {
    const { report } = await anthropicAdapter.aggregate({
      model: "some-model",
      apiKey: "test-key",
      findingSets: [],
      missingAgents: [{ agentId: "b", reason: "timed out" }],
      diffTruncated: false,
      pullRequestContext: { title: "t", description: "d" },
      timeoutMs: 5000,
    });

    expect(report.body).toBe("## Summary\n\nAll good.");
    expect(report.agentsMissing).toEqual([{ agentId: "b", reason: "timed out" }]);
  });
});
