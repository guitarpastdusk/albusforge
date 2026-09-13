import { expect, it } from "vitest";
import { localDatabase, localEndpoint } from "./local.js";

it("restricts simulator credentials to loopback origins", () => {
  expect(localEndpoint("http://127.0.0.1:8080").origin).toBe("http://127.0.0.1:8080");
  expect(localEndpoint("http://[::1]:8080").hostname).toBe("[::1]");
  for (const url of ["https://example.com", "http://localhost.example.com", "http://user:pass@localhost", "http://localhost/other", "http://localhost?token=secret", "file:///tmp/x"]) {
    expect(() => localEndpoint(url)).toThrow();
  }
  expect(() => localDatabase("10.0.0.3")).toThrow();
});
