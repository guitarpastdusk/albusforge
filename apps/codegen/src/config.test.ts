import { expect, it } from "vitest";
import { workerConfiguration } from "./job";
it("requires durable storage on Cloud Run and explicit local storage", () => {
  for (const env of [
    {},
    { CLOUD_RUN_JOB: "fwbuild", FIRMWARE_ARTIFACT_DIR: "/tmp/artifacts" },
    { CLOUD_RUN_JOB: "fwbuild" },
    { FIRMWARE_ARTIFACT_DIR: "/tmp/a", FIRMWARE_ARTIFACT_BUCKET: "bucket" },
    { FIRMWARE_ARTIFACT_DIR: "/tmp/a", FIRMWARE_COMPILER_MODE: "unknown" },
  ])
    expect(() => workerConfiguration(env)).toThrow();
  expect(
    workerConfiguration({
      CLOUD_RUN_JOB: "fwbuild",
      FIRMWARE_ARTIFACT_BUCKET: "bucket",
      FIRMWARE_COMPILER_MODE: "idf",
    }).mode,
  ).toBe("idf");
  expect(workerConfiguration({ FIRMWARE_ARTIFACT_DIR: "/tmp/a" }).mode).toBe(
    "docker",
  );
});
