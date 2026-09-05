# Phase 1 Data Model: Anthropic Workload Identity Federation Auth

This extends spec 001's `data-model.md` — only the delta is documented here. Every entity not
listed below (Run, AgentResult, FindingSet, UnifiedReport, DeliveryChannel) is unchanged.

## ReviewAgent *(extended)*

Spec 001 required `apiKeySecret` unconditionally. That requirement is now conditional:

| Field | Type | Required | Notes |
|---|---|---|---|
| `apiKeySecret` | string | Conditional | Required unless `auth` is present. Unchanged meaning (name of a GitHub secret). |
| `auth` | Federation Auth Config | Conditional | Present only for `provider: "anthropic"` agents opting into WIF. Mutually exclusive with `apiKeySecret`. |

**Validation rules** (extends spec 001's — enforced fail-fast, same posture as FR-011):

- Exactly one of `apiKeySecret` or `auth` MUST be present per agent — never both, never
  neither (FR-004).
- `auth` MUST NOT be present unless `provider === "anthropic"` (FR-002).

## Federation Auth Config *(new)*

The non-secret identifiers needed to exchange a GitHub OIDC token for a short-lived Anthropic
credential (research.md #1, #6).

| Field | Type | Required | Notes |
|---|---|---|---|
| `type` | `"wif"` | yes | Discriminator; only value for v1 (future auth modes, if any, get their own `type`). |
| `federationRuleId` | string | yes | The Anthropic federation rule (`fdrl_...`) to evaluate against. |
| `organizationId` | string | yes | The Anthropic organization UUID. |
| `serviceAccountId` | string | yes | The target service account (`svac_...`) the minted token acts as. |
| `workspaceId` | string | no | Required only when the referenced rule spans more than one workspace (research.md #1). |

None of these fields alone is a usable credential (research.md #6) — every exchange still
requires a live, single-use GitHub OIDC JWT obtained at run time.

## Credential *(new, internal)*

Not part of the Configuration file — an internal value `run-agent`/`aggregate` build once per
agent before calling a `ProviderAdapter`, replacing the plain `apiKey: string` those actions
used to pass straight through unexamined.

| Field | Type | Notes |
|---|---|---|
| `value` | string | Either the resolved `apiKeySecret` value (unchanged) or the WIF-minted `access_token`. |
| `authScheme` | `"api_key"` \| `"bearer"` | Which header style to use — `"api_key"` (default) sends `x-api-key`; `"bearer"` sends `Authorization: Bearer`. Only ever `"bearer"` for a WIF-derived credential. |

`ProviderAdapter.review()`/`aggregate()` (contracts/provider-adapter-contract.md, spec 001)
gain this as an addition to `ReviewRequest`/`AggregateRequest` — see
`contracts/federation-auth-contract.md` in this feature for the exact interface delta.

## Entity relationships (delta)

```text
ReviewAgent 1───0..1 Federation Auth Config (mutually exclusive with apiKeySecret)
Run (per agent) 1───1 Credential (resolved by run-agent/aggregate before calling a ProviderAdapter,
                                   from either apiKeySecret or a live WIF exchange)
```
