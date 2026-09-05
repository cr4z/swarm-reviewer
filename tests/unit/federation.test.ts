import { describe, it, expect, vi, afterEach } from "vitest";
import { exchangeGithubOidcForAnthropicToken } from "../../src/lib/federation.js";

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok,
    status,
    statusText: ok ? "OK" : "Unauthorized",
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const baseParams = {
  githubOidcToken: "eyJ-super-secret-github-jwt",
  federationRuleId: "fdrl_123",
  organizationId: "00000000-0000-0000-0000-000000000000",
  serviceAccountId: "svac_123",
};

describe("exchangeGithubOidcForAnthropicToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the RFC 7523 jwt-bearer request and returns the access token", async () => {
    const fetchMock = mockFetchOnce({
      access_token: "sk-ant-oat01-abc",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "workspace:developer",
    });

    const result = await exchangeGithubOidcForAnthropicToken(baseParams);

    expect(result).toEqual({ accessToken: "sk-ant-oat01-abc", expiresInSeconds: 3600 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/oauth/token");
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody).toMatchObject({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: baseParams.githubOidcToken,
      federation_rule_id: baseParams.federationRuleId,
      organization_id: baseParams.organizationId,
      service_account_id: baseParams.serviceAccountId,
    });
    expect(sentBody.workspace_id).toBeUndefined();
  });

  it("includes workspace_id only when provided", async () => {
    const fetchMock = mockFetchOnce({ access_token: "sk-ant-oat01-abc", expires_in: 600 });

    await exchangeGithubOidcForAnthropicToken({ ...baseParams, workspaceId: "wrkspc_1" });

    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(sentBody.workspace_id).toBe("wrkspc_1");
  });

  it("throws a clear error on a rejected exchange, without leaking the JWT", async () => {
    mockFetchOnce({ type: "error", error: { type: "authentication_error", message: "Authentication failed" } }, false, 401);

    await expect(exchangeGithubOidcForAnthropicToken(baseParams)).rejects.toThrow(/rejected|failed/i);
    try {
      await exchangeGithubOidcForAnthropicToken(baseParams);
    } catch (err) {
      expect((err as Error).message).not.toContain(baseParams.githubOidcToken);
    }
  });

  it("throws when the response is missing access_token or expires_in", async () => {
    mockFetchOnce({ token_type: "Bearer" });
    await expect(exchangeGithubOidcForAnthropicToken(baseParams)).rejects.toThrow(/access_token/);
  });

  it("times out rather than hanging indefinitely", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        });
      }),
    );

    const promise = exchangeGithubOidcForAnthropicToken(baseParams);
    const assertion = expect(promise).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(15_000); // matches federation.ts's EXCHANGE_TIMEOUT_MS
    await assertion;
    vi.useRealTimers();
  });
});
