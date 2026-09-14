import { expect, it } from "vitest";
import { assertSameOrigin } from "./mutation-origin";
it("accepts same-origin HTTPS and explicit loopback HTTP without forwarded-host trust", () => {
  expect(() => assertSameOrigin({ headers: { host: "albusforge.ai", origin: "https://albusforge.ai" } })).not.toThrow();
  expect(() => assertSameOrigin({ headers: { host: "localhost:8080", origin: "http://localhost:8080" } })).not.toThrow();
});
it.each([undefined, "null", "https://evil.test", "http://albusforge.ai", "https://albusforge.ai/path", "https://user@albusforge.ai", "https://albusforge.ai/"])("refuses missing or noncanonical/untrusted origin %s", (origin) => {
  expect(() => assertSameOrigin({ headers: { host: "albusforge.ai", origin, "x-forwarded-host": "evil.test" } })).toThrow("same-origin");
});
