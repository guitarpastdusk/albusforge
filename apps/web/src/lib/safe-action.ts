export const CONNECTION_MESSAGE = "We couldn’t reach albusforge.ai. Check your connection and try again.";

/**
 * Call a Server Function from the browser without letting it throw. An
 * `{ ok: false }` result passes through with its message; a rejected call —
 * lost connection, interrupted response, a stale action ID after a deploy —
 * becomes a retryable `{ ok: false }` with a safe message.
 */
export async function settle<T extends { ok: boolean }>(call: () => Promise<T>): Promise<T | { ok: false; message: string }> {
  try {
    return await call();
  } catch {
    return { ok: false, message: CONNECTION_MESSAGE };
  }
}
