export class AskError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

/** Internal diagnostic only; public callers retain the generic daily-limit error. */
export class AskQuotaError extends AskError {
  constructor(readonly scope: "actor" | "tenant" | "global") {
    super(429,"DAILY_LIMIT","Sensor chat daily request limit reached");
  }
}
