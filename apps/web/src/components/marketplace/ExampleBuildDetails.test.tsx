import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXAMPLE_BUILDS, exampleBuildDetail, exampleListings } from "@/lib/example-builds";
import { BuildCircuitDiagram, wrapName } from "./BuildCircuitDiagram";
import { ExampleBuildDetails } from "./ExampleBuildDetails";
import { MarketplaceView } from "./MarketplaceView";
import { exampleWiring } from "@/lib/example-wiring";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("ExampleBuildDetails", () => {
  it("says the build is real and the numbers are sample data", () => {
    const html = text(renderToStaticMarkup(<ExampleBuildDetails detail={exampleBuildDetail("fridge-monitor")!} />));
    expect(html).toContain("Example build");
    expect(html).toContain("This build is real");
    expect(html).toContain("readings, author and clone count are sample data");
  });

  it("lists each registry part with its quantity and price, and says which are not priced yet", () => {
    const html = text(renderToStaticMarkup(<ExampleBuildDetails detail={exampleBuildDetail("greenhouse-soil-monitor")!} />));
    expect(html).toContain("4 × Capacitive Soil Moisture Probe (DFRobot SEN0193) P-005");
    expect(html).toContain("$23.60");
    expect(html).toContain("TP4056 Li-ion Charger Module E-004 price pending");
    expect(html).toContain("Parts from $53.50 (1 not priced yet) · powered by the 18650 Li-ion Battery, 2200 mAh");
  });

  it("draws the wiring with the pin each lead lands on and the volts it carries", () => {
    const html = text(renderToStaticMarkup(<ExampleBuildDetails detail={exampleBuildDetail("fridge-monitor")!} />));
    expect(html).toContain("Wiring");
    // The battery on the 5V pin, the regulator's rail, and the two sensors on the shared I2C bus.
    expect(html).toContain("2.5–4.2 V");
    expect(html).toContain("5v-pin");
    expect(html).toContain("3V3 rail 3.251–3.349 V");
    expect(html).toContain("GPIO8");
    expect(html).toContain("I²C 0x77");
    expect(html).toContain("I²C 0x68");
    expect(html).toContain("3 SDA");
    expect(html).toContain("Which header pin each lead lands on is our suggestion");
  });

  it("wires a 5 V peripheral to the supply, and says where the servo's current comes from", () => {
    const html = text(renderToStaticMarkup(<ExampleBuildDetails detail={exampleBuildDetail("plant-waterer")!} />));
    expect(html).toContain("PWM");
    expect(html).toContain("4.845–5.355 V");
    expect(html).toContain("stall current (600 mA) comes from the supply, not the brain");
  });

  it("tables the sample readings with their UTC times, units and part ids", () => {
    const markup = renderToStaticMarkup(<ExampleBuildDetails detail={exampleBuildDetail("greenhouse-soil-monitor")!} />);
    const html = text(markup);
    expect(markup).toContain('dateTime="2026-09-13T09:00:00.000Z"');
    expect(html).toContain("2026-09-13 08:10:00 UTC");
    expect(html).toContain("Bed 1 % P-005");
    expect(html).toContain("one row every 10 min");
    expect(html).toContain("not a reading from a built device");
  });

  it("a fully priced build states the parts total without 'from'", () => {
    const html = text(renderToStaticMarkup(<ExampleBuildDetails detail={exampleBuildDetail("cold-room-temperature-log")!} />));
    expect(html).toContain("Parts $38.64 · powered by the USB-C 5.1 V 3 A Power Supply");
  });
});

describe("BuildCircuitDiagram", () => {
  it("describes the whole wiring for a reader who can't see it", () => {
    const build = EXAMPLE_BUILDS.find((b) => b.id === "presence-alert")!;
    const html = renderToStaticMarkup(<BuildCircuitDiagram wiring={exampleWiring(build)} buildName={build.name} />);
    const label = /aria-label="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(label).toContain("Presence alert wiring.");
    expect(label).toContain("USB-C 5.1 V 3 A Power Supply at 4.845–5.355 V feeds");
    expect(label).toContain("wired VCC to 5V, GND to GND, SIG to GPIO5");
  });

  it("breaks a long part name over two lines rather than cutting it", () => {
    expect(wrapName("BME280 Temperature, Humidity and Pressure Sensor", 37)).toEqual(["BME280 Temperature, Humidity and", "Pressure Sensor"]);
    expect(wrapName("SG90 Micro Servo", 37)).toEqual(["SG90 Micro Servo"]);
  });
});

describe("MarketplaceView with example builds", () => {
  it("labels the page as example builds, and each card opens its build", () => {
    const { listings } = exampleListings(null);
    const html = renderToStaticMarkup(<MarketplaceView listings={listings} category={null} cursor={null} nextCursor={null} examples />);
    expect(html).toContain("Example builds");
    expect(html).not.toContain("Community builds");
    for (const { id } of listings) expect(html).toContain(`href="/marketplace/${id}"`);
  });

  it("gateway's listings keep the community header", () => {
    const html = renderToStaticMarkup(<MarketplaceView listings={[]} category={null} cursor={null} nextCursor={null} />);
    expect(html).toContain("Community builds");
  });
});
