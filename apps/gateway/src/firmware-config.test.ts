import { expect, it } from "vitest";
import { firmwareOptionsFromEnv } from "./firmware-config";
it("keeps compilation disabled until explicit durable deployment configuration exists", () => {
  expect(firmwareOptionsFromEnv({}).enabled).toBe(false);
  expect(
    firmwareOptionsFromEnv({
      K_SERVICE: "gateway",
      FIRMWARE_ARTIFACT_BUCKET: "artifacts",
      FIRMWARE_JOBS_ENABLED: "1",
    }).enabled,
  ).toBe(false);
  expect(() =>
    firmwareOptionsFromEnv({
      K_SERVICE: "gateway",
      FIRMWARE_ARTIFACT_DIR: "/tmp/artifacts",
    }),
  ).toThrow();
  expect(() =>
    firmwareOptionsFromEnv({
      FIRMWARE_ARTIFACT_BUCKET: "artifacts",
      FIRMWARE_ARTIFACT_DIR: "/tmp/artifacts",
    }),
  ).toThrow();
  expect(() =>
    firmwareOptionsFromEnv({
      FIRMWARE_JOB_RESOURCE: "https://untrusted.example/run",
    }),
  ).toThrow();
  const configured = firmwareOptionsFromEnv({
    K_SERVICE: "gateway",
    FIRMWARE_ARTIFACT_BUCKET: "artifacts",
    FIRMWARE_JOB_RESOURCE:
      "projects/example/locations/us-central1/jobs/fwbuild",
  });
  expect(configured.enabled).toBe(true);
  expect(configured.dispatch).toBeTypeOf("function");
});
