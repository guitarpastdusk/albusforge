// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPLY_CHECK_AFTER_MS, useReplyWatchdog } from "./useReplyWatchdog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Watch({ waiting, onOverdue }: { waiting: boolean; onOverdue: () => void }) {
  useReplyWatchdog(waiting, onOverdue);
  return null;
}

const render = (waiting: boolean, onOverdue: () => void) => act(async () => root.render(<Watch waiting={waiting} onOverdue={onOverdue} />));
const advance = (ms: number) => act(async () => vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
});

describe("useReplyWatchdog", () => {
  it("offers to check again at 60 s, not before, and only once", async () => {
    expect(REPLY_CHECK_AFTER_MS).toBe(60_000);
    const onOverdue = vi.fn();
    await render(true, onOverdue);
    await advance(59_999);
    expect(onOverdue).not.toHaveBeenCalled();
    await advance(1);
    expect(onOverdue).toHaveBeenCalledTimes(1);
    await advance(120_000);
    expect(onOverdue).toHaveBeenCalledTimes(1);
  });

  it("a reply before the deadline cancels it; the next wait starts a fresh clock", async () => {
    const onOverdue = vi.fn();
    await render(true, onOverdue);
    await advance(45_000);
    await render(false, onOverdue);
    await advance(60_000);
    expect(onOverdue).not.toHaveBeenCalled();

    await render(true, onOverdue);
    await advance(59_000);
    expect(onOverdue).not.toHaveBeenCalled();
    await advance(1_000);
    expect(onOverdue).toHaveBeenCalledTimes(1);
  });

  it("does nothing while not waiting, or after unmount", async () => {
    const onOverdue = vi.fn();
    await render(false, onOverdue);
    await advance(120_000);
    await render(true, onOverdue);
    await act(async () => root.render(null));
    await advance(120_000);
    expect(onOverdue).not.toHaveBeenCalled();
  });
});
