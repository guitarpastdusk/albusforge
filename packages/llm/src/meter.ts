import { builds, type Db, llmCalls } from "@albusforge/db";
import { eq } from "drizzle-orm";
import { costUsd, pricedModels, priceFor } from "./pricing";
import type { CallAttribution, LlmResponse, TraceContext } from "./types";

/** One metered model call, as written to `llm_calls` and the log. */
export interface LlmCallRecord {
  stage: string;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  stopReason: string | null;
  buildId: string | null;
  tenantId: string | null;
  anonOwnerHash: string | null;
  /** sha256 prefix of the cached prompt prefix (ASK-TO-ENCLOSURE §3); null when the caller didn't pass one. */
  prefixHash: string | null;
}

/** What the call knows about itself that the response doesn't carry. */
export interface CallContext {
  /** `llm_calls.stage` and the log line's `stage`. */
  stage: string;
  /** `prefixHash(route)`: tells a warm-cache miss from a changed prefix. */
  prefixHash?: string;
}

export interface Meter {
  /** Logs the call, then stores it. Rejects if storing fails; the log line is already out. */
  record(call: CallContext, response: LlmResponse, attribution: CallAttribution): Promise<LlmCallRecord>;
}

const TRACE_FIELD = "logging.googleapis.com/trace";

/**
 * The spend log line. Infra's log-based metric and alert read
 * `jsonPayload.event = "llm_call"` and `jsonPayload.cost_usd`: don't rename or
 * drop fields. Key order is fixed; new fields go at the end.
 */
export function formatLlmCallLine(record: LlmCallRecord, trace?: TraceContext, project?: string): string {
  const entry: Record<string, unknown> = {
    severity: "INFO",
    message: "llm call",
    event: "llm_call",
    stage: record.stage,
    model: record.model,
    cost_usd: record.costUsd,
    input_tokens: record.inputTokens,
    output_tokens: record.outputTokens,
    cache_read_input_tokens: record.cacheReadInputTokens,
    cache_creation_input_tokens: record.cacheCreationInputTokens,
    stop_reason: record.stopReason,
    build_id: record.buildId,
    // The cached prefix's identity: a warm miss (same hash, no read) is a leak
    // of something volatile into the prefix; a changed hash explains itself.
    prefix_hash: record.prefixHash,
  };
  if (trace && project) entry[TRACE_FIELD] = `projects/${project}/traces/${trace.traceId}`;
  return `${JSON.stringify(entry)}\n`;
}

export function toRecord(call: CallContext, response: LlmResponse, attribution: CallAttribution): LlmCallRecord {
  const { usage } = response;
  return {
    stage: call.stage,
    model: response.model,
    costUsd: costUsd(usage, response.model),
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    stopReason: response.stop_reason,
    buildId: attribution.buildId,
    tenantId: attribution.tenantId,
    anonOwnerHash: attribution.anonOwnerHash,
    prefixHash: call.prefixHash ?? null,
  };
}

export interface MeterOptions {
  insert: (record: LlmCallRecord) => Promise<void>;
  /** Defaults to stdout. */
  write?: (line: string) => void;
  /** Defaults to GOOGLE_CLOUD_PROJECT. */
  project?: string;
  /** Called for every model priced from the fallback rates because it isn't in the table, fallback iterations included. */
  onUnknownModel?: (model: string) => void;
}

export function createMeter({
  insert,
  write = (line) => void process.stdout.write(line),
  project = process.env.GOOGLE_CLOUD_PROJECT,
  onUnknownModel,
}: MeterOptions): Meter {
  return {
    async record(call, response, attribution) {
      const record = toRecord(call, response, attribution);
      for (const model of pricedModels(response.usage, response.model)) {
        if (!priceFor(model).known) onUnknownModel?.(model);
      }
      write(formatLlmCallLine(record, attribution.trace, project));
      await insert(record);
      return record;
    },
  };
}

/**
 * Inserts into `builds.llm_calls`, resolving the owner at insert time.
 *
 * Attribution is captured when the turn starts, but the build can be claimed
 * at sign-up while the model call is in flight (ADR 0009): the claim
 * transaction re-attributes the rows that exist then, so a row inserted after
 * it with the pre-call attribution would stay anonymous forever. Re-reading
 * the build isn't enough — the claim can commit between the read and the
 * insert. Taking the build row's lock first, as the claim's `UPDATE builds`
 * does, serializes the two: whichever runs second sees the other's work.
 *
 * Pass a `Db` bound to the caller's own connection; this takes no other one.
 */
export function llmCallsInserter(db: Db): (record: LlmCallRecord) => Promise<void> {
  return async (record) => {
    await db.transaction(async (tx) => {
      let { tenantId, anonOwnerHash } = record;
      if (record.buildId !== null) {
        const [owner] = await tx
          .select({ tenantId: builds.tenantId, anonOwnerHash: builds.anonOwnerHash })
          .from(builds)
          .where(eq(builds.id, record.buildId))
          .for("update");
        if (owner) {
          tenantId = owner.tenantId;
          anonOwnerHash = owner.anonOwnerHash;
        }
      }
      await tx.insert(llmCalls).values({
        buildId: record.buildId,
        tenantId,
        anonOwnerHash,
        stage: record.stage,
        model: record.model,
        inputTokens: record.inputTokens,
        outputTokens: record.outputTokens,
        cacheReadInputTokens: record.cacheReadInputTokens,
        cacheCreationInputTokens: record.cacheCreationInputTokens,
        costUsd: record.costUsd.toFixed(6),
        stopReason: record.stopReason,
      });
    });
  };
}
