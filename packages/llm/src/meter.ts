import { type Db, llmCalls } from "@albusforge/db";
import { costUsd, priceFor } from "./pricing";
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
}

export interface Meter {
  /** Logs the call, then stores it. Rejects if storing fails; the log line is already out. */
  record(stage: string, response: LlmResponse, attribution: CallAttribution): Promise<LlmCallRecord>;
}

const TRACE_FIELD = "logging.googleapis.com/trace";

/**
 * The spend log line. Infra's log-based metric and alert read
 * `jsonPayload.event = "llm_call"` and `jsonPayload.cost_usd`: don't rename or
 * drop fields. Key order is fixed.
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
  };
  if (trace && project) entry[TRACE_FIELD] = `projects/${project}/traces/${trace.traceId}`;
  return `${JSON.stringify(entry)}\n`;
}

export function toRecord(stage: string, response: LlmResponse, attribution: CallAttribution): LlmCallRecord {
  const { usage } = response;
  return {
    stage,
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
  };
}

export interface MeterOptions {
  insert: (record: LlmCallRecord) => Promise<void>;
  /** Defaults to stdout. */
  write?: (line: string) => void;
  /** Defaults to GOOGLE_CLOUD_PROJECT. */
  project?: string;
  /** Called once per call priced from the fallback row because the model isn't in the table. */
  onUnknownModel?: (model: string) => void;
}

export function createMeter({
  insert,
  write = (line) => void process.stdout.write(line),
  project = process.env.GOOGLE_CLOUD_PROJECT,
  onUnknownModel,
}: MeterOptions): Meter {
  return {
    async record(stage, response, attribution) {
      const record = toRecord(stage, response, attribution);
      if (!priceFor(response.model).known) onUnknownModel?.(response.model);
      write(formatLlmCallLine(record, attribution.trace, project));
      await insert(record);
      return record;
    },
  };
}

/** Inserts into `builds.llm_calls`. */
export function llmCallsInserter(db: Db): (record: LlmCallRecord) => Promise<void> {
  return async (record) => {
    await db.insert(llmCalls).values({
      buildId: record.buildId,
      tenantId: record.tenantId,
      anonOwnerHash: record.anonOwnerHash,
      stage: record.stage,
      model: record.model,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cacheReadInputTokens: record.cacheReadInputTokens,
      cacheCreationInputTokens: record.cacheCreationInputTokens,
      costUsd: record.costUsd.toFixed(6),
      stopReason: record.stopReason,
    });
  };
}
