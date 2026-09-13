import { describe, expect, it } from "vitest";
import { afterVerify } from "./after-verify";

describe("afterVerify", () => {
  it("returns to the guarded path for sign-in and sign-up", () => {
    expect(afterVerify("signin", "/live/bed-a")).toEqual({ kind: "navigate", to: "/live/bed-a" });
    expect(afterVerify("signup", "/projects/greenhouse-soil")).toEqual({ kind: "navigate", to: "/projects/greenhouse-soil" });
  });

  it("without next: sign-in goes to projects, sign-up shows its done step", () => {
    expect(afterVerify("signin", null)).toEqual({ kind: "navigate", to: "/projects" });
    expect(afterVerify("signup", null)).toEqual({ kind: "done" });
  });

  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"])("never follows an open redirect: %s", (next) => {
    expect(afterVerify("signin", next)).toEqual({ kind: "navigate", to: "/projects" });
    expect(afterVerify("signup", next)).toEqual({ kind: "done" });
  });
});
