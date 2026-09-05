// Anthropic Workload Identity Federation (WIF) token exchange.
// See specs/002-anthropic-wif-auth/research.md #1 and contracts/federation-auth-contract.md.
//
// Hand-rolled fetch rather than @anthropic-ai/sdk's WorkloadIdentityCredentials, consistent
// with this project's no-per-provider-SDK stance (spec 001 research.md #6): this is one
// simple JSON POST with no signing/crypto, and each run-agent leg is a single short-lived
// process, so the SDK's caching/refresh loop buys nothing here.

const TOKEN_ENDPOINT = "https://api.anthropic.com/v1/oauth/token";
const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";

/** Audience to request the GitHub OIDC token for — Anthropic's documented recommendation. */
export const WIF_AUDIENCE = "https://api.anthropic.com";

export interface FederationExchangeParams {
  /** The GitHub Actions OIDC JWT (from @actions/core's getIDToken()). */
  githubOidcToken: string;
  federationRuleId: string;
  organizationId: string;
  serviceAccountId: string;
  /** Required only when the federation rule spans more than one workspace. */
  workspaceId?: string;
}

export interface FederationExchangeResult {
  /** The minted, short-lived credential (sk-ant-oat01-...). Use as Authorization: Bearer. */
  accessToken: string;
  expiresInSeconds: number;
}

interface TokenExchangeResponseBody {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
}

/**
 * Exchanges a GitHub Actions OIDC token for a short-lived Anthropic access token via an
 * org-configured federation rule. Never includes the JWT or the raw response body in a
 * thrown error message (defensive — the documented error shape doesn't echo them, but the
 * bar here is the same as for any other credential per Principle VI).
 */
export async function exchangeGithubOidcForAnthropicToken(
  params: FederationExchangeParams,
): Promise<FederationExchangeResult> {
  const body: Record<string, string> = {
    grant_type: GRANT_TYPE,
    assertion: params.githubOidcToken,
    federation_rule_id: params.federationRuleId,
    organization_id: params.organizationId,
    service_account_id: params.serviceAccountId,
  };
  if (params.workspaceId) {
    body.workspace_id = params.workspaceId;
  }

  let response: Response;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new Error(
      `Federation token exchange request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!response.ok) {
    // Every denial is an opaque 401 "Authentication failed" per Anthropic's docs, or a 400
    // naming a malformed request field — neither case echoes the assertion back, but we still
    // never forward the raw body verbatim in case that changes.
    throw new Error(
      `Federation token exchange rejected (HTTP ${response.status}). Check the federation rule, ` +
        "organization/service-account IDs, and that the GitHub Actions job has id-token: write.",
    );
  }

  const data = (await response.json()) as TokenExchangeResponseBody;
  if (!data.access_token || typeof data.expires_in !== "number") {
    throw new Error("Federation token exchange succeeded but the response was missing access_token/expires_in.");
  }

  return { accessToken: data.access_token, expiresInSeconds: data.expires_in };
}
