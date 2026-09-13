import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { exampleBuildDetail, exampleListings } from "@/lib/example-builds";
import { ExampleBuildDetails } from "./ExampleBuildDetails";
import { MarketplaceView } from "./MarketplaceView";

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

  it("a fully priced build states the parts total without 'from'", () => {
    const html = text(renderToStaticMarkup(<ExampleBuildDetails detail={exampleBuildDetail("cold-room-temperature-log")!} />));
    expect(html).toContain("Parts $38.64 · powered by the USB-C 5.1 V 3 A Power Supply");
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
