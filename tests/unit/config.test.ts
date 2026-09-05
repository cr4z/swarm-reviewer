import { describe, it, expect } from "vitest";
import { validateConfig, ConfigValidationError } from "../../src/config/validate.js";

const knownProviders = ["anthropic", "openai", "deepseek", "kimi"];

function baseConfig() {
  return {
    version: 1,
    agents: [
      { id: "a", provider: "anthropic", model: "claude-sonnet-4-5", apiKeySecret: "A_KEY" },
      { id: "b", provider: "openai", model: "gpt-5.1", apiKeySecret: "B_KEY", role: "aggregator" },
    ],
  };
}

describe("validateConfig", () => {
  it("accepts a valid config", () => {
    const config = validateConfig(baseConfig(), { knownProviders });
    expect(config.agents).toHaveLength(2);
  });

  it("rejects a config missing a required field", () => {
    const bad = baseConfig();
    // @ts-expect-error deliberately invalid for the test
    delete bad.agents[0].model;
    expect(() => validateConfig(bad, { knownProviders })).toThrow(ConfigValidationError);
  });

  it("rejects a config with zero aggregators", () => {
    const bad = baseConfig();
    bad.agents = [{ id: "a", provider: "anthropic", model: "x", apiKeySecret: "A_KEY" }];
    expect(() => validateConfig(bad, { knownProviders })).toThrow(/exactly one agent with role "aggregator"/);
  });

  it("rejects a config with two aggregators", () => {
    const bad = baseConfig();
    (bad.agents[0] as { role?: string }).role = "aggregator";
    expect(() => validateConfig(bad, { knownProviders })).toThrow(/exactly one agent with role "aggregator"/);
  });

  it("rejects a config with an unknown provider", () => {
    const bad = baseConfig();
    bad.agents[0]!.provider = "totally-unknown-vendor";
    expect(() => validateConfig(bad, { knownProviders })).toThrow(/unknown provider/);
  });

  it("rejects an unsupported config version", () => {
    const bad = baseConfig();
    bad.version = 999;
    expect(() => validateConfig(bad, { knownProviders })).toThrow(ConfigValidationError);
  });

  it("rejects an empty agents array", () => {
    const bad = baseConfig();
    bad.agents = [];
    expect(() => validateConfig(bad, { knownProviders })).toThrow(ConfigValidationError);
  });

  it("rejects duplicate agent ids", () => {
    const bad = baseConfig();
    bad.agents[1]!.id = "a";
    expect(() => validateConfig(bad, { knownProviders })).toThrow(/Duplicate agent id/);
  });

  it("rejects email delivery enabled without recipients", () => {
    const bad = {
      ...baseConfig(),
      delivery: { email: { enabled: true, provider: "resend", apiKeySecret: "EMAIL_KEY" } },
    };
    expect(() => validateConfig(bad, { knownProviders })).toThrow(/recipients/);
  });

  it("allows email delivery to be entirely omitted", () => {
    expect(() => validateConfig(baseConfig(), { knownProviders })).not.toThrow();
  });

  describe("federation (WIF) auth — spec 002", () => {
    const wifAuth = {
      type: "wif" as const,
      federationRuleId: "fdrl_1",
      organizationId: "org-1",
      serviceAccountId: "svac_1",
    };

    it("accepts an anthropic agent using auth instead of apiKeySecret", () => {
      const config = {
        version: 1,
        agents: [
          { id: "a", provider: "anthropic", model: "claude-sonnet-4-5", auth: wifAuth },
          { id: "b", provider: "anthropic", model: "claude-sonnet-4-5", apiKeySecret: "B_KEY", role: "aggregator" },
        ],
      };
      expect(() => validateConfig(config, { knownProviders })).not.toThrow();
    });

    it("rejects an agent declaring both apiKeySecret and auth", () => {
      const bad = baseConfig();
      (bad.agents[0] as { auth?: unknown }).auth = wifAuth;
      expect(() => validateConfig(bad, { knownProviders })).toThrow(/declares both "apiKeySecret" and "auth"/);
    });

    it("rejects an agent declaring neither apiKeySecret nor auth", () => {
      const bad = baseConfig();
      delete (bad.agents[0] as { apiKeySecret?: string }).apiKeySecret;
      expect(() => validateConfig(bad, { knownProviders })).toThrow(/declares neither "apiKeySecret" nor "auth"/);
    });

    it("rejects auth on a non-anthropic agent", () => {
      const bad = baseConfig();
      delete (bad.agents[1] as { apiKeySecret?: string }).apiKeySecret;
      (bad.agents[1] as { auth?: unknown }).auth = wifAuth; // agents[1].provider === "openai"
      expect(() => validateConfig(bad, { knownProviders })).toThrow(
        /federation auth is only supported for provider "anthropic"/,
      );
    });
  });
});
