import { ApiError } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { databaseErrorFields, describeError } from "./db-log";
import { createLogger } from "./log";

const MARKER = "PRIVATE_TRANSCRIPT_MARKER";

/** The shape Drizzle and pg produce: a wrapper carrying SQL and params, caused by a pg DatabaseError. */
function drizzleError() {
  const pgError = Object.assign(new Error(`invalid input syntax: "${MARKER}"`), {
    name: "error",
    code: "22021",
    severity: "ERROR",
    table: "build_messages",
    schema: "builds",
    routine: "report_invalid_encoding",
    detail: `Key (text)=(${MARKER})`,
  });
  const wrapper = new Error(`Failed query: insert into "builds"."build_messages" values ($1)\nparams: ${MARKER}`, { cause: pgError });
  wrapper.name = "DrizzleQueryError";
  return wrapper;
}

describe("databaseErrorFields", () => {
  it("keeps the SQLSTATE and location, never messages, details or params", () => {
    const fields = databaseErrorFields(drizzleError());
    expect(fields).toEqual({ kind: "DatabaseError", code: "22021", severity: "ERROR", table: "build_messages", schema: "builds", routine: "report_invalid_encoding" });
    expect(JSON.stringify(fields)).not.toContain(MARKER);
  });

  it("ignores errors that aren't from the database", () => {
    expect(databaseErrorFields(new Error("boom"))).toBeUndefined();
    expect(describeError(new Error("boom"))).toEqual({ error: expect.any(Error) });
  });
});

describe("the error handler", () => {
  it("logs a database error's metadata without the query parameters", async () => {
    const lines: string[] = [];
    const app = buildApp({
      parts: { latest: async () => Promise.reject(drizzleError()) },
      ping: async () => {},
      log: createLogger({ write: (line) => lines.push(line) }),
    });
    const response = await app.inject({ method: "GET", url: "/v1/parts" });
    expect(response.statusCode).toBe(500);
    expect(ApiError.parse(response.json()).error.code).toBe("INTERNAL");
    expect(lines.join("")).not.toContain(MARKER);
    expect(JSON.parse(lines[0]!)).toMatchObject({ severity: "ERROR", message: "request failed", database: { code: "22021", table: "build_messages" } });
    await app.close();
  });
});
