/*
 * Pins the request wiring to the installed @anthropic-ai/sdk types. If an SDK
 * upgrade renames or retypes any of these fields, this file stops compiling
 * (pnpm typecheck) before it can reach the API.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { SpecTurn } from "@albusforge/schema";
import { describe, expect, expectTypeOf, it } from "vitest";
import { buildRequest, FALLBACK_BETA, outputFormat, prefixHash, systemBlocks } from "../src/request";
import type { LlmRoute } from "../src/types";

type Params = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;

const route: LlmRoute = {
  name: "intake.extract.v1",
  stage: "intake",
  system: "You turn asks into specs.",
  cachedContext: "# Part catalogue\n",
  effort: "medium",
  maxTokens: 8000,
  retryMaxTokens: 16000,
};

describe("buildRequest", () => {
  const request = buildRequest(route, {
    model: "claude-opus-5",
    maxTokens: 8000,
    format: outputFormat(SpecTurn),
    messages: [{ role: "user", content: "hi" }],
  });

  it("is a non-streaming beta create request, field by field", () => {
    expectTypeOf(request).toEqualTypeOf<Params>();
    // Each value checked against the SDK's own field type.
    expectTypeOf<"default">().toExtend<NonNullable<Params["fallbacks"]>>();
    expectTypeOf<typeof FALLBACK_BETA>().toExtend<NonNullable<Params["betas"]>[number]>();
    expectTypeOf<{ type: "adaptive" }>().toExtend<NonNullable<Params["thinking"]>>();
    expectTypeOf<"medium">().toExtend<NonNullable<NonNullable<Params["output_config"]>["effort"]>>();
    expectTypeOf<ReturnType<typeof outputFormat>>().toExtend<NonNullable<NonNullable<Params["output_config"]>["format"]>>();
    expectTypeOf<{ type: "ephemeral" }>().toExtend<NonNullable<Anthropic.Beta.Messages.BetaTextBlockParam["cache_control"]>>();

    expect(request.model).toBe("claude-opus-5");
    expect(request.max_tokens).toBe(8000);
    expect(request.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(request.fallbacks).toBe("default");
    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request.output_config?.effort).toBe("medium");
    expect(request.output_config?.format?.type).toBe("json_schema");
    expect(request).not.toHaveProperty("stream");
  });

  it("caches system plus catalogue with one breakpoint on the last system block", () => {
    expect(request.system).toEqual([
      { type: "text", text: "You turn asks into specs." },
      { type: "text", text: "# Part catalogue\n", cache_control: { type: "ephemeral" } },
    ]);
    // The transcript carries no breakpoint.
    expect(JSON.stringify(request.messages)).not.toContain("cache_control");
  });

  it("puts the breakpoint on the system prompt when there is no cached context", () => {
    expect(systemBlocks({ ...route, cachedContext: undefined })).toEqual([
      { type: "text", text: "You turn asks into specs.", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("sends SpecTurn as a strict JSON schema without the helper's local parse function", () => {
    const format = outputFormat(SpecTurn);
    expect(Object.keys(format).sort()).toEqual(["schema", "type"]);
    expect(format.schema).toMatchObject({ type: "object", additionalProperties: false, required: ["spec_patch", "candidate_questions", "assumptions", "reply"] });
    // Deterministic, so it never perturbs anything cached after it.
    expect(JSON.stringify(outputFormat(SpecTurn))).toBe(JSON.stringify(format));
  });

  it("hashes the prefix stably and changes when the catalogue does", () => {
    expect(prefixHash(route)).toBe(prefixHash({ ...route }));
    expect(prefixHash(route)).not.toBe(prefixHash({ ...route, cachedContext: "# Part catalogue\n- more\n" }));
  });
});
