import Anthropic from "@anthropic-ai/sdk";
import { LlmError, type LlmProvider } from "./types";

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Per HTTP attempt. The caller's AbortSignal bounds the whole call. */
  timeoutMs?: number;
  /** SDK retries on 408/409/429/5xx and connection errors. */
  maxRetries?: number;
}

/** Claude through the Anthropic API, on the beta messages endpoint (fallbacks are a beta feature). */
export function createAnthropicProvider({ apiKey, timeoutMs = 45_000, maxRetries = 2 }: AnthropicProviderOptions): LlmProvider {
  // Belt and braces with test/no-live-calls.ts: no test builds a real client.
  if (process.env.VITEST) throw new LlmError("CONFIG", "createAnthropicProvider is disabled under vitest; replay recorded fixtures");
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries });
  return {
    name: "anthropic",
    create: (request, { signal }) => client.beta.messages.create(request, { signal }),
  };
}

/** Claude through Vertex AI (ARCHITECTURE.md §12.4). Not built: selecting it fails at startup. */
export function createVertexProvider(): LlmProvider {
  throw new LlmError("NOT_IMPLEMENTED", "LLM_PROVIDER=vertex is not implemented; use anthropic");
}

export const LLM_PROVIDERS = ["anthropic", "vertex"] as const;
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

export function createProvider(name: LlmProviderName, options: { apiKey?: string; timeoutMs?: number }): LlmProvider {
  if (name === "vertex") return createVertexProvider();
  if (!options.apiKey) throw new LlmError("CONFIG", "ANTHROPIC_API_KEY is required with LLM_PROVIDER=anthropic");
  return createAnthropicProvider({ apiKey: options.apiKey, timeoutMs: options.timeoutMs });
}
