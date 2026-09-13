import { BUILD_EVENT, BuildUpdatedEvent, MessageCreatedEvent } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { mockBuildEvents } from "./build-events";
import * as data from "./data";

interface SseEvent {
  id?: string;
  event?: string;
  data?: string;
}

/** Read the stream until `done` says so (or a deadline), then disconnect. */
async function readEvents(response: Response, controller: AbortController, done: (events: SseEvent[]) => boolean): Promise<SseEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const events: SseEvent[] = [];
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && !done(events)) {
    const { value, done: ended } = await reader.read();
    if (ended) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event: SseEvent = {};
      for (const line of block.split("\n")) {
        const colon = line.indexOf(": ");
        if (line.startsWith(":") || colon === -1) continue;
        const key = line.slice(0, colon) as keyof SseEvent;
        if (key === "id" || key === "event" || key === "data") event[key] = line.slice(colon + 2);
      }
      if (event.event) events.push(event);
    }
  }
  controller.abort();
  return events;
}

describe("mock build event stream", () => {
  it("on connect sends build.updated and replays the transcript as message.created, each matching the contract", async () => {
    const { build } = data.createBuild("A soil sensor", "77777777-7777-4777-8777-777777777777");
    const controller = new AbortController();
    const response = mockBuildEvents(build.build_id, controller.signal);
    expect(response.headers.get("content-type")).toBe("text/event-stream");

    const events = await readEvents(response, controller, (seen) => seen.filter((e) => e.event === BUILD_EVENT.messageCreated).length >= 2);
    expect(events[0]!.event).toBe(BUILD_EVENT.buildUpdated);
    expect(BuildUpdatedEvent.parse(JSON.parse(events[0]!.data!))).toEqual({ status: "asking", spec_version: 1 });

    const messages = events.filter((e) => e.event === BUILD_EVENT.messageCreated).map((e) => MessageCreatedEvent.parse(JSON.parse(e.data!)).message);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(events.filter((e) => e.event === BUILD_EVENT.messageCreated).map((e) => e.id)).toEqual(messages.map((m) => m.id));
  });

  it("sends a message posted after connecting, and a build.updated when the status changes", async () => {
    const { build } = data.createBuild("A soil sensor", "88888888-8888-4888-8888-888888888888");
    const controller = new AbortController();
    const response = mockBuildEvents(build.build_id, controller.signal);
    setTimeout(() => data.postBuildMessage(build.build_id, "One bed", "99999999-9999-4999-8999-999999999999"), 30);

    const events = await readEvents(response, controller, (seen) => seen.filter((e) => e.event === BUILD_EVENT.messageCreated).length >= 4);
    const texts = events.filter((e) => e.event === BUILD_EVENT.messageCreated).map((e) => MessageCreatedEvent.parse(JSON.parse(e.data!)).message.text);
    expect(texts[2]).toBe("One bed");
    expect(texts[3]).toMatch(/^Got it\./);
    const updates = events.filter((e) => e.event === BUILD_EVENT.buildUpdated).map((e) => BuildUpdatedEvent.parse(JSON.parse(e.data!)));
    expect(updates.at(-1)).toEqual({ status: "asking", spec_version: 2 });
  });

  it("an unknown build is a 404 in the API error shape", async () => {
    const response = mockBuildEvents("nope", new AbortController().signal);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
  });
});
