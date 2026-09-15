/*
 * Calling intake: `POST {INTAKE_URL}/v1/turns { build_id }`. Intake writes the
 * assistant message, spec versions, build status and llm_calls itself and is
 * idempotent, so gateway only has to ask, in the background, after answering
 * the client.
 */
import { GoogleAuth, type IdTokenClient } from "google-auth-library";
import { z } from "zod";
import type { Log, TraceContext } from "./log";

export const TurnResult = z.union([
  z.object({ noop: z.literal(true) }),
  z.looseObject({ message_id: z.string(), spec_version: z.number().int().nullable(), status: z.string() }),
]);
export type TurnResult = z.infer<typeof TurnResult>;

export interface IntakeClient {
  /**
   * `mayRetry` tells intake this isn't our last word: a transient failure can
   * come back as a 503 with nothing written, and the retry below answers the
   * message properly. False on the last attempt, so the person always ends up
   * with exactly one reply.
   */
  turn(buildId: string, signal: AbortSignal, mayRetry?: boolean): Promise<TurnResult>;
}

export class IntakeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "IntakeError";
  }
}

/** Resolves the Authorization header value for a call, or undefined for none. */
export type AuthHeader = () => Promise<string | undefined>;

/**
 * A Google ID token for audience = the intake URL, from the metadata server.
 * IdTokenClient caches the token and refreshes it shortly before it expires,
 * so this costs one metadata call per token lifetime.
 */
export function googleIdTokenAuth(audience: string, auth: Pick<GoogleAuth, "getIdTokenClient"> = new GoogleAuth()): AuthHeader {
  let client: Promise<IdTokenClient> | undefined;
  return async () => {
    client ??= auth.getIdTokenClient(audience).catch((error: unknown) => {
      client = undefined; // retry on the next call
      throw error;
    });
    const headers = await (await client).getRequestHeaders();
    const value = headers.get("authorization");
    if (!value) throw new IntakeError("no ID token for intake");
    return value;
  };
}

export interface HttpIntakeOptions {
  url: string;
  authHeader: AuthHeader;
  fetch?: typeof fetch;
}

export function httpIntakeClient({ url, authHeader, fetch: fetchImpl = fetch }: HttpIntakeOptions): IntakeClient {
  const endpoint = `${url.replace(/\/+$/, "")}/v1/turns`;
  return {
    async turn(buildId, signal, mayRetry = false) {
      const authorization = await authHeader();
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
        body: JSON.stringify({ build_id: buildId, may_retry: mayRetry }),
        signal,
      });
      if (!response.ok) {
        // Drain the body so the connection can be reused; never log it (it may echo the transcript).
        await response.arrayBuffer().catch(() => undefined);
        throw new IntakeError(`intake answered ${response.status}`, response.status);
      }
      const parsed = TurnResult.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) throw new IntakeError("intake answered 2xx with an unexpected body", response.status);
      return parsed.data;
    },
  };
}

export interface TurnContext {
  trace?: TraceContext;
  requestId?: string;
}

export interface TurnScheduler {
  /** Starts a turn for the build in the background. Never throws, never rejects. */
  trigger(buildId: string, context?: TurnContext): void;
  /** Whether a turn for the build is running on this instance. */
  isRunning(buildId: string): boolean;
  /** Resolves when no turn is running on this instance (tests, shutdown). */
  idle(): Promise<void>;
}

export interface TurnSchedulerOptions {
  /** Null when INTAKE_URL is unset: each trigger logs a WARNING instead. */
  intake: IntakeClient | null;
  log: Log;
  /** Per attempt. Intake's own deadline is 45 s. */
  timeoutMs?: number;
  /** Wait before the single retry. */
  retryDelayMs?: number;
}

export const INTAKE_TIMEOUT_MS = 50_000;
export const INTAKE_RETRY_DELAY_MS = 5000;

/**
 * Worth one retry: intake answered 5xx, or the request never got an answer
 * (connection refused or reset, DNS). Not a 4xx or a malformed body, which
 * would fail again, and not our own timeout: intake may still be running that
 * turn, and its idempotency is per stored message, not per concurrent call.
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof IntakeError) return error.status !== undefined && error.status >= 500;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return false;
  // fetch rejects with TypeError("fetch failed") for network failures.
  return error instanceof TypeError;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `work` with one deadline over all of it, credential acquisition
 * included: the Google metadata client has no timeout of its own on Cloud Run,
 * so the abort signal reaching fetch isn't enough. On the deadline the signal
 * aborts and the returned promise rejects with a TimeoutError at once; a late
 * result or rejection from `work` is dropped.
 */
export async function withDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException(`intake turn exceeded ${ms} ms`, "TimeoutError");
      controller.abort(error);
      reject(error);
    }, ms);
  });
  const running = work(controller.signal);
  running.catch(() => undefined);
  try {
    return await Promise.race([running, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One turn per build at a time on this instance. A trigger that arrives while
 * a turn for the same build is running queues exactly one more run after it,
 * so a message stored mid-turn still gets a turn (intake answers `noop` when
 * there is nothing new). A network error or 5xx is retried once after
 * retryDelayMs; a turn that still fails logs a WARNING, and the next user
 * message or a refetch of the transcript (build-routes.ts recovery) starts a
 * new one.
 */
export function createTurnScheduler({
  intake,
  log,
  timeoutMs = INTAKE_TIMEOUT_MS,
  retryDelayMs = INTAKE_RETRY_DELAY_MS,
}: TurnSchedulerOptions): TurnScheduler {
  const running = new Map<string, { again: boolean; done: Promise<void> }>();

  async function runOnce(buildId: string, context: TurnContext): Promise<void> {
    const fields = { buildId, requestId: context.requestId };
    if (!intake) {
      log("WARNING", "intake turn skipped: INTAKE_URL is not set", { trace: context.trace, fields });
      return;
    }
    const started = Date.now();
    for (let attempt = 1; ; attempt++) {
      // Only the first attempt may hand a transient failure back: on the last
      // one intake writes whatever reply it has, so the message is answered.
      const mayRetry = attempt === 1;
      try {
        const result = await withDeadline((signal) => intake.turn(buildId, signal, mayRetry), timeoutMs);
        log("INFO", "intake turn completed", {
          trace: context.trace,
          fields: {
            ...fields,
            attempt,
            durationMs: Date.now() - started,
            ...("noop" in result ? { noop: true } : { messageId: result.message_id, specVersion: result.spec_version, status: result.status }),
          },
        });
        return;
      } catch (error) {
        const intakeStatus = error instanceof IntakeError ? (error.status ?? null) : null;
        if (attempt === 1 && isRetryable(error)) {
          log("WARNING", "intake turn attempt failed; retrying", {
            error,
            trace: context.trace,
            fields: { ...fields, attempt, intakeStatus, retryDelayMs },
          });
          await sleep(retryDelayMs);
          continue;
        }
        log("WARNING", "intake turn failed", {
          error,
          trace: context.trace,
          fields: { ...fields, attempt, durationMs: Date.now() - started, intakeStatus },
        });
        return;
      }
    }
  }

  return {
    isRunning: (buildId) => running.has(buildId),
    trigger(buildId, context = {}) {
      const current = running.get(buildId);
      if (current) {
        current.again = true;
        return;
      }
      const entry = { again: false, done: Promise.resolve() };
      running.set(buildId, entry);
      entry.done = (async () => {
        try {
          do {
            entry.again = false;
            await runOnce(buildId, context);
          } while (entry.again);
        } catch {
          // runOnce catches everything; this guards a throwing logger.
        } finally {
          running.delete(buildId);
        }
      })();
    },
    async idle() {
      while (running.size > 0) await Promise.all([...running.values()].map((entry) => entry.done));
    },
  };
}
