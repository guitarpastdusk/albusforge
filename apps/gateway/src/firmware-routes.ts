import { createHash } from "node:crypto";
import {
  FirmwareJobRequest,
  FirmwarePage,
  FirmwarePassedRecord,
  FirmwareRequest,
  FirmwareRetryRequest,
} from "@albusforge/schema";
import { decodePlan } from "@albusforge/codegen/plan";
import { editCandidate, renderCandidate, candidateManifestMatches, type CameraPlanApproval } from "@albusforge/codegen/accepted-candidate";
import type { ArtifactStore } from "@albusforge/codegen/artifacts";
import type { FastifyInstance } from "fastify";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { withAuthorizedRead } from "./authorized-read";
import { withAuthorizedWrite } from "./authorized-write";
import { assertSameOrigin } from "./mutation-origin";
import { HttpError, parse } from "./http";
const params = z.strictObject({ id: z.uuid() });
const versionParams = params.extend({
  version: z.coerce.number().int().positive().max(2147483647),
});
const fileParams = versionParams.extend({
  file: z.enum([
    "manifest.json",
    "bootloader.bin",
    "partition-table.bin",
    "albusforge.bin",
    "app.cpp",
    "firmware.zip",
  ]),
});
export interface FirmwareOptions {
  artifacts?: ArtifactStore;
  enabled: boolean;
  cameraApprovals?: readonly CameraPlanApproval[];
  dispatch?: () => Promise<void>;
}
async function owned(
  client: PoolClient,
  id: string,
  tenant: string,
  lock = false,
) {
  const row = await client.query(
    `SELECT id FROM builds.builds WHERE id=$1 AND tenant_id=$2${lock ? " FOR UPDATE" : ""}`,
    [id, tenant],
  );
  if (!row.rowCount) throw new HttpError(404, "NOT_FOUND", "Build not found");
}
async function accepted(client: PoolClient, id: string, version: number, approvals: readonly CameraPlanApproval[] = []) {
  const row = (
    await client.query(
      `SELECT p.*,s.data AS spec_data FROM builds.plans p JOIN builds.specs s ON s.build_id=p.build_id AND s.version=p.spec_version
 WHERE p.build_id=$1 AND p.version=$2 AND p.accepted_at IS NOT NULL AND p.spec_version=(SELECT max(version) FROM builds.specs WHERE build_id=$1)`,
      [id, version],
    )
  ).rows[0];
  if (!row)
    throw new HttpError(
      409,
      "PLAN_CHANGED",
      "Accept the current plan before compiling firmware",
    );
  try {
    return decodePlan(row, approvals);
  } catch {
    throw new HttpError(
      422,
      "UNSUPPORTED_FIRMWARE",
      "This accepted plan does not have a supported firmware profile",
    );
  }
}
export function registerFirmwareRoutes(
  app: FastifyInstance,
  pool: Pool,
  options: FirmwareOptions,
) {
  app.register(async (scope) => {
    scope.addHook("onRequest", async (_request, reply) => {
      reply.header("cache-control", "private, no-store");
    });
    scope.get("/v1/builds/:id/code", async (request) => {
      const { id } = parse(params, request.params, "build id");
      parse(z.strictObject({}), request.query, "query");
      return withAuthorizedRead(
        pool,
        request.headers.cookie,
        request.hostname,
        async (client, identity) => {
          await owned(client, id, identity.tenantId);
          const current =
            (
              await client.query(
                "SELECT version FROM builds.plans WHERE build_id=$1 AND accepted_at IS NOT NULL AND spec_version=(SELECT max(version) FROM builds.specs WHERE build_id=$1)",
                [id],
              )
            ).rows[0]?.version ?? null;
          let available = options.enabled && !!options.artifacts;
          if (current)
            try {
              await accepted(client, id, current, options.cameraApprovals);
            } catch {
              available = false;
            }
          const rows = (
            await client.query(
              "SELECT * FROM builds.code_bundles WHERE build_id=$1 ORDER BY version DESC LIMIT 20",
              [id],
            )
          ).rows;
          const sourcePlans = new Map<number, ReturnType<typeof decodePlan>>();
          if (rows.length) for (const row of (await client.query(
            "SELECT p.*,s.data AS spec_data FROM builds.plans p JOIN builds.specs s ON s.build_id=p.build_id AND s.version=p.spec_version WHERE p.build_id=$1 AND p.version=ANY($2::int[])",
            [id, [...new Set(rows.map(row => row.plan_version))]],
          )).rows) {
            try { sourcePlans.set(row.version, decodePlan(row, options.cameraApprovals)); } catch { /* Unapproved profiles have no renderable source. */ }
          }
          const sourceFor = (version: number, interval: number) => {
            const plan = sourcePlans.get(version);
            try { return plan ? renderCandidate(plan.candidate, interval) : null; } catch { return null; }
          };
          return FirmwarePage.parse({
            build_id: id,
            tenant_id: identity.tenantId,
            can_edit: ["admin", "operator"].includes(identity.role),
            compiler_available: available,
            accepted_plan_version: current,
            versions: rows.map((row) => {
              const job = FirmwareJobRequest.safeParse(row.compile_log?.job);
              const passed =
                row.status === "passed"
                  ? FirmwarePassedRecord.safeParse(row.compile_log)
                  : null;
              if (passed && !passed.success)
                throw new HttpError(
                  503,
                  "ARTIFACT_UNAVAILABLE",
                  "Stored firmware metadata is unavailable",
                );
              const candidate = sourcePlans.get(row.plan_version)?.candidate;
              if (passed?.success && (passed.data.candidate_id !== passed.data.manifest.profile_id || (candidate && !candidateManifestMatches(candidate, passed.data.manifest))))
                throw new HttpError(503, "ARTIFACT_UNAVAILABLE", "Stored firmware candidate identity is unavailable");
              const prior =
                job.success && job.data.based_on
                  ? rows.find((other) => other.version === job.data.based_on)
                  : null;
              const priorJob = FirmwareJobRequest.safeParse(
                prior?.compile_log?.job,
              );
              return {
                version: row.version,
                plan_version: row.plan_version,
                status: row.status,
                current: row.plan_version === current,
                interval_s: job.success ? job.data.interval_s : null,
                attempts: job.success ? job.data.attempts : 0,
                source: job.success ? sourceFor(row.plan_version, job.data.interval_s) : null,
                previous_source: priorJob.success
                  ? sourceFor(prior.plan_version, priorJob.data.interval_s)
                  : null,
                error:
                  typeof row.compile_log?.error === "string"
                    ? row.compile_log.error.slice(0, 1000)
                    : null,
                diagnostics:
                  typeof row.compile_log?.diagnostics === "string"
                    ? row.compile_log.diagnostics.slice(-20000)
                    : null,
                manifest: passed?.success ? passed.data.manifest : null,
                created_at: row.created_at.toISOString(),
              };
            }),
          });
        },
      );
    });
    scope.post("/v1/builds/:id/code", async (request, reply) => {
      assertSameOrigin(request);
      const { id } = parse(params, request.params, "build id");
      parse(z.strictObject({}), request.query, "query");
      const body = parse(FirmwareRequest, request.body, "request body");
      const version = await withAuthorizedWrite(
        pool,
        request.headers.cookie,
        request.hostname,
        body.tenant_id,
        async (client, identity) => {
          await owned(client, id, identity.tenantId, true);
          await identity.recheckExpiry();
          if (!options.enabled || !options.artifacts)
            throw new HttpError(
              503,
              "COMPILER_UNAVAILABLE",
              "Firmware compilation is not configured",
            );

          const plan = await accepted(client, id, body.plan_version, options.cameraApprovals);
          const previous = (
            await client.query(
              "SELECT * FROM builds.code_bundles WHERE build_id=$1 ORDER BY version DESC",
              [id],
            )
          ).rows;
          const duplicate = previous.find(
            (row) => row.compile_log?.job?.request_id === body.request_id,
          );
          if (duplicate) {
            if (
              duplicate.plan_version !== body.plan_version ||
              duplicate.compile_log.job.instruction !==
                (body.instruction ?? "") ||
              duplicate.compile_log.job.based_on !== (body.based_on ?? null)
            )
              throw new HttpError(
                409,
                "REQUEST_CONFLICT",
                "Compile request changed",
              );
            return duplicate.version;
          }
          if (
            previous.some((row) => ["pending", "running"].includes(row.status))
          )
            throw new HttpError(
              409,
              "COMPILE_PENDING",
              "A firmware compile is already pending",
            );
          if (previous.length >= 100)
            throw new HttpError(
              409,
              "VERSION_LIMIT",
              "Firmware version limit reached",
            );
          if (
            (body.instruction !== undefined) !==
            (body.based_on !== undefined)
          )
            throw new HttpError(
              400,
              "INVALID_EDIT",
              "An edit needs its source version",
            );
          if (
            body.based_on &&
            !previous.some(
              (row) =>
                row.version === body.based_on &&
                row.plan_version === body.plan_version &&
                row.status === "passed",
            )
          )
            throw new HttpError(
              409,
              "SOURCE_CHANGED",
              "Choose a compiled version of the current plan",
            );
          let interval = plan.interval_s;
          if (body.instruction)
            try {
              interval = editCandidate(plan.candidate, body.instruction);
            } catch {
              throw new HttpError(
                400,
                "UNSUPPORTED_EDIT",
                plan.candidate.kind === "camera" ? "Camera capture interval must remain 900 seconds" : "Use: Set interval to N seconds (10–86400 seconds)",
              );
            }
          if (interval < plan.interval_s)
            throw new HttpError(
              422,
              "POWER_INTERVAL",
              "A shorter interval needs a newly accepted plan",
            );
          const version = (previous[0]?.version ?? 0) + 1;
          const job = FirmwareJobRequest.parse({
            request_id: body.request_id,
            interval_s: interval,
            instruction: body.instruction ?? "",
            based_on: body.based_on ?? null,
            attempts: 0,
          });
          await client.query(
            "INSERT INTO builds.code_bundles(build_id,version,plan_version,status,compile_log) VALUES($1,$2,$3,'pending',$4)",
            [id, version, body.plan_version, { job }],
          );
          return version;
        },
      );
      void options.dispatch?.().catch(() => undefined);
      return reply.code(202).send({ version });
    });
    scope.post("/v1/builds/:id/code/:version/retry", async (request, reply) => {
      assertSameOrigin(request);
      const { id, version } = parse(versionParams, request.params, "version");
      parse(z.strictObject({}), request.query, "query");
      const body = parse(FirmwareRetryRequest, request.body, "request body");
      await withAuthorizedWrite(
        pool,
        request.headers.cookie,
        request.hostname,
        body.tenant_id,
        async (client, identity) => {
          await owned(client, id, identity.tenantId, true);
          await identity.recheckExpiry();
          if (!options.enabled || !options.artifacts)
            throw new HttpError(
              503,
              "COMPILER_UNAVAILABLE",
              "Firmware compilation is not configured",
            );

          const row = (
            await client.query(
              "SELECT * FROM builds.code_bundles WHERE build_id=$1 AND version=$2 FOR UPDATE",
              [id, version],
            )
          ).rows[0];
          if (!row)
            throw new HttpError(404, "NOT_FOUND", "Firmware version not found");
          await accepted(client, id, row.plan_version, options.cameraApprovals);
          const job = FirmwareJobRequest.safeParse(row.compile_log?.job);
          if (row.status !== "failed" || !job.success || job.data.attempts >= 3)
            throw new HttpError(
              409,
              "RETRY_UNAVAILABLE",
              "This firmware version cannot be retried",
            );
          if (
            (
              await client.query(
                "SELECT 1 FROM builds.code_bundles WHERE build_id=$1 AND status IN ('pending','running')",
                [id],
              )
            ).rowCount
          )
            throw new HttpError(
              409,
              "COMPILE_PENDING",
              "A firmware compile is already pending",
            );
          await client.query(
            "UPDATE builds.code_bundles SET status='pending',compile_log=$3,updated_at=now() WHERE build_id=$1 AND version=$2",
            [id, version, { job: job.data }],
          );
        },
      );
      void options.dispatch?.().catch(() => undefined);
      return reply.code(202).send({ version });
    });
    scope.get(
      "/v1/builds/:id/code/:version/files/:file",
      async (request, reply) => {
        const { id, version, file } = parse(
          fileParams,
          request.params,
          "artifact file",
        );
        parse(z.strictObject({}), request.query, "query");
        const artifact = await withAuthorizedRead(
          pool,
          request.headers.cookie,
          request.hostname,
          async (client, identity) => {
            await owned(client, id, identity.tenantId);
            const row = (
              await client.query(
                "SELECT * FROM builds.code_bundles WHERE build_id=$1 AND version=$2",
                [id, version],
              )
            ).rows[0];
            if (!row || row.status !== "passed" || !row.storage_ref)
              throw new HttpError(
                404,
                "NOT_FOUND",
                "Compiled artifact not found",
              );
            const record = FirmwarePassedRecord.safeParse(row.compile_log);
            if (!record.success)
              throw new HttpError(
                503,
                "ARTIFACT_UNAVAILABLE",
                "Stored firmware metadata is unavailable",
              );
            const digest =
              file === "manifest.json"
                ? record.data.manifest_digest
                : file === "app.cpp"
                  ? record.data.source_sha256
                  : file === "firmware.zip"
                    ? record.data.bundle_sha256
                    : record.data.manifest.files.find(
                        (entry) => entry.path === file,
                      )?.sha256;
            if (!digest)
              throw new HttpError(
                503,
                "ARTIFACT_UNAVAILABLE",
                "Artifact integrity metadata is unavailable",
              );
            return { key: `${row.storage_ref}/${file}`, digest };
          },
        );
        if (!options.artifacts)
          throw new HttpError(
            503,
            "ARTIFACT_UNAVAILABLE",
            "Artifact storage is not configured",
          );
        const bytes = await options.artifacts.get(artifact.key);
        if (
          createHash("sha256").update(bytes).digest("hex") !== artifact.digest
        )
          throw new HttpError(
            503,
            "ARTIFACT_UNAVAILABLE",
            "Artifact integrity verification failed",
          );
        return reply
          .header("Content-Disposition", `attachment; filename="${file}"`)
          .type(
            file.endsWith(".json")
              ? "application/json"
              : file.endsWith(".zip")
                ? "application/zip"
                : "application/octet-stream",
          )
          .send(bytes);
      },
    );
  });
}
