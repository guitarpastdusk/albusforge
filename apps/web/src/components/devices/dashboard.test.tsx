import type { Channel, DeviceAction, Series } from "@albusforge/schema";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Toggle } from "@/components/ui";
import { ClosedLoopActions } from "./ClosedLoopActions";
import { LineChartCard, StatTile } from "./DeviceWidgets";

const AT = "2026-09-13T12:00:00Z";

const soil: Channel = { key: "soil_vwc", label: "Soil moisture", unit: "% VWC", kind: "number", precision: 1, valid_range: [0, 60] };
const battery: Channel = { key: "battery", label: "Battery", unit: "%", kind: "number", precision: 0, valid_range: [0, 100] };

const ACTIONS: DeviceAction[] = [
  { id: "a1", kind: "SERVO", rule: "Soil < 22% → open irrigation valve, 5 min", via: "micro-servo on GPIO 14", enabled: true },
  { id: "a2", kind: "API", rule: "Canopy > 30°C → start exhaust fan", via: "via smart plug API", enabled: true },
  { id: "a3", kind: "ALERT", rule: "Still dry after 2 cycles → text me", via: "guardrail — human takes over", enabled: false },
];

describe("LineChartCard", () => {
  const widget = { id: "w", type: "line_chart", channel: "soil_vwc", window: "24h", threshold: { value: 22, label: "dry threshold · 22%" } } as const;
  const series: Series = { channel: "soil_vwc", bucket: "1h", points: [42, 31.2].map((v) => ({ t: AT, v })) };

  it("renders the label, the current value with its unit, the threshold and the line", () => {
    const html = renderToStaticMarkup(<LineChartCard widget={widget} channel={soil} latest={{ v: 31.2, t: AT }} series={series} />);
    expect(html).toContain("Soil moisture · last 24h");
    expect(html).toMatch(/31\.2<span[^>]*> % VWC<\/span>/);
    expect(html).toContain("dry threshold · 22%");
    expect(html).toContain('points="0,40 600,94"');
  });

  it("shows awaiting first reading and no line for a device that hasn't reported", () => {
    const html = renderToStaticMarkup(<LineChartCard widget={widget} channel={soil} latest={undefined} series={undefined} />);
    expect(html).toContain("Awaiting first reading");
    expect(html).not.toContain("<polyline");
    expect(html).toContain("dry threshold · 22%");
  });
});

describe("StatTile", () => {
  it("formats the value, and colours the caption when it's marked success", () => {
    const html = renderToStaticMarkup(
      <StatTile
        widget={{ id: "b", type: "stat", channel: "battery", caption: "solar charging", caption_tone: "success" }}
        channel={battery}
        latest={{ v: 87, t: AT }}
      />,
    );
    expect(html).toContain(">87%<");
    expect(html).toMatch(/text-success[^>]*>solar charging/);
  });

  it("hides the caption and shows awaiting without a reading", () => {
    const html = renderToStaticMarkup(
      <StatTile widget={{ id: "b", type: "stat", channel: "battery", caption: "solar charging" }} channel={battery} latest={undefined} />,
    );
    expect(html).toContain("Awaiting first reading");
    expect(html).not.toContain("solar charging");
  });
});

describe("ClosedLoopActions", () => {
  it("renders each rule with its kind pill, and the toggles start on, on, off", () => {
    const html = renderToStaticMarkup(<ClosedLoopActions actions={ACTIONS} lastAction="yesterday 06:12" />);
    expect(html).toContain("Closed loop · actions");
    expect(html).toContain("last action: yesterday 06:12");
    expect(html.match(/aria-checked="(true|false)"/g)).toEqual(['aria-checked="true"', 'aria-checked="true"', 'aria-checked="false"']);
    expect(html).toMatch(/bg-pastel-green[^>]*>SERVO/);
    expect(html).toMatch(/bg-pastel-blue[^>]*>API/);
    expect(html).toMatch(/bg-pastel-peach[^>]*>ALERT/);
    expect(html).toContain("+ New action");
  });
});

describe("Toggle", () => {
  const findButton = (node: ReactNode) => node as ReactElement<{ onClick: () => void; "aria-checked": boolean; className: string; children: ReactNode }>;

  it("is a switch: green with the knob right when on, grey with the knob left when off", () => {
    expect(renderToStaticMarkup(<Toggle checked label="x" onChange={() => {}} />)).toMatch(/role="switch" aria-checked="true".*bg-success.*left-\[21px\]/);
    expect(renderToStaticMarkup(<Toggle checked={false} label="x" onChange={() => {}} />)).toMatch(/aria-checked="false".*bg-hairline.*left-\[3px\]/);
  });

  it("calls onChange when clicked", () => {
    const onChange = vi.fn();
    const button = findButton(Toggle({ checked: true, label: "x", onChange }));
    expect(isValidElement(button)).toBe(true);
    button.props.onClick();
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
