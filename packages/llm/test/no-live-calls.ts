/*
 * Tests never call the model API (ARCHITECTURE.md §12.6): every response is a
 * recorded fixture. Fail the run outright if CI has a real key in scope, and
 * createAnthropicProvider refuses to build a client under vitest regardless.
 */
if (process.env.CI && process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is set in CI. Tests replay recorded fixtures and must never call the API; unset it.");
}
