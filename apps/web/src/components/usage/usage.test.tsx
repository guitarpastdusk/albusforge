import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsageSummary } from "@albusforge/schema";
import { usage as fixture } from "@/mocks/data";
import { exactCount, exactDollars, UsageDashboard } from "./UsageDashboard";

describe("workspace consumption", () => {
  it("renders real stage meaning, cache categories and payload versus storage distinction", () => {
    const html = renderToStaticMarkup(<UsageDashboard usage={UsageSummary.parse(fixture())} workspace="Garden" />);
    for (const text of ["Garden", "Build conversation", "Uncached input", "Cache reads", "New cache tokens", "$0.123456", "not database storage", "not your bill", "48,300,000"]) expect(html).toContain(text);
    expect(html).not.toContain("Tier 2");
    expect(html).toContain('role="region"');
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
  });
  it("keeps large counters and micro-dollar amounts exact", () => {
    expect(exactCount("9007199254740993")).toBe("9,007,199,254,740,993");
    expect(exactDollars("9007199254740993.000001")).toBe("$9,007,199,254,740,993.000001");
    expect(exactDollars("0.000000")).toBe("$0.00");
    expect(exactDollars("12.340000")).toBe("$12.34");
  });
  it("shows first-use guidance with a real build link instead of sample model rows", () => {
    const data = UsageSummary.parse(fixture());
    data.model = { total: { calls: "0", input_tokens: "0", output_tokens: "0", cache_read_tokens: "0", cache_creation_tokens: "0", cost_usd: "0.000000" }, stages: [] };
    const html = renderToStaticMarkup(<UsageDashboard usage={data} workspace="New workspace" />);
    expect(html).toContain("No model calls recorded this month");
    expect(html).toContain('href="/"');
    expect(html).not.toContain("<table");
    expect(html).toContain("Sensor readings accepted");
  });
  it("uses an exclusive end date and UTC display across year boundaries", () => {
    const data = UsageSummary.parse(fixture());
    data.period = { start: "2026-12-01T00:00:00.000Z", end: "2027-01-01T00:00:00.000Z" };
    const html = renderToStaticMarkup(<UsageDashboard usage={data} workspace="Garden" />);
    expect(html).toContain("Dec 31, 2026");
    expect(html).not.toContain("Jan 1, 2027");
  });
});
