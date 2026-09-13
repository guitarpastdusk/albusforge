// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { selection, historyFailure } from "@/lib/telemetry-monitor";
import { ApiRequestError } from "@/lib/api/core";
import { HistoryPlot } from "./HistoryPlot";
const mocked = vi.hoisted(() => ({ get: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/api/server", () => ({
  apiGet: mocked.get,
  orNotFound: (p: Promise<unknown>) => p,
}));
vi.mock("@/lib/session", () => ({ requireSession: mocked.session }));
import FleetPage from "@/app/(app)/live/page";
import DevicePage from "@/app/(app)/live/[deviceId]/page";
const id = "11111111-1111-4111-8111-111111111111";
const device = {
  id,
  status: "online",
  last_seen_at: "2026-09-13T12:00:00Z",
  next_s: 60,
  revoked_at: null,
  health: null,
};
const history = {
  device_id: id,
  channel: "temp",
  resolution: "raw" as const,
  from: "2026-09-13T11:00:00Z",
  to: "2026-09-13T12:00:00Z",
  pending_rollup: false,
  points: [
    { t: "2026-09-13T11:00:00Z", v: 0, seq: "9007199254740993", ordinal: 0 },
    { t: "2026-09-13T11:15:00Z", v: 2, seq: "9007199254740994", ordinal: 0 },
  ],
};
beforeEach(() => {
  mocked.get.mockReset();
  mocked.session.mockReset();
  mocked.session.mockResolvedValue({ tenant: { id: "tenant" } });
});
it("uses UTC aligned bounded windows and rejects incompatible controls", () => {
  const result = selection(
    { window: "week", resolution: "1m" },
    ["temp"],
    Date.parse("2026-09-13T12:03:59Z"),
  );
  expect(result.query?.to).toBe("2026-09-13T12:03:00.000Z");
  expect(result.query?.limit).toBe(2000);
  expect(
    selection({ window: "week", resolution: "raw" }, ["temp"], Date.now())
      .error,
  ).toMatch(/24 hours/);
  expect(
    selection({ channel: "foreign" }, ["temp"], Date.now()).error,
  ).toBeTruthy();
  expect(
    selection({ end: "invalid" }, ["temp"], Date.now()).error,
  ).toBeTruthy();
});
it("preserves real time spacing, zero and exact identity without connecting gaps", () => {
  const html = renderToStaticMarkup(<HistoryPlot history={history} unit="C" />);
  expect(html).toContain('cx="80"');
  expect(html).toContain('cx="257.5"');
  expect(html).toContain("9007199254740993");
  expect(html).toContain("<td>0</td>");
  expect(html).not.toContain("polyline");
  expect(html).toContain("Inspect 2 samples");
});
it("does not present pending empty rollups as complete", () => {
  expect(
    renderToStaticMarkup(
      <HistoryPlot
        history={{
          ...history,
          resolution: "1h",
          points: [],
          pending_rollup: true,
        }}
        unit="C"
      />,
    ),
  ).toContain("rollups are still pending");
});
it("provides actionable retention and limit errors without swallowing authorization failures", () => {
  expect(
    historyFailure(
      new ApiRequestError(410, "HISTORY_EXPIRED", "expired", {
        available_from: "2026-09-01T00:00:00Z",
      }),
    ),
  ).toContain("2026-09-01");
  expect(
    historyFailure(new ApiRequestError(422, "TOO_MANY_POINTS", "many")),
  ).toContain("No partial series");
  expect(historyFailure(new ApiRequestError(503, "BUSY", "busy"))).toContain(
    "retry",
  );
  expect(
    historyFailure(new ApiRequestError(401, "UNAUTHORIZED", "denied")),
  ).toBeNull();
});
describe("real route contracts", () => {
  it("loads only the telemetry fleet contract after session admission and renders pagination", async () => {
    mocked.get.mockResolvedValue({ devices: [device], next_after: id });
    const html = renderToStaticMarkup(
      await FleetPage({ searchParams: Promise.resolve({}) }),
    );
    expect(mocked.session).toHaveBeenCalledWith("/live");
    expect(mocked.get.mock.calls[0]?.[0]).toBe(
      "/v1/telemetry/devices?limit=50",
    );
    expect(html).toContain(`href="/live/${id}"`);
    expect(html).toContain("Next page");
    expect(html).toContain("not streamed");
  });
  it("does not fetch fleet when session admission fails", async () => {
    mocked.session.mockRejectedValue(new Error("redirect"));
    await expect(
      FleetPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("redirect");
    expect(mocked.get).not.toHaveBeenCalled();
  });
  it("renders stored detail/latest with zero and retains them when history is unavailable", async () => {
    mocked.get
      .mockResolvedValueOnce({
        device,
        channels: { temp: { unit: "C", min: -40, max: 85 } },
      })
      .mockResolvedValueOnce({
        device_id: id,
        readings: [{ channel: "temp", ...history.points[0] }],
      })
      .mockRejectedValueOnce(new ApiRequestError(503, "BUSY", "busy"));
    const html = renderToStaticMarkup(
      await DevicePage({
        params: Promise.resolve({ deviceId: id }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(mocked.get.mock.calls.map((c) => c[0])).toEqual([
      `/v1/telemetry/devices/${id}`,
      `/v1/telemetry/devices/${id}/latest`,
      expect.stringContaining(`/v1/telemetry/devices/${id}/series?`),
    ]);
    expect(html).toContain("0 C");
    expect(html).toContain("temporarily busy");
    expect(html).not.toContain("Ask me");
  });
});

it("exposes labelled history controls and inspectable evidence in the DOM", async () => {
  mocked.get
    .mockResolvedValueOnce({
      device,
      channels: { temp: { unit: "C", min: -40, max: 85 } },
    })
    .mockResolvedValueOnce({ device_id: id, readings: [] })
    .mockResolvedValueOnce(history);
  document.body.innerHTML = renderToStaticMarkup(
    await DevicePage({
      params: Promise.resolve({ deviceId: id }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(document.querySelectorAll("form label")).toHaveLength(4);
  expect(
    document.querySelector("select[name=resolution]")?.closest("label")
      ?.textContent,
  ).toContain("Resolution");
  expect(document.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(document.querySelector("svg")?.getAttribute("aria-label")).toContain(
    "raw samples",
  );
  expect(document.querySelector("form")?.getAttribute("action")).toBeNull();
});

it("serializes one complete SVG tooltip text node for stable hydration", () => {
  document.body.innerHTML = renderToStaticMarkup(
    <HistoryPlot history={history} unit="C" />,
  );
  const title = document.querySelector("circle title");
  expect(title?.textContent).toBe(
    "2026-09-13T11:00:00Z: 0 C; sequence 9007199254740993, ordinal 0",
  );
  expect(title?.childNodes).toHaveLength(1);
});
