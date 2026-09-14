import { expect, it } from "vitest";
import { assertActionOrigin } from "./action-origin";
it("accepts canonical same-host action origins and refuses absent, cross-host or insecure origins", () => {
  expect(() => assertActionOrigin("https://albusforge.ai", "albusforge.ai")).not.toThrow();
  expect(() => assertActionOrigin("http://localhost:3000", "localhost:3000")).not.toThrow();
  for (const origin of [null, "null", "https://other.albusforge.ai", "http://albusforge.ai", "https://albusforge.ai/", "https://user@albusforge.ai"]) expect(() => assertActionOrigin(origin, "albusforge.ai")).toThrow();
});
