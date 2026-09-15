import { cameraApprovalsFromEnv } from "@albusforge/codegen/accepted-candidate";
import { GoogleAuth } from "google-auth-library";
import { gcsArtifacts, localArtifacts } from "@albusforge/codegen/artifacts";
import type { FirmwareOptions } from "./firmware-routes";
export function firmwareOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>>,
): FirmwareOptions {
  const bucket = env.FIRMWARE_ARTIFACT_BUCKET,
    directory = env.FIRMWARE_ARTIFACT_DIR;
  if (bucket && directory)
    throw new Error("Configure exactly one firmware artifact store");
  if (env.K_SERVICE && directory)
    throw new Error(
      "Cloud firmware artifacts require immutable bucket storage",
    );
  const artifacts = bucket
    ? gcsArtifacts(bucket)
    : directory
      ? localArtifacts(directory)
      : undefined;
  const mode = env.FIRMWARE_DISPATCH_MODE ?? "direct";
  if (mode !== "direct" && mode !== "scheduler") throw new Error("Invalid firmware dispatch mode");
  const resource = env.FIRMWARE_JOB_RESOURCE;
  if (
    resource &&
    !/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/jobs\/[a-z0-9-]+$/.test(
      resource,
    )
  )
    throw new Error("Invalid firmware job resource");
  const enabled =
    !!artifacts &&
    (!!resource || (!env.K_SERVICE && env.FIRMWARE_JOBS_ENABLED === "1"));
  const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  return {
    artifacts,
    enabled,
    cameraApprovals: cameraApprovalsFromEnv(env),
    ...(resource && mode === "direct"
      ? {
          dispatch: async () => {
            const token = await auth.getAccessToken();
            if (!token)
              throw new Error("Firmware dispatcher identity unavailable");
            const response = await fetch(
              `https://run.googleapis.com/v2/${resource}:run`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                body: "{}",
                signal: AbortSignal.timeout(10000),
                redirect: "error",
              },
            );
            if (!response.ok) throw new Error("Firmware job dispatch failed");
          },
        }
      : {}),
  };
}
