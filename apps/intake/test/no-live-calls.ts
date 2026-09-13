/*
 * Tests never call the model API (ARCHITECTURE.md §12.6). Fail the run if CI
 * has a real key in scope; @albusforge/llm's createAnthropicProvider also
 * refuses to build a client under vitest.
 */
if (process.env.CI && process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is set in CI. Tests replay recorded fixtures and must never call the API; unset it.");
}
