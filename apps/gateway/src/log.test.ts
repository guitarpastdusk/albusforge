import { describe, expect, it } from "vitest";
import { createLogger, formatLogLine, parseCloudTraceContext, parseTraceparent, traceFromHeaders } from "./log";

const TRACE = "0123456789abcdef0123456789abcdef";

describe("trace parsing", () => {
  it("parses X-Cloud-Trace-Context, converting the decimal span to hex", () => {
    expect(parseCloudTraceContext(`${TRACE}/1;o=1`)).toEqual({ traceId: TRACE, spanId: "0000000000000001", sampled: true });
    expect(parseCloudTraceContext(`${"0".repeat(32)}/1;o=1`)).toBeUndefined();
    expect(parseCloudTraceContext("nope")).toBeUndefined();
  });

  it("parses W3C traceparent", () => {
    expect(parseTraceparent(`00-${TRACE}-00f067aa0ba902b7-01`)).toEqual({
      traceId: TRACE,
      spanId: "00f067aa0ba902b7",
      sampled: true,
    });
    expect(parseTraceparent(`ff-${TRACE}-00f067aa0ba902b7-01`)).toBeUndefined();
  });

  it("prefers X-Cloud-Trace-Context and falls back to traceparent", () => {
    const other = "fedcba9876543210fedcba9876543210";
    expect(traceFromHeaders({ "x-cloud-trace-context": TRACE, traceparent: `00-${other}-00f067aa0ba902b7-01` })?.traceId).toBe(TRACE);
    expect(traceFromHeaders({ "x-cloud-trace-context": "junk", traceparent: `00-${other}-00f067aa0ba902b7-01` })?.traceId).toBe(other);
  });
});

describe("formatLogLine", () => {
  it("writes one JSON line with Cloud Logging's trace fields when the project is known", () => {
    const line = formatLogLine("INFO", "hello", { trace: { traceId: TRACE, spanId: "0000000000000001", sampled: true } }, "albusforge-staging");
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({
      severity: "INFO",
      message: "hello",
      "logging.googleapis.com/trace": `projects/albusforge-staging/traces/${TRACE}`,
      "logging.googleapis.com/spanId": "0000000000000001",
      "logging.googleapis.com/trace_sampled": true,
    });
  });

  it("omits the trace without a project, and fields can't overwrite severity or message", () => {
    const entry = JSON.parse(formatLogLine("ERROR", "real", { trace: { traceId: TRACE }, fields: { severity: "DEBUG", message: "fake" } }, undefined));
    expect(entry).toEqual({ severity: "ERROR", message: "real" });
  });

  it("serializes an error, its code and cause, and keeps the stack on one line", () => {
    const error = Object.assign(new Error("outer", { cause: new Error("inner") }), { code: "ECONNREFUSED" });
    const line = formatLogLine("ERROR", "failed", { error }, undefined);
    expect(line.trimEnd().split("\n")).toHaveLength(1);
    const entry = JSON.parse(line);
    expect(entry.error).toEqual({ name: "Error", message: "outer", code: "ECONNREFUSED", cause: { name: "Error", message: "inner" } });
    expect(entry.stack).toContain("outer");
  });

  it("createLogger writes through the given sink", () => {
    const lines: string[] = [];
    createLogger({ project: "p", write: (l) => lines.push(l) })("WARNING", "w");
    expect(lines).toEqual([`${JSON.stringify({ severity: "WARNING", message: "w" })}\n`]);
  });
});
