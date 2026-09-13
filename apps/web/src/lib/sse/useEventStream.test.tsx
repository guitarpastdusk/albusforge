// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEventStream, type EventStreamOptions } from "./useEventStream";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A stand-in EventSource: records instances and lets a test deliver events. */
class FakeEventSource extends EventTarget {
  static instances: FakeEventSource[] = [];
  closed = false;
  constructor(readonly url: string) {
    super();
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  deliver(type: string, data: string) {
    this.dispatchEvent(new MessageEvent(type, { data }));
  }
}

let visibility: DocumentVisibilityState = "visible";
let container: HTMLDivElement;
let root: Root;

function Subscriber({ path, options }: { path: string | null; options: EventStreamOptions }) {
  useEventStream(path, options);
  return null;
}

const render = (path: string | null, options: EventStreamOptions) => act(async () => root.render(<Subscriber path={path} options={options} />));
const setVisibility = (state: DocumentVisibilityState) =>
  act(async () => {
    visibility = state;
    document.dispatchEvent(new Event("visibilitychange"));
  });
const live = () => FakeEventSource.instances.filter((s) => !s.closed);

beforeEach(() => {
  FakeEventSource.instances = [];
  visibility = "visible";
  vi.stubGlobal("EventSource", FakeEventSource);
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("useEventStream", () => {
  it("opens one stream on the path and hands listened-for events to onEvent, JSON-parsed", async () => {
    const onEvent = vi.fn();
    await render("/v1/builds/b1/events", { events: ["message.created"], onEvent });
    expect(live().map((s) => s.url)).toEqual(["/v1/builds/b1/events"]);

    live()[0]!.deliver("message.created", '{"message":{"id":"m2"}}');
    live()[0]!.deliver("heartbeat", "ping");
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith("message.created", { message: { id: "m2" } });
  });

  it("a parser shapes payloads and drops ones that don't match", async () => {
    const onEvent = vi.fn();
    const parse = { "build.updated": (data: unknown) => (typeof (data as { status?: unknown }).status === "string" ? data : undefined) };
    await render("/v1/builds/b1/events", { events: ["build.updated"], onEvent, parse });

    live()[0]!.deliver("build.updated", '{"status":"asking","spec_version":2}');
    live()[0]!.deliver("build.updated", '{"nope":true}');
    expect(onEvent.mock.calls).toEqual([["build.updated", { status: "asking", spec_version: 2 }]]);
  });

  it("calls onOpen on every open, closes while the tab is hidden, and reopens when it's visible again", async () => {
    const onOpen = vi.fn();
    await render("/v1/builds/b1/events", { events: ["message.created"], onEvent: vi.fn(), onOpen });
    live()[0]!.dispatchEvent(new Event("open"));
    expect(onOpen).toHaveBeenCalledTimes(1);

    await setVisibility("hidden");
    expect(live()).toHaveLength(0);

    await setVisibility("visible");
    expect(live()).toHaveLength(1);
    expect(FakeEventSource.instances).toHaveLength(2);
    live()[0]!.dispatchEvent(new Event("open"));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("doesn't open while hidden at mount, and opens once visible", async () => {
    visibility = "hidden";
    await render("/v1/builds/b1/events", { events: ["message.created"], onEvent: vi.fn() });
    expect(FakeEventSource.instances).toHaveLength(0);
    await setVisibility("visible");
    expect(live()).toHaveLength(1);
  });

  it("opens nothing without a path or when disabled, and closes the stream on unmount", async () => {
    await render(null, { events: ["message.created"], onEvent: vi.fn() });
    await render("/v1/builds/b1/events", { events: ["message.created"], onEvent: vi.fn(), enabled: false });
    expect(FakeEventSource.instances).toHaveLength(0);

    await render("/v1/builds/b1/events", { events: ["message.created"], onEvent: vi.fn() });
    const source = live()[0]!;
    await act(async () => root.render(null));
    expect(source.closed).toBe(true);
  });
});
