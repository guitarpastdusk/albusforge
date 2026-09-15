// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocked = vi.hoisted(() => ({ get: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/api/server", () => ({ apiGet: mocked.get, orNotFound: (p: Promise<unknown>) => p }));
vi.mock("@/lib/session", () => ({ requireSession: mocked.session }));

import ShowcaseFleet from "@/app/showcase/page";
import ShowcaseDevice from "@/app/showcase/[deviceId]/page";
import ShowcaseSetup from "@/app/showcase/[deviceId]/setup/page";

const id = "11111111-1111-4111-8111-111111111111";
const device = { id, status: "online", last_seen_at: "2026-09-15T02:00:00Z", next_s: 60, revoked_at: null, health: null };
const history = {
  device_id: id,
  channel: "illuminance",
  resolution: "raw" as const,
  from: "2026-09-15T01:00:00Z",
  to: "2026-09-15T02:00:00Z",
  pending_rollup: false,
  points: [{ t: "2026-09-15T01:30:00Z", v: 412, seq: 1, ordinal: 1 }],
};

beforeEach(() => {
  mocked.get.mockReset();
  mocked.session.mockReset();
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the public showcase", () => {
  it("never asks for a session", async () => {
    // The whole point: a signed-out visitor reads these. If any of them ever
    // starts calling requireSession, the demo link becomes a sign-in wall.
    mocked.get.mockResolvedValue({ devices: [], next_after: null });
    await ShowcaseFleet({ searchParams: Promise.resolve({}) });
    expect(mocked.session).not.toHaveBeenCalled();
  });

  it("lists devices and links into the showcase, never into the authenticated pages", async () => {
    mocked.get.mockResolvedValueOnce({ devices: [{ ...device, display_name: "Plant A" }], next_after: null });
    const html = renderToStaticMarkup(await ShowcaseFleet({ searchParams: Promise.resolve({}) }));
    expect(html).toContain(`href="/showcase/${id}"`);
    expect(html).not.toContain('href="/live');
    expect(text(html)).toContain("Plant A");
  });

  it("reads through the public routes only", async () => {
    mocked.get.mockResolvedValue({ devices: [], next_after: null });
    await ShowcaseFleet({ searchParams: Promise.resolve({}) });
    for (const [path] of mocked.get.mock.calls) {
      expect(String(path).startsWith("/v1/public/live/"), String(path)).toBe(true);
    }
  });

  it("plots every channel on the device page, as the authenticated page does", async () => {
    mocked.get
      .mockResolvedValueOnce({ device, channels: { illuminance: { unit: "lx", min: 0, max: 65535 }, temperature: { unit: "C", min: -40, max: 85 } } })
      .mockResolvedValueOnce({ device_id: id, readings: [{ channel: "illuminance", v: 412, t: "2026-09-15T02:00:00Z" }] })
      .mockResolvedValueOnce({ ...history, channel: "illuminance" })
      .mockResolvedValueOnce({ ...history, channel: "temperature" });
    const html = renderToStaticMarkup(
      await ShowcaseDevice({ params: Promise.resolve({ deviceId: id }), searchParams: Promise.resolve({}) }),
    );
    expect(html.match(/section aria-label="[^"]+ history"/g)).toHaveLength(2);
    expect(html).toContain(`href="/showcase/${id}/setup"`);
  });

  it("shows setup state without any control that changes it", async () => {
    mocked.get.mockResolvedValueOnce({
      device_id: id,
      checked_at: "2026-09-15T02:00:00Z",
      registered_at: "2026-09-14T00:00:00Z",
      state: "confirmed",
      packet_received: true,
      last_packet_at: "2026-09-15T01:59:00Z",
      upload_interval_s: 600,
      revoked_at: null,
      channels: [{ key: "illuminance", unit: "lx", latest: { at: "2026-09-15T01:59:00Z", value: 412 } }],
    });
    const html = renderToStaticMarkup(await ShowcaseSetup({ params: Promise.resolve({ deviceId: id }) }));
    expect(text(html)).toContain("illuminance");
    // The safety property, not a cosmetic one: no claim, credential or
    // configuration control may exist on a page anyone can open. A disabled
    // control is still a control a later edit can enable.
    expect(html).not.toMatch(/<button/i);
    expect(html).not.toMatch(/<input/i);
    expect(html).not.toMatch(/<form/i);
    // Word-bounded: "Registered channels" is a heading, not a control.
    expect(text(html)).not.toMatch(/\brevoke\b|replace credential|download configuration|\bregister\b/i);
  });

  it("refuses a device id that is not a uuid rather than passing it to the gateway", async () => {
    await expect(ShowcaseDevice({ params: Promise.resolve({ deviceId: "../admin" }), searchParams: Promise.resolve({}) })).rejects.toThrow();
    expect(mocked.get).not.toHaveBeenCalled();
  });
});
