import { describe, expect, it } from "vitest";
import approvedProfiles from "../../../registry/provisioning-profiles.json";
import { configFromEnv } from "./config";
import { ProvisioningProfiles } from "./provisioning-profile";

/*
 * The reviewed provisioning manifest ships in registry/provisioning-profiles.json and is
 * compiled into the binary, so it is part of the default config whatever the environment
 * says. It is inert on its own: issuing a device configuration still needs the paired
 * DEVICE_HANDOFF_KEYS / DEVICE_INGEST_URL secrets below, which default to null.
 */
const APPROVED_PROFILES = ProvisioningProfiles.parse(approvedProfiles);

const DB = { DB_HOST: "10.0.0.3", DB_NAME: "albus", DB_USER: "albus_app", DB_PASSWORD: "s3cret-value", RESEND_API_KEY: "re_test" };

const AUTH_DEFAULTS = {
  emailAdapter: "resend",
  resendApiKey: "re_test",
  emailFrom: "Albusforge <sign-in@auth.albusforge.ai>",
  internalAuth: null,
  trustedProxyHops: 1,
  codesPerEmail: 5,
  codesPerIp: 20,
  verifiesPerIp: 30,
};

describe("configFromEnv", () => {
  it("defaults PORT to 8080, DB_SSL to require, and bounds every database wait", () => {
    expect(configFromEnv(DB)).toEqual({
      deviceProvisioning: { keys: null, ingestUrl: null, profiles: APPROVED_PROFILES },
      port: 8080,
      db: { host: "10.0.0.3", port: 5432, database: "albus", user: "albus_app", password: "s3cret-value", ssl: "require" },
      dbTimeouts: { connectMs: 5000, queryMs: 10_000, readMs: 11_000, idleMs: 30_000 },
      sensorAsk: { url: null, auth: "google" },
      intake: { url: null, auth: "google" },
      registryIncludeDrafts: false,
      anonBuildsPerHour: 60,
      sseStreamLimits: { perOwner: 3, perInstance: 100 },
      auth: AUTH_DEFAULTS,
    });
    // The manifest is real, reviewed data - not an empty placeholder - and provisioning is
    // still off because no handoff key or ingest URL is configured.
    expect(APPROVED_PROFILES.length).toBeGreaterThan(0);
    expect(configFromEnv(DB).deviceProvisioning.keys).toBeNull();
    expect(configFromEnv(DB).deviceProvisioning.ingestUrl).toBeNull();
  });

  it("reads the sign-in settings", () => {
    const config = configFromEnv({
      ...DB,
      AUTH_EMAIL_FROM: "Staging <codes@auth.staging.albusforge.ai>",
      INTERNAL_AUTH_AUDIENCE: "https://gateway-123.us-central1.run.app",
      SSR_SERVICE_ACCOUNT: "web@project.iam.gserviceaccount.com",
      TRUSTED_PROXY_HOPS: "2",
      AUTH_CODES_PER_EMAIL: "3",
      AUTH_CODES_PER_IP: "50",
      AUTH_VERIFIES_PER_IP: "60",
    });
    expect(config.auth).toEqual({
      ...AUTH_DEFAULTS,
      emailFrom: "Staging <codes@auth.staging.albusforge.ai>",
      internalAuth: { audience: "https://gateway-123.us-central1.run.app", serviceAccount: "web@project.iam.gserviceaccount.com" },
      trustedProxyHops: 2,
      codesPerEmail: 3,
      codesPerIp: 50,
      verifiesPerIp: 60,
    });
  });

  it("allows the log email adapter without a Resend key, and requires the key otherwise", () => {
    const withoutKey = Object.fromEntries(Object.entries(DB).filter(([name]) => name !== "RESEND_API_KEY"));
    expect(configFromEnv({ ...withoutKey, EMAIL_ADAPTER: "log" }).auth).toEqual({ ...AUTH_DEFAULTS, emailAdapter: "log", resendApiKey: null });
    expect(() => configFromEnv(withoutKey)).toThrow(/RESEND_API_KEY/);
    expect(() => configFromEnv({ ...withoutKey, RESEND_API_KEY: "" })).toThrow(/RESEND_API_KEY/);
  });

  it("requires SSR_SERVICE_ACCOUNT with INTERNAL_AUTH_AUDIENCE, but tolerates the account alone (today's Terraform)", () => {
    expect(() => configFromEnv({ ...DB, INTERNAL_AUTH_AUDIENCE: "https://gateway-123.us-central1.run.app" })).toThrow(/SSR_SERVICE_ACCOUNT/);
    expect(configFromEnv({ ...DB, SSR_SERVICE_ACCOUNT: "web@project.iam.gserviceaccount.com" }).auth.internalAuth).toBeNull();
  });

  it("refuses the log email adapter on Cloud Run", () => {
    expect(() => configFromEnv({ ...DB, EMAIL_ADAPTER: "log", K_SERVICE: "gateway" })).toThrow(/K_SERVICE/);
    expect(configFromEnv({ ...DB, EMAIL_ADAPTER: "log" }).auth.emailAdapter).toBe("log");
    expect(configFromEnv({ ...DB, K_SERVICE: "gateway" }).auth.emailAdapter).toBe("resend");
  });

  it("reads the intake URL, its auth mode, REGISTRY_INCLUDE_DRAFTS and ANON_BUILDS_PER_HOUR", () => {
    const config = configFromEnv({
      ...DB,
      INTAKE_URL: "https://intake-abc-uc.a.run.app",
      INTAKE_AUTH: "none",
      REGISTRY_INCLUDE_DRAFTS: "true",
      ANON_BUILDS_PER_HOUR: "250",
    });
    expect(config.intake).toEqual({ url: "https://intake-abc-uc.a.run.app", auth: "none" });
    expect(config.registryIncludeDrafts).toBe(true);
    expect(config.anonBuildsPerHour).toBe(250);
    expect(configFromEnv({ ...DB, SSE_MAX_STREAMS_PER_OWNER: "5", SSE_MAX_STREAMS: "400" }).sseStreamLimits).toEqual({ perOwner: 5, perInstance: 400 });
    expect(configFromEnv({ ...DB, INTAKE_URL: "" }).intake.url).toBeNull();
  });

  it.each([
    ["INTAKE_URL", "intake.internal"],
    ["INTAKE_AUTH", "basic"],
    ["REGISTRY_INCLUDE_DRAFTS", "yes"],
    ["ANON_BUILDS_PER_HOUR", "0"],
    ["ANON_BUILDS_PER_HOUR", "lots"],
    ["SSE_MAX_STREAMS_PER_OWNER", "0"],
    ["SSE_MAX_STREAMS", "many"],
    ["EMAIL_ADAPTER", "smtp"],
    ["INTERNAL_AUTH_AUDIENCE", "http://gateway.internal"],
    ["SSR_SERVICE_ACCOUNT", "web"],
    ["TRUSTED_PROXY_HOPS", "-1"],
    ["AUTH_CODES_PER_EMAIL", "0"],
  ])("rejects a bad %s", (name, value) => {
    expect(() => configFromEnv({ ...DB, [name]: value })).toThrow(new RegExp(name));
  });

  it("reads PORT and the timeouts", () => {
    const config = configFromEnv({ ...DB, PORT: "9090", DB_CONNECT_TIMEOUT_MS: "2000", DB_QUERY_TIMEOUT_MS: "3000", DB_IDLE_TIMEOUT_MS: "4000" });
    expect(config.port).toBe(9090);
    expect(config.dbTimeouts).toEqual({ connectMs: 2000, queryMs: 3000, readMs: 4000, idleMs: 4000 });
  });

  it.each([
    ["PORT", "http"],
    ["DB_CONNECT_TIMEOUT_MS", "0"],
    ["DB_QUERY_TIMEOUT_MS", "soon"],
  ])("rejects a bad %s", (name, value) => {
    expect(() => configFromEnv({ ...DB, [name]: value })).toThrow(new RegExp(name));
  });

  it("requires the database variables, without echoing the password", () => {
    const attempt = () => configFromEnv({ DB_PASSWORD: "s3cret-value" });
    expect(attempt).toThrow(/DB_HOST/);
    try {
      attempt();
    } catch (error) {
      expect(String(error)).not.toContain("s3cret-value");
    }
  });
});

it("keeps Ask credentials on a configured service origin and requires secure production transport", () => {
  expect(configFromEnv({ ...DB, ASK_URL: "http://localhost:8081", ASK_AUTH: "none" }).sensorAsk).toEqual({ url: "http://localhost:8081", auth: "none" });
  for (const ASK_URL of ["https://user:pass@ask.test", "https://ask.test/v1", "https://ask.test?key=value", "https://ask.test#token"]) {
    expect(() => configFromEnv({ ...DB, ASK_URL })).toThrow("ASK_URL must be a service origin");
  }
  expect(() => configFromEnv({ ...DB, K_SERVICE: "gateway", ASK_AUTH: "none" })).toThrow("ASK_AUTH=none");
  expect(() => configFromEnv({ ...DB, K_SERVICE: "gateway", ASK_URL: "http://ask.test" })).toThrow("HTTPS on Cloud Run");
});
