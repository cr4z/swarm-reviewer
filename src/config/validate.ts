import Ajv from "ajv";
import addFormats from "ajv-formats";
import { configSchema, type SwarmReviewerConfig } from "./schema.js";

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validateSchema = ajv.compile(configSchema);

const SUPPORTED_VERSIONS = [1];

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

export interface ValidateConfigOptions {
  /**
   * Provider keys the run actually has adapters registered for. Injected rather than read
   * from the provider registry directly, so this module has no import-time dependency on
   * providers/registry.ts (see data-model.md's Validation rules; contracts/provider-adapter-contract.md).
   */
  knownProviders: string[];
}

/**
 * Fail-fast validation of the Configuration file (FR-011). Throws ConfigValidationError
 * with a message naming the specific problem — never returns a "partially valid" config.
 */
export function validateConfig(raw: unknown, options: ValidateConfigOptions): SwarmReviewerConfig {
  if (!validateSchema(raw)) {
    const detail = (validateSchema.errors ?? [])
      .map((e) => `${e.instancePath || "(root)"} ${e.message}`)
      .join("; ");
    throw new ConfigValidationError(`Configuration is invalid: ${detail}`);
  }

  const config = raw as SwarmReviewerConfig;

  if (!SUPPORTED_VERSIONS.includes(config.version)) {
    throw new ConfigValidationError(
      `Unsupported config version ${config.version}. Supported versions: ${SUPPORTED_VERSIONS.join(", ")}.`,
    );
  }

  if (config.agents.length === 0) {
    throw new ConfigValidationError("Configuration must declare at least one agent in \"agents\".");
  }

  const seenIds = new Set<string>();
  for (const agent of config.agents) {
    if (seenIds.has(agent.id)) {
      throw new ConfigValidationError(`Duplicate agent id "${agent.id}" — agent ids must be unique.`);
    }
    seenIds.add(agent.id);

    if (!options.knownProviders.includes(agent.provider)) {
      throw new ConfigValidationError(
        `Agent "${agent.id}" declares unknown provider "${agent.provider}". ` +
          `Known providers: ${options.knownProviders.join(", ") || "(none registered)"}.`,
      );
    }

    if (!agent.apiKeySecret.trim()) {
      throw new ConfigValidationError(`Agent "${agent.id}" has an empty "apiKeySecret".`);
    }
  }

  const aggregators = config.agents.filter((a) => a.role === "aggregator");
  if (aggregators.length === 0) {
    throw new ConfigValidationError(
      'Configuration must designate exactly one agent with role "aggregator"; found none.',
    );
  }
  if (aggregators.length > 1) {
    throw new ConfigValidationError(
      `Configuration must designate exactly one agent with role "aggregator"; found ${aggregators.length}: ` +
        aggregators.map((a) => a.id).join(", ") +
        ".",
    );
  }

  const email = config.delivery?.email;
  if (email?.enabled !== false) {
    // enabled defaults to true (schema default is documentation-only for ajv without useDefaults,
    // so treat "not explicitly false" as enabled here, matching data-model.md).
    if (email) {
      if (!email.recipients || email.recipients.length === 0) {
        throw new ConfigValidationError('Email delivery is enabled but "delivery.email.recipients" is empty.');
      }
      if (!email.provider) {
        throw new ConfigValidationError('Email delivery is enabled but "delivery.email.provider" is missing.');
      }
      if (!email.apiKeySecret || !email.apiKeySecret.trim()) {
        throw new ConfigValidationError('Email delivery is enabled but "delivery.email.apiKeySecret" is missing.');
      }
    }
  }

  return config;
}
