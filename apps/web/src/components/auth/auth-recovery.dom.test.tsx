// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestSignInCode, verifySignInCode } from "@/actions/auth";
import { EmailCodeCard } from "./EmailCodeCard";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("@/actions/auth", () => ({ requestSignInCode: vi.fn(), verifySignInCode: vi.fn() }));
let container: HTMLDivElement;
let root: Root;
const send = vi.mocked(requestSignInCode);
const verify = vi.mocked(verifySignInCode);
const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(name))!;
const click = (element: HTMLElement) => act(async () => element.click());
const advance = (milliseconds: number) => act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
async function input(selector: string, value: string) {
  await act(async () => {
    const field = container.querySelector<HTMLInputElement>(selector)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function start(intent: "signup" | "signin" = "signin", next: string | null = "/usage") {
  await act(async () => root.render(<EmailCodeCard intent={intent} next={next} />));
  await input("#email", "a@example.test");
  await click(button("Email me a code"));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-13T12:00:00Z"));
  container = document.createElement("div");document.body.appendChild(container);root = createRoot(container);
  send.mockReset();verify.mockReset();push.mockReset();
  send.mockResolvedValue({ ok: true, data: { email: "a@example.test" } });
  verify.mockResolvedValue({ ok: true, data: { email: "a@example.test" } });
});
afterEach(async () => { await act(async () => root.unmount());container.remove();vi.useRealTimers(); });
describe("email code recovery", () => {
  it("paces resend without preventing verification or changing the guarded destination", async () => {
    await start();
    expect(button("Resend in 30s").disabled).toBe(true);
    await input('[aria-label="6-digit code"]', "123456");
    expect(button("Verify & sign in").disabled).toBe(false);
    await click(button("Verify & sign in"));
    expect(push).toHaveBeenCalledWith("/usage");
  });
  it("expires local pacing then resends and clears an old code", async () => {
    await start();await input('[aria-label="6-digit code"]', "123456");
    await advance(30_000);await click(button("Resend code"));
    expect(send).toHaveBeenCalledTimes(2);
    expect(container.querySelector<HTMLInputElement>('[aria-label="6-digit code"]')!.value).toBe("");
    expect(button("Resend in 30s").disabled).toBe(true);
  });
  it("honors server resend delay across changing email but keeps verify available", async () => {
    await start();await advance(30_000);
    send.mockResolvedValueOnce({ ok: false, message: "Too many attempts.", retryAfterSeconds: 60 });
    await click(button("Resend code"));
    expect(button("Resend in 60s").disabled).toBe(true);
    await input('[aria-label="6-digit code"]', "123456");
    expect(button("Verify & sign in").disabled).toBe(false);
    await click(button("Change email"));
    expect(document.activeElement?.id).toBe("email");
    expect(button("Try again in 60s").disabled).toBe(true);
    expect(container.querySelector('a[href="/signup?next=%2Fusage"]')).not.toBeNull();
    await advance(60_000);expect(button("Email me a code").disabled).toBe(false);
  });
  it("allows changing email immediately and retains next after successful verification", async () => {
    await start();await click(button("Change email"));
    await input("#email", "changed@example.test");
    send.mockResolvedValueOnce({ ok: true, data: { email: "changed@example.test" } });
    await click(button("Email me a code"));await input('[aria-label="6-digit code"]', "123456");await click(button("Verify & sign in"));
    expect(verify).toHaveBeenCalledWith("changed@example.test", "123456");expect(push).toHaveBeenCalledWith("/usage");
  });
  it("keeps entered code after failures and enforces only an actual verification cooldown", async () => {
    await start();await input('[aria-label="6-digit code"]', "123456");
    verify.mockResolvedValueOnce({ ok: false, message: "Incorrect or expired code." });await click(button("Verify & sign in"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Incorrect or expired");
    expect(button("Verify & sign in").disabled).toBe(false);
    verify.mockResolvedValueOnce({ ok: false, message: "Too many attempts.", retryAfterSeconds: 45 });await click(button("Verify & sign in"));
    expect(button("Verify in 45s").disabled).toBe(true);
    await advance(45_000);expect(button("Verify & sign in").disabled).toBe(false);
  });
  it("preserves email after transport failure and provides a retry", async () => {
    send.mockRejectedValueOnce(new Error("private transport details"));await start();
    expect(container.querySelector<HTMLInputElement>("#email")!.value).toBe("a@example.test");
    expect(container.textContent).toContain("Check your connection");expect(container.textContent).not.toContain("private transport");
    await click(button("Email me a code"));expect(button("Change email")).toBeDefined();
  });
  it("blocks duplicate sends and email changes while a send is in flight", async () => {
    let resolve!: (result: Awaited<ReturnType<typeof requestSignInCode>>) => void;
    send.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    await act(async () => root.render(<EmailCodeCard intent="signin" />));
    await input("#email", "a@example.test");
    await act(async () => {
      const form = container.querySelector("form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLInputElement>("#email")!.disabled).toBe(true);
    await act(async () => resolve({ ok: true, data: { email: "a@example.test" } }));
    expect(button("Change email").disabled).toBe(false);
  });
  it("keeps a code after a lost verification response and allows retry", async () => {
    await start();await input('[aria-label="6-digit code"]', "123456");
    verify.mockRejectedValueOnce(new Error("private network details"));await click(button("Verify & sign in"));
    expect(container.querySelector<HTMLInputElement>('[aria-label="6-digit code"]')!.value).toBe("123456");
    expect(container.textContent).toContain("Check your connection");expect(push).not.toHaveBeenCalled();
    await click(button("Verify & sign in"));expect(push).toHaveBeenCalledWith("/usage");
  });
  it("can verify an already delivered code when a new request is rate limited", async () => {
    send.mockResolvedValueOnce({ ok: false, message: "Too many requests.", retryAfterSeconds: 300 });
    await start();expect(button("Try again in 300s").disabled).toBe(true);
    await click(button("I already have a code"));
    expect(send).toHaveBeenCalledTimes(1);
    await input('[aria-label="6-digit code"]', "123456");
    expect(button("Verify & sign in").disabled).toBe(false);
    await click(button("Verify & sign in"));expect(push).toHaveBeenCalledWith("/usage");
  });
  it("reports generic account success without claiming a specific saved build", async () => {
    await start("signup", null);await input('[aria-label="6-digit code"]', "123456");await click(button("Verify & create account"));
    expect(container.textContent).toContain("Your account is ready");expect(container.textContent).not.toContain("greenhouse");
  });
});
