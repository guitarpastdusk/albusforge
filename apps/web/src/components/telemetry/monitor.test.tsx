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
      "/v1/telemetry/devices?limit=50&presentation=1",
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
      `/v1/telemetry/devices/${id}?presentation=1`,
      `/v1/telemetry/devices/${id}/latest`,
      expect.stringContaining(`/v1/telemetry/devices/${id}/series?`),
    ]);
    expect(html).toContain("0 C");
    expect(html).toContain("temporarily busy");
    // A failed history read must not take the conversation panel down with it:
    // asking why the plot is empty is the point of having it there.
    expect(html).toContain("Ask about this device");
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
  // Window, resolution and end time remain; the channel picker is gone, because
  // every channel is plotted rather than chosen one at a time.
  expect(document.querySelectorAll("form label")).toHaveLength(3);
  expect(document.querySelector("select[name=channel]")).toBeNull();
  expect(document.querySelectorAll("section[aria-label$='history']")).toHaveLength(1);
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

it.each(["raw", "1m", "1h"])(
  "rejects explicit future end before rounding for %s",
  (resolution) => {
    const now = Date.parse("2026-09-13T12:30:00Z");
    const result = selection(
      { end: "2026-09-13T13:00", window: "hour", resolution },
      ["temp"],
      now,
    );
    expect(result.query).toBeUndefined();
    expect(result.error).toContain("future");
    expect(
      selection({ end: "2026-09-13T12:30:01", resolution }, ["temp"], now)
        .query,
    ).toBeUndefined();
  },
);
it.each([
  [
    "1m",
    "2026-09-13T12:30:00Z",
    "2026-09-13T12:30",
    "2026-09-13T12:30:00.000Z",
  ],
  [
    "1h",
    "2026-09-13T12:00:00Z",
    "2026-09-13T12:00",
    "2026-09-13T12:00:00.000Z",
  ],
  [
    "1h",
    "2026-09-13T12:30:00Z",
    "2026-09-13T12:30",
    "2026-09-13T12:00:00.000Z",
  ],
])(
  "allows exact current end while excluding open %s buckets",
  (resolution, current, end, expected) => {
    const result = selection(
      { end, resolution },
      ["temp"],
      Date.parse(current),
    );
    expect(result.error).toBeUndefined();
    expect(result.query?.to).toBe(expected);
  },
);
it("preserves a valid selected window while correcting incompatible resolution", async () => {
  mocked.get
    .mockResolvedValueOnce({
      device,
      channels: { temp: { unit: "C", min: -40, max: 85 } },
    })
    .mockResolvedValueOnce({ device_id: id, readings: [] });
  document.body.innerHTML = renderToStaticMarkup(
    await DevicePage({
      params: Promise.resolve({ deviceId: id }),
      searchParams: Promise.resolve({ window: "week", resolution: "raw" }),
    }),
  );
  expect(
    document
      .querySelector("select[name=window] option[selected]")
      ?.getAttribute("value"),
  ).toBe("week");
  expect(document.querySelector("[role=alert]")?.textContent).toContain(
    "7 days",
  );
  expect(mocked.get).toHaveBeenCalledTimes(2);
  expect(
    selection({ window: "week", end: "invalid" }, ["temp"], Date.now()).window,
  ).toBe("week");
  const corrected = selection(
    { window: "week", resolution: "1m" },
    ["temp"],
    Date.now(),
  );
  expect(corrected.query).toBeDefined();
  expect(
    Date.parse(corrected.query!.to) - Date.parse(corrected.query!.from),
  ).toBe(7 * 86400000);
});

it("preserves filters on pagination but starts a new filter submission without a cursor", async () => {
  mocked.get.mockResolvedValue({ devices: [{ ...device, display_name: "Fridge" }], next_after: id });
  document.body.innerHTML = renderToStaticMarkup(await FleetPage({ searchParams: Promise.resolve({ q: "Fridge", status: "offline", after: id }) }));
  expect(mocked.get.mock.calls[0]?.[0]).toContain("q=Fridge&status=offline&after=");
  const form = document.querySelector('input[type="search"]')?.closest("form");
  expect(form?.querySelector('[name="after"]')).toBeNull();
  expect(document.querySelector('nav[aria-label="Fleet pages"] a')?.getAttribute("href")).toBe("/live?q=Fridge&status=offline");
  expect(document.querySelector('nav[aria-label="Fleet pages"] a:last-child')?.getAttribute("href")).toContain("q=Fridge&status=offline&after=");
  expect(document.body.textContent).toContain("Fridge");
  expect(document.body.textContent).toContain("not fleet totals");
});

it("plots every channel at once, each in its own titled card and colour", async () => {
  mocked.get
    .mockResolvedValueOnce({
      device,
      channels: { temp: { unit: "C", min: -40, max: 85 }, soil: { unit: "%", min: 0, max: 100 } },
    })
    .mockResolvedValueOnce({ device_id: id, readings: [] })
    .mockResolvedValueOnce({ ...history, channel: "temp" })
    .mockResolvedValueOnce({ ...history, channel: "soil" });
  document.body.innerHTML = renderToStaticMarkup(
    await DevicePage({ params: Promise.resolve({ deviceId: id }), searchParams: Promise.resolve({}) }),
  );
  const cards = document.querySelectorAll("section[aria-label$='history']");
  expect([...cards].map((card) => card.getAttribute("aria-label"))).toEqual(["temp history", "soil history"]);
  // Both are drawn, rather than one chosen and the other hidden behind a select.
  expect(document.querySelectorAll("section[aria-label$='history'] svg")).toHaveLength(2);
  // Fixed order, never cycled: channel one is slot one whatever else is present.
  const dots = [...document.querySelectorAll("section[aria-label$='history'] span[aria-hidden]")];
  expect(dots.map((dot) => dot.getAttribute("style"))).toEqual([
    "background:var(--color-series-1)",
    "background:var(--color-series-2)",
  ]);
  // Identity is in the heading, not only the colour.
  expect([...cards].map((card) => card.querySelector("h3")?.textContent)).toEqual(["temp", "soil"]);
});

it("keeps one channel's failure inside its own card", async () => {
  mocked.get
    .mockResolvedValueOnce({
      device,
      channels: { temp: { unit: "C", min: -40, max: 85 }, soil: { unit: "%", min: 0, max: 100 } },
    })
    .mockResolvedValueOnce({ device_id: id, readings: [] })
    .mockResolvedValueOnce({ ...history, channel: "temp" })
    .mockRejectedValueOnce(new ApiRequestError(410, "HISTORY_EXPIRED", "expired", { available_from: "2026-01-01T00:00:00Z" }));
  document.body.innerHTML = renderToStaticMarkup(
    await DevicePage({ params: Promise.resolve({ deviceId: id }), searchParams: Promise.resolve({}) }),
  );
  // The healthy channel still plots; only the failing one says so.
  expect(document.querySelectorAll("section[aria-label$='history'] svg")).toHaveLength(1);
  expect(document.querySelector("section[aria-label='soil history'] [role=alert]")?.textContent).toBeTruthy();
});

it("ignores a retired channel parameter instead of contradicting the plots", async () => {
  mocked.get
    .mockResolvedValueOnce({ device, channels: { temp: { unit: "C", min: -40, max: 85 } } })
    .mockResolvedValueOnce({ device_id: id, readings: [] })
    .mockResolvedValueOnce({ ...history, channel: "temp" });
  document.body.innerHTML = renderToStaticMarkup(
    await DevicePage({
      params: Promise.resolve({ deviceId: id }),
      // A bookmark from when the page had a channel picker, naming a channel that is gone.
      searchParams: Promise.resolve({ channel: "removed_channel" }),
    }),
  );
  // The plot renders, and nothing tells the person to choose a provisioned channel.
  expect(document.querySelectorAll("section[aria-label$='history'] svg")).toHaveLength(1);
  expect(document.body.textContent).not.toContain("Choose a provisioned channel");
});
