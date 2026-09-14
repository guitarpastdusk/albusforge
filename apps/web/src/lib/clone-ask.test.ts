import { describe, expect, it } from "vitest";
import { cloneAskFor, cloneHref, MAX_CLONE_ASK, seededAsk } from "./clone-ask";

describe("cloneAskFor", () => {
  it("turns the listing into a request, without its price line", () => {
    expect(cloneAskFor({ name: "Fridge monitor", description: "Temperature and humidity inside the fridge. About $51 in parts." })).toBe(
      "Build me a fridge monitor: temperature and humidity inside the fridge.",
    );
    expect(cloneAskFor({ name: "Soil probe", description: "Moisture at the roots. From $12 in parts." })).toBe("Build me a soil probe: moisture at the roots.");
  });

  it("leaves a description without a price line alone", () => {
    expect(cloneAskFor({ name: "Vibration monitor", description: "Vibration on a compressor." })).toBe("Build me a vibration monitor: vibration on a compressor.");
  });

  it("links to the home page with the ask", () => {
    expect(cloneHref({ name: "Fridge monitor", description: "Cold." })).toBe(`/?ask=${encodeURIComponent("Build me a fridge monitor: cold.")}`);
  });
});

describe("seededAsk", () => {
  it("takes the first trimmed value, and nothing that is empty or too long", () => {
    expect(seededAsk(" keep my soil moist ")).toBe("keep my soil moist");
    expect(seededAsk(["first", "second"])).toBe("first");
    expect(seededAsk(undefined)).toBe("");
    expect(seededAsk("   ")).toBe("");
    expect(seededAsk("x".repeat(MAX_CLONE_ASK + 1))).toBe("");
  });

  it("passes markup and control characters through as text for the input, never as HTML", () => {
    // The seed only ever reaches a controlled <input value>, which React escapes; nothing here is interpreted.
    expect(seededAsk("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
    expect(seededAsk("line one\u0000\u0007 two")).toBe("line one\u0000\u0007 two");
    expect(seededAsk(decodeURIComponent("%22%3E%3Cimg%20src%3Dx%3E"))).toBe('"><img src=x>');
  });

  it("an overlong URL seed is dropped even when it is mostly whitespace inside", () => {
    expect(seededAsk(`a${" ".repeat(MAX_CLONE_ASK)}b`)).toBe("");
  });
});
