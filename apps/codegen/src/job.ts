import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createDb, dbConfigFromEnv } from "@albusforge/db";
import { FirmwareJobRequest, FirmwarePassedRecord, serializeFirmwareManifest } from "@albusforge/schema";
import type { Pool, PoolClient } from "pg";
import { compile, compileCameraCandidate, sha256, type Compiled, type CompileInput } from "./compiler";
import { COMPILER_IMAGE } from "./candidate";
import { cameraApprovalsFromEnv, candidateManifestMatches, renderCandidate, type CameraPlanApproval } from "./accepted-candidate";
import { decodePlan } from "./plan";
import { gcsArtifacts, localArtifacts, type ArtifactStore } from "./artifacts";

export type FirmwareOutcome = "passed" | "failed" | "idle" | "busy";
export interface JobOptions {
  pool: Pool;
  artifacts: ArtifactStore;
  compile: (input: CompileInput, signal?: AbortSignal) => Promise<Compiled>;
  compileCamera?: (input: CompileInput, signal?: AbortSignal) => Promise<Compiled>;
  cameraApprovals?: readonly CameraPlanApproval[];
  observe?: (outcome: FirmwareOutcome) => void;
}
function observed(options: JobOptions, outcome: FirmwareOutcome) {
  try { options.observe?.(outcome); } catch { /* Diagnostics cannot change durable result. */ }
}
/** Session lock bounds active compilation across scheduler/recovery executions.
 * The second pool connection handles ordinary work SQL. Losing this dedicated
 * connection cancels the compiler and fences publication before releasing it. */
export async function runOne(options: JobOptions): Promise<boolean> {
  const client = await options.pool.connect();
  const ownership = new AbortController();
  let released = false;
  const lost = () => {
    ownership.abort(new Error("Compile lease ownership lost"));
    if (!released) { released = true; client.release(true); }
  };
  client.on("error", lost); client.on("end", lost);
  let locked = false, discard = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(284713,1) AS locked")).rows[0]?.locked === true;
    if (!locked) { observed(options, "busy"); return false; }
    ownership.signal.throwIfAborted();
    return await runClaimed(options, ownership.signal, client, lost);
  } catch (error) { discard = true; throw error; } finally {
    if (!released && locked && !ownership.signal.aborted) {
      try { await client.query("SELECT pg_advisory_unlock(284713,1)"); } catch { discard = true; }
    }
    const broken = discard || ownership.signal.aborted;
    if (!released) { released = true; client.release(broken); }
    if (!broken) { client.removeListener("error", lost); client.removeListener("end", lost); }
  }
}
/** Row leases still fence retries and stale publications independently. */
async function runClaimed(options: JobOptions, signal: AbortSignal, publicationClient: PoolClient, lost: () => void): Promise<boolean> {
  const lease = randomUUID();
  signal.throwIfAborted();
  await options.pool
    .query(`UPDATE builds.code_bundles SET status='failed',compile_log=compile_log||'{"error":"Worker lease expired after three attempts"}'::jsonb,updated_at=now()
 WHERE status='running' AND updated_at<now()-interval '15 minutes' AND (compile_log->'job'->>'attempts')::int>=3`);
  signal.throwIfAborted();
  const result = await options.pool.query(
    `WITH next AS (
 SELECT build_id,version FROM builds.code_bundles WHERE (status='pending' OR (status='running' AND updated_at<now()-interval '15 minutes'))
 AND (compile_log->'job'->>'attempts')::int<3 ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
 ), claimed AS (
 UPDATE builds.code_bundles c SET status='running',updated_at=now(),compile_log=jsonb_build_object('job',jsonb_set(c.compile_log->'job','{attempts}',to_jsonb((c.compile_log->'job'->>'attempts')::int+1)),'lease',$1::text)
 FROM next n WHERE c.build_id=n.build_id AND c.version=n.version RETURNING c.*)
 SELECT c.*,p.metadata,p.part_versions,p.wiring_graph,p.power_budget,p.bom,p.solver_log,p.accepted_at,p.spec_version,s.data AS spec_data,
 b.tenant_id,(SELECT max(version) FROM builds.specs WHERE build_id=c.build_id) AS latest_spec
 FROM claimed c JOIN builds.plans p ON p.build_id=c.build_id AND p.version=c.plan_version JOIN builds.specs s ON s.build_id=p.build_id AND s.version=p.spec_version JOIN builds.builds b ON b.id=c.build_id`,
    [lease],
  );
  signal.throwIfAborted();
  const row = result.rows[0];
  if (!row) { observed(options, "idle"); return false; }
  try {
    const job = FirmwareJobRequest.parse(row.compile_log.job);
    if (
      !row.tenant_id ||
      !row.accepted_at ||
      row.spec_version !== row.latest_spec
    )
      throw new Error("Accepted plan is no longer current");
    const candidate = decodePlan(row, options.cameraApprovals);
    if (job.interval_s < candidate.interval_s)
      throw new Error("Edit violates accepted power interval");
    renderCandidate(candidate.candidate, job.interval_s);
    const compiler = candidate.candidate.kind === "camera" ? options.compileCamera : options.compile;
    if (!compiler) throw new Error("This accepted plan has no configured camera compiler");
    signal.throwIfAborted();
    const compiled = await compiler({
      build_id: row.build_id,
      plan_version: row.plan_version,
      code_version: row.version,
      interval_s: job.interval_s,
      numeric: candidate.candidate.numeric,
    }, signal);
    signal.throwIfAborted();
    if (
      compiled.manifest.build_id !== row.build_id ||
      compiled.manifest.plan_version !== row.plan_version ||
      compiled.manifest.code_version !== row.version ||
      !candidateManifestMatches(candidate.candidate, compiled.manifest) ||
      compiled.manifestBytes !== serializeFirmwareManifest(compiled.manifest) ||
      compiled.manifest_digest !== sha256(compiled.manifestBytes) ||
      compiled.source !== renderCandidate(candidate.candidate, job.interval_s) ||
      compiled.source_sha256 !== sha256(compiled.source) ||
      compiled.files.size !== 3 || compiled.manifest.files.some(file => {
        const bytes = compiled.files.get(file.path);
        return !bytes || bytes.length !== file.size || sha256(bytes) !== file.sha256;
      })
    )
      throw new Error("Compile manifest identity mismatch");
    const prefix = `builds/${row.build_id}/code/${row.version}/${lease}`;
    for (const [name, bytes] of compiled.files) {
      signal.throwIfAborted();
      await options.artifacts.put(`${prefix}/${name}`, bytes);
    }
    signal.throwIfAborted();
    await options.artifacts.put(
      `${prefix}/manifest.json`,
      Buffer.from(compiled.manifestBytes),
    );
    signal.throwIfAborted();
    await options.artifacts.put(
      `${prefix}/app.cpp`,
      Buffer.from(compiled.source),
    );
    signal.throwIfAborted();
    await options.artifacts.put(`${prefix}/firmware.zip`, compiled.bundle);
    signal.throwIfAborted();
    const passed = FirmwarePassedRecord.parse({
      schema_version: 1,
      job,
      candidate_id: candidate.candidate.id,
      manifest: compiled.manifest,
      manifest_digest: compiled.manifest_digest,
      compiler: { image_digest: COMPILER_IMAGE, idf_version: "5.5.3" },
      source_sha256: compiled.source_sha256,
      bundle_sha256: sha256(compiled.bundle),
      instruction: job.instruction,
      diagnostics: compiled.diagnostics,
    });
    // Publish only our lease and a still-current accepted plan. Older artifact versions remain immutable.
    const client = publicationClient;
    try {
      signal.throwIfAborted();
      await client.query("BEGIN");
      await client.query(
        "SELECT id FROM builds.builds WHERE id=$1 FOR UPDATE",
        [row.build_id],
      );
      const current = await client.query(
        "SELECT p.*,s.data AS spec_data FROM builds.plans p JOIN builds.specs s ON s.build_id=p.build_id AND s.version=p.spec_version WHERE p.build_id=$1 AND p.version=$2 AND p.accepted_at IS NOT NULL AND p.spec_version=(SELECT max(version) FROM builds.specs WHERE build_id=$1)",
        [row.build_id, row.plan_version],
      );
      if (!current.rowCount)
        throw new Error("Accepted plan is no longer current");
      const fresh = decodePlan(current.rows[0], options.cameraApprovals);
      if (fresh.metadata.input_digest !== candidate.metadata.input_digest || !candidateManifestMatches(fresh.candidate, compiled.manifest))
        throw new Error("Accepted plan compiler approval changed before publication");
      renderCandidate(fresh.candidate, job.interval_s);
      signal.throwIfAborted();
      const published = await client.query(
        `UPDATE builds.code_bundles SET status='passed',storage_ref=$4,compile_log=$5,updated_at=now()
    WHERE build_id=$1 AND version=$2 AND status='running' AND compile_log->>'lease'=$3`,
        [row.build_id, row.version, lease, prefix, passed],
      );
      signal.throwIfAborted();
      if (!published.rowCount)
        throw new Error("Compile lease changed before publication");
      await client.query("COMMIT");
    } catch (error) {
      // Destroy the dedicated connection rather than queueing rollback behind
      // an uncertain query. Its session lock and uncommitted transaction end
      // together; no different connection can publish after lock loss.
      lost();
      throw error;
    }
    observed(options, "passed");
  } catch (error) {
    observed(options, "failed");
    // No credentials/SQL/stack traces are retained; deterministic compile diagnostics are separately bounded.
    const diagnostics =
      error instanceof Error && error.message.startsWith("Compile failed:")
        ? error.message.slice(-20000)
        : null;
    const message =
      error instanceof Error &&
      /^(Accepted plan|This accepted plan|Edit violates|Compile deadline|Compile lease)/.test(
        error.message,
      )
        ? error.message
        : "Firmware compilation failed; inspect the bounded compiler diagnostics and retry";
    await options.pool.query(
      `UPDATE builds.code_bundles SET status='failed',compile_log=compile_log||jsonb_build_object('error',$4::text,'diagnostics',$5::text),updated_at=now() WHERE build_id=$1 AND version=$2 AND status='running' AND compile_log->>'lease'=$3`,
      [row.build_id, row.version, lease, message, diagnostics],
    );
  }
  return true;
}

export function workerConfiguration(env: NodeJS.ProcessEnv) {
  const bucket = env.FIRMWARE_ARTIFACT_BUCKET;
  const directory = env.FIRMWARE_ARTIFACT_DIR;
  if ((env.CLOUD_RUN_JOB || env.K_SERVICE) && (!bucket || directory))
    throw new Error("Cloud worker requires durable bucket storage");
  if ((!bucket && !directory) || (bucket && directory))
    throw new Error("Configure exactly one artifact store");
  const mode = env.FIRMWARE_COMPILER_MODE ?? "docker";
  if (mode !== "idf" && mode !== "docker")
    throw new Error("Invalid compiler mode");
  return { bucket, directory, mode, cameraApprovals: cameraApprovalsFromEnv(env) } as const;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const configuration = workerConfiguration(process.env);
  const db = createDb(dbConfigFromEnv(), {
    max: 2,
    statementTimeoutMs: 3000,
    queryTimeoutMs: 5000,
    connectTimeoutMs: 3000,
  });
  const artifacts = configuration.bucket
    ? gcsArtifacts(configuration.bucket)
    : localArtifacts(configuration.directory!);
  try {
    await runOne({
      pool: db.pool,
      artifacts,
      observe: (outcome) => console.log(JSON.stringify({ event: "firmware_build", severity: outcome === "failed" ? "WARNING" : "INFO", outcome })),
      cameraApprovals: configuration.cameraApprovals,
      compileCamera: (input, signal) => compileCameraCandidate(input, process.env.FIRMWARE_CAMERA_TEMPLATE_DIR ?? "firmware/esp32s3-camera", configuration.mode, signal),
      compile: (input, signal) =>
        compile(
          input,
          process.env.FIRMWARE_TEMPLATE_DIR ?? "firmware/esp32s3",
          configuration.mode,
          signal,
        ),
    });
  } catch {
    console.error("Firmware worker failed");
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
}
