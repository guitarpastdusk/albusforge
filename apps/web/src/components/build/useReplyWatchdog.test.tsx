// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REPLY_CHECK_AFTER_MS, REPLY_RETRY_AFTER_MS, useReplyWatchdog } from "./useReplyWatchdog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

interface Props {
  waiting: boolean;
  onCheck: (attempt: number) => void;
  onGiveUp: () => void;
}

function Watch({ waiting, onCheck, onGiveUp }: Props) {
  useReplyWatchdog(waiting, onCheck, onGiveUp);
  return null;
}

const render = (props: Props) => act(async () => root.render(<Watch {...props} />));
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
  it("checks at 30 s, not before, then again on each following wait", async () => {
    expect(REPLY_CHECK_AFTER_MS).toBe(30_000);
    // The first wait is the check deadline itself, so shortening one shortens both.
    expect(REPLY_RETRY_AFTER_MS).toEqual([30_000, 30_000, 60_000]);
    const onCheck = vi.fn();
    const onGiveUp = vi.fn();
    await render({ waiting: true, onCheck, onGiveUp });

    await advance(REPLY_CHECK_AFTER_MS - 1);
    expect(onCheck).not.toHaveBeenCalled();
    await advance(1);
    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(onCheck).toHaveBeenLastCalledWith(1);

    await advance(30_000);
    expect(onCheck).toHaveBeenCalledTimes(2);
    await advance(60_000);
    expect(onCheck).toHaveBeenCalledTimes(3);
    expect(onCheck).toHaveBeenLastCalledWith(3);
  });

  it("gives up once the waits are spent, and stops checking", async () => {
    const onCheck = vi.fn();
    const onGiveUp = vi.fn();
    await render({ waiting: true, onCheck, onGiveUp });

    await advance(150_000);
    expect(onCheck).toHaveBeenCalledTimes(3);
    expect(onGiveUp).toHaveBeenCalledTimes(1);

    // Nothing further: a banner that keeps promising while nothing changes is worse than one that stops.
    await advance(600_000);
    expect(onCheck).toHaveBeenCalledTimes(3);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });

  it("a reply cancels the sequence; the next wait starts from the first interval", async () => {
    const onCheck = vi.fn();
    const onGiveUp = vi.fn();
    await render({ waiting: true, onCheck, onGiveUp });
    await advance(90_000);
    expect(onCheck).toHaveBeenCalledTimes(2);

    await render({ waiting: false, onCheck, onGiveUp });
    await advance(600_000);
    expect(onCheck).toHaveBeenCalledTimes(2);
    expect(onGiveUp).not.toHaveBeenCalled();

    // Waiting again: the full sequence, not what was left of the last one.
    await render({ waiting: true, onCheck, onGiveUp });
    await advance(REPLY_CHECK_AFTER_MS - 1);
    expect(onCheck).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(onCheck).toHaveBeenCalledTimes(3);
  });

  it("does nothing while not waiting, or after unmount", async () => {
    const onCheck = vi.fn();
    const onGiveUp = vi.fn();
    await render({ waiting: false, onCheck, onGiveUp });
    await advance(600_000);
    await render({ waiting: true, onCheck, onGiveUp });
    await act(async () => root.render(null));
    await advance(600_000);
    expect(onCheck).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });
});
