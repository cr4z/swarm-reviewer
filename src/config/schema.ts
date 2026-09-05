// Canonical JSON Schema for the Configuration file. Mirrored (for documentation) at
// specs/001-multi-model-pr-review/contracts/config.schema.json and, for the auth extension,
// specs/002-anthropic-wif-auth/contracts/federation-auth-contract.md — keep all in sync.
//
// Note: the cross-field "exactly one role: aggregator", "every apiKeySecret is non-empty",
// and "exactly one of apiKeySecret/auth per agent" checks are NOT expressible cleanly in
// JSON Schema draft-07 and are enforced programmatically in validate.ts after this schema
// passes (see data-model.md's Validation rules).

export const configSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/cr4z/swarm-reviewer/contracts/config.schema.json",
  title: "Swarm Reviewer Configuration",
  type: "object",
  required: ["version", "agents"],
  additionalProperties: false,
  properties: {
    version: {
      type: "integer",
      enum: [1],
    },
    agents: {
      type: "array",
      minItems: 1,
      items: { $ref: "#/$defs/reviewAgent" },
    },
    diff: {
      type: "object",
      additionalProperties: false,
      properties: {
        maxBytes: { type: "integer", minimum: 1024 },
      },
    },
    delivery: {
      type: "object",
      additionalProperties: false,
      properties: {
        prComment: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean", default: true },
          },
        },
        email: {
          type: "object",
          additionalProperties: false,
          properties: {
            enabled: { type: "boolean", default: true },
            recipients: {
              type: "array",
              items: { type: "string", format: "email" },
              minItems: 1,
            },
            provider: { type: "string", enum: ["resend", "sendgrid"] },
            apiKeySecret: { type: "string", minLength: 1 },
          },
        },
      },
    },
  },
  $defs: {
    reviewAgent: {
      type: "object",
      // apiKeySecret is NOT listed as required here — an agent may instead supply `auth`
      // (WIF). Exactly-one-of enforcement is programmatic (see the note above).
      required: ["id", "provider", "model"],
      additionalProperties: false,
      properties: {
        id: { type: "string", pattern: "^[a-zA-Z0-9_-]+$" },
        provider: { type: "string" },
        model: { type: "string" },
        apiKeySecret: { type: "string", minLength: 1 },
        auth: { $ref: "#/$defs/federationAuth" },
        role: { type: "string", enum: ["reviewer", "aggregator"], default: "reviewer" },
        timeoutSeconds: { type: "integer", minimum: 1, default: 180 },
      },
    },
    federationAuth: {
      type: "object",
      required: ["type", "federationRuleId", "organizationId", "serviceAccountId"],
      additionalProperties: false,
      properties: {
        type: { const: "wif" },
        federationRuleId: { type: "string", minLength: 1 },
        organizationId: { type: "string", minLength: 1 },
        serviceAccountId: { type: "string", minLength: 1 },
        workspaceId: { type: "string", minLength: 1 },
      },
    },
  },
} as const;

export interface FederationAuthConfig {
  type: "wif";
  federationRuleId: string;
  organizationId: string;
  serviceAccountId: string;
  workspaceId?: string;
}

export interface ReviewAgentConfig {
  id: string;
  provider: string;
  model: string;
  /** Exactly one of apiKeySecret/auth is present — enforced in validate.ts. */
  apiKeySecret?: string;
  auth?: FederationAuthConfig;
  role?: "reviewer" | "aggregator";
  timeoutSeconds?: number;
}

export interface EmailDeliveryConfig {
  enabled?: boolean;
  recipients?: string[];
  provider?: "resend" | "sendgrid";
  apiKeySecret?: string;
}

export interface SwarmReviewerConfig {
  version: number;
  agents: ReviewAgentConfig[];
  diff?: { maxBytes?: number };
  delivery?: {
    prComment?: { enabled?: boolean };
    email?: EmailDeliveryConfig;
  };
}
