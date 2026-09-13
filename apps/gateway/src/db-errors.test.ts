import { describe, expect, it } from "vitest";
import { isDatabaseUnavailable } from "./db-errors";

const withCode = (message: string, code: string) => Object.assign(new Error(message), { code });

describe("isDatabaseUnavailable", () => {
  it.each([
    ["pool acquire timeout", new Error("timeout exceeded when trying to connect")],
    ["handshake timeout", new Error("Connection terminated due to connection timeout")],
    ["client read timeout", new Error("Query read timeout")],
    ["statement_timeout", withCode("canceling statement due to statement timeout", "57014")],
    ["refused", withCode("connect ECONNREFUSED 10.0.0.3:5432", "ECONNREFUSED")],
    ["dropped connection", new Error("Connection terminated unexpectedly")],
    ["server shutting down", withCode("terminating connection due to administrator command", "57P01")],
  ])("%s", (_label, error) => {
    expect(isDatabaseUnavailable(error)).toBe(true);
  });

  it("looks through Drizzle's wrapper to the pg error", () => {
    const wrapped = new Error("Failed query: select ...", { cause: withCode("canceling statement due to statement timeout", "57014") });
    expect(isDatabaseUnavailable(wrapped)).toBe(true);
  });

  it.each([
    ["syntax error", withCode('syntax error at or near "selec"', "42601")],
    ["permission denied", withCode("permission denied for table parts", "42501")],
    ["plain bug", new TypeError("cannot read properties of undefined")],
    ["not an error", "timeout exceeded when trying to connect"],
  ])("not %s", (_label, error) => {
    expect(isDatabaseUnavailable(error)).toBe(false);
  });
});
