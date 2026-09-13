import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/auth", () => ({ requestSignInCode: vi.fn(), verifySignInCode: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));

const { CodeBoxes, EmailCodeCard } = await import("./EmailCodeCard");

const boxes = (html: string) => html.match(/<span aria-hidden="true" class="[^"]*"/g) ?? [];

describe("CodeBoxes", () => {
  it("shows focus on the box the next digit goes into, via focus-within on the wrapper", () => {
    const html = renderToStaticMarkup(<CodeBoxes code="48" onChange={() => {}} />);
    expect(html).toMatch(/^<div class="group relative/);
    const found = boxes(html);
    expect(found).toHaveLength(6);
    expect(found.map((b) => b.includes("group-focus-within:border-coral"))).toEqual([false, false, true, false, false, false]);
  });

  it("keeps the ring on the last box once the code is full", () => {
    const found = boxes(renderToStaticMarkup(<CodeBoxes code="482913" onChange={() => {}} />));
    expect(found.findIndex((b) => b.includes("group-focus-within:"))).toBe(5);
  });

  it("keeps the real input labelled for one-time-code autofill", () => {
    expect(renderToStaticMarkup(<CodeBoxes code="" onChange={() => {}} />)).toMatch(/aria-label="6-digit code".*autoComplete="one-time-code"|autocomplete="one-time-code"/i);
  });
});

describe("EmailCodeCard", () => {
  it("renders the email step for sign-up", () => {
    const html = renderToStaticMarkup(<EmailCodeCard intent="signup" />);
    expect(html).toContain("Save your build. Own your data.");
    expect(html).toContain("Email me a code");
  });
});

describe("EmailCodeCard links keep next", () => {
  it("carries a guarded path between sign-in and sign-up", () => {
    expect(renderToStaticMarkup(<EmailCodeCard intent="signin" next="/live/bed-a" />)).toContain('href="/signup?next=%2Flive%2Fbed-a"');
    expect(renderToStaticMarkup(<EmailCodeCard intent="signup" next="/projects" />)).toContain('href="/signin?next=%2Fprojects"');
    expect(renderToStaticMarkup(<EmailCodeCard intent="signin" />)).toContain('href="/signup"');
  });
});
