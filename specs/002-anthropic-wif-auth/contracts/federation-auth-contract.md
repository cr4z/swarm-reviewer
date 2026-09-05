# Contract: Federation Auth (extends spec 001's contracts)

## Configuration file delta

Extends `contracts/config.schema.json` (spec 001). A `reviewAgent` entry gains an optional
`auth` object and `apiKeySecret` becomes conditionally required:

```json
{
  "$defs": {
    "reviewAgent": {
      "required": ["id", "provider", "model"],
      "properties": {
        "apiKeySecret": { "type": "string", "minLength": 1 },
        "auth": { "$ref": "#/$defs/federationAuth" }
      }
    },
    "federationAuth": {
      "type": "object",
      "required": ["type", "federationRuleId", "organizationId", "serviceAccountId"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "wif" },
        "federationRuleId": { "type": "string", "minLength": 1 },
        "organizationId": { "type": "string", "minLength": 1 },
        "serviceAccountId": { "type": "string", "minLength": 1 },
        "workspaceId": { "type": "string", "minLength": 1 }
      }
    }
  }
}
```

The "exactly one of `apiKeySecret`/`auth`" and "`auth` only valid when `provider === \"anthropic\"`"
rules are cross-field constraints, enforced programmatically in `validate.ts` (same reason
spec 001's "exactly one aggregator" rule is — JSON Schema draft-07 can't express them).

## `ProviderAdapter` interface delta (extends provider-adapter-contract.md)

```ts
interface ReviewRequest {
  // ...unchanged fields from spec 001...
  apiKey: string;
  /** Default "api_key" (x-api-key header). "bearer" for a WIF-minted access token. */
  authScheme?: "api_key" | "bearer";
}

interface AggregateRequest {
  // ...unchanged fields from spec 001...
  apiKey: string;
  authScheme?: "api_key" | "bearer";
}
```

`anthropic.ts` is the only adapter that branches on `authScheme`. The other three adapters
(`openai.ts`, `deepseek.ts`, `kimi.ts` via `openai-compatible.ts`) are unmodified — they always
send `Authorization: Bearer <apiKey>` regardless, so the field is simply unused for them.

## Federation token exchange (new, internal — not a public contract for consumers)

`src/lib/federation.ts` exports:

```ts
interface FederationExchangeParams {
  githubOidcToken: string;
  federationRuleId: string;
  organizationId: string;
  serviceAccountId: string;
  workspaceId?: string;
}

interface FederationExchangeResult {
  accessToken: string; // sk-ant-oat01-...
  expiresInSeconds: number;
}

function exchangeGithubOidcForAnthropicToken(
  params: FederationExchangeParams,
): Promise<FederationExchangeResult>;
```

Implementation: one `POST https://api.anthropic.com/v1/oauth/token` (research.md #1). Thrown
errors must never include `githubOidcToken` or the response body verbatim if it could echo
request fields back (defensive; the documented error shape doesn't, but never assume).

## Who calls what (sequencing, not a wire contract)

For an agent with `auth.type === "wif"`, `actions/run-agent` (or `actions/aggregate` for the
aggregator agent):

1. Calls `@actions/core`'s `getIDToken("https://api.anthropic.com")` — requires the job to
   have been granted `permissions: id-token: write` (workflow-call-contract.md delta below).
2. Calls `exchangeGithubOidcForAnthropicToken()` with that JWT plus the agent's `auth` fields.
3. Builds `apiKey: result.accessToken, authScheme: "bearer"` on the `ReviewRequest` /
   `AggregateRequest` passed to the `anthropic` adapter — from here on, identical to the
   `apiKeySecret` path.

For an `apiKeySecret` agent, nothing changes: `apiKey` is the resolved secret value,
`authScheme` is omitted (defaults to `"api_key"`).

## `workflow-call-contract.md` delta (spec 001)

Add to the reusable workflow's required consumer permissions:

- `id-token: write` — required only on the jobs that run review agents and aggregation; not
  required workflow-wide, and not required at all for a consumer with no `auth`-configured
  agents (though the permission is still granted statically per research.md #4 — it is simply
  never exercised for such a consumer).

No change to the `workflow_call` `inputs`/`secrets` surface itself — WIF identifiers travel in
the config file (data-model.md), not as `workflow_call` secrets or inputs.
