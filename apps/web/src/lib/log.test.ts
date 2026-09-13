import { describe, expect, it } from "vitest";
import { GatewayError } from "./api/core";
import { formatLogLine, parseCloudTraceContext, parseTraceparent, serializeError, traceFromHeaders } from "./log";

const TRACE = "0123456789abcdef0123456789abcdef";

describe("parseCloudTraceContext", () => {
  it("parses TRACE_ID/SPAN_ID;o=1, converting the decimal span to 16 hex chars", () => {
    expect(parseCloudTraceContext(`${TRACE}/1;o=1`)).toEqual({ traceId: TRACE, spanId: "0000000000000001", sampled: true });
    expect(parseCloudTraceContext(`${TRACE}/18446744073709551615;o=0`)).toEqual({
      traceId: TRACE,
      spanId: "ffffffffffffffff",
      sampled: false,
    });
  });

  it("accepts a bare trace ID and upper-case hex", () => {
    expect(parseCloudTraceContext(TRACE.toUpperCase())).toEqual({ traceId: TRACE });
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["too short", "0123456789abcdef/1;o=1"],
    ["not hex", `${"g".repeat(32)}/1;o=1`],
    ["all-zero trace", `${"0".repeat(32)}/1;o=1`],
    ["bad options", `${TRACE}/1;o=2`],
    ["junk after", `${TRACE}/1;o=1;x=y`],
  ])("rejects %s", (_label, value) => {
    expect(parseCloudTraceContext(value)).toBeUndefined();
  });

  it("keeps the trace but drops a span that is zero or out of range", () => {
    expect(parseCloudTraceContext(`${TRACE}/0;o=1`)).toEqual({ traceId: TRACE, sampled: true });
    expect(parseCloudTraceContext(`${TRACE}/18446744073709551616`)).toEqual({ traceId: TRACE });
  });
});

describe("parseTraceparent", () => {
  it("parses a W3C traceparent", () => {
    expect(parseTraceparent(`00-${TRACE}-00f067aa0ba902b7-01`)).toEqual({
      traceId: TRACE,
      spanId: "00f067aa0ba902b7",
      sampled: true,
    });
    expect(parseTraceparent(`00-${TRACE}-00f067aa0ba902b7-00`)?.sampled).toBe(false);
  });

  it.each([
    ["version ff", `ff-${TRACE}-00f067aa0ba902b7-01`],
    ["all-zero trace", `00-${"0".repeat(32)}-00f067aa0ba902b7-01`],
    ["all-zero span", `00-${TRACE}-${"0".repeat(16)}-01`],
    ["short span", `00-${TRACE}-00f067aa-01`],
    ["garbage", "not-a-traceparent"],
  ])("rejects %s", (_label, value) => {
    expect(parseTraceparent(value)).toBeUndefined();
  });
});

describe("traceFromHeaders", () => {
  const traceparent = `00-${"a".repeat(32)}-00f067aa0ba902b7-01`;

  it("prefers X-Cloud-Trace-Context", () => {
    expect(traceFromHeaders({ "x-cloud-trace-context": `${TRACE}/1;o=1`, traceparent })?.traceId).toBe(TRACE);
  });

  it("falls back to traceparent when X-Cloud-Trace-Context is absent or malformed", () => {
    expect(traceFromHeaders({ traceparent })?.traceId).toBe("a".repeat(32));
    expect(traceFromHeaders({ "x-cloud-trace-context": "nope", traceparent })?.traceId).toBe("a".repeat(32));
  });

  it("reads a Headers-like object and array header values", () => {
    expect(traceFromHeaders(new Headers({ "X-Cloud-Trace-Context": `${TRACE}/1` }))?.traceId).toBe(TRACE);
    expect(traceFromHeaders({ "x-cloud-trace-context": [`${TRACE}/1`, "ignored"] })?.traceId).toBe(TRACE);
  });

  it("returns undefined with neither header", () => {
    expect(traceFromHeaders({})).toBeUndefined();
  });
});

describe("formatLogLine", () => {
  const parse = (line: string) => JSON.parse(line) as Record<string, unknown>;

  it("is exactly one newline-terminated JSON line, severity and message first", () => {
    const line = formatLogLine("INFO", "hello", { fields: { extra: 1 } }, undefined);
    expect(line.endsWith("\n")).toBe(true);
    expect(line.slice(0, -1)).not.toContain("\n");
    expect(Object.keys(parse(line))).toEqual(["severity", "message", "extra"]);
  });

  it.each(["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] as const)("writes severity %s verbatim", (severity) => {
    expect(parse(formatLogLine(severity, "m", {}, undefined)).severity).toBe(severity);
  });

  it("does not let extra fields override severity or message", () => {
    const entry = parse(formatLogLine("ERROR", "real", { fields: { severity: "DEBUG", message: "fake" } }, undefined));
    expect(entry).toMatchObject({ severity: "ERROR", message: "real" });
  });

  it("serializes a multi-line stack into a single string field", () => {
    const error = new Error("boom");
    expect(error.stack).toContain("\n");
    const line = formatLogLine("ERROR", "failed", { error }, undefined);
    expect(line.slice(0, -1)).not.toContain("\n");
    const entry = parse(line);
    expect(entry.stack).toBe(error.stack);
    expect(entry.error).toEqual({ name: "Error", message: "boom" });
  });

  it("adds trace, span and sampled fields when the project and a trace are both known", () => {
    const entry = parse(
      formatLogLine("ERROR", "m", { trace: { traceId: TRACE, spanId: "0000000000000001", sampled: true } }, "albusforge-staging"),
    );
    expect(entry["logging.googleapis.com/trace"]).toBe(`projects/albusforge-staging/traces/${TRACE}`);
    expect(entry["logging.googleapis.com/spanId"]).toBe("0000000000000001");
    expect(entry["logging.googleapis.com/trace_sampled"]).toBe(true);
  });

  it("omits every trace field without GOOGLE_CLOUD_PROJECT", () => {
    const entry = parse(formatLogLine("ERROR", "m", { trace: { traceId: TRACE, spanId: "0000000000000001" } }, undefined));
    expect(Object.keys(entry).some((key) => key.startsWith("logging.googleapis.com/"))).toBe(false);
  });

  it("survives circular fields and bigints", () => {
    const loop: Record<string, unknown> = { n: 1n };
    loop.self = loop;
    expect(parse(formatLogLine("INFO", "m", { fields: { loop } }, undefined)).loop).toEqual({ n: "1", self: "[Circular]" });
  });
});

describe("serializeError", () => {
  it("keeps a React digest", () => {
    expect(serializeError(Object.assign(new Error("x"), { digest: "2408655454" }))).toMatchObject({ digest: "2408655454" });
  });

  it("serializes GatewayError details", () => {
    const error = new GatewayError({ route: "GET /v1/me", status: 200, contentType: "text/html; charset=utf-8", reason: "not_json" });
    expect(serializeError(error)).toEqual({
      name: "GatewayError",
      message: "GET /v1/me returned 200 text/html; charset=utf-8, expected application/json",
      gateway: { route: "GET /v1/me", status: 200, contentType: "text/html; charset=utf-8", reason: "not_json" },
    });
  });

  it("serializes a cause and non-Error values", () => {
    expect(serializeError(new Error("outer", { cause: new Error("inner") }))).toMatchObject({ cause: { message: "inner" } });
    expect(serializeError("plain")).toEqual({ value: "plain" });
  });
});
