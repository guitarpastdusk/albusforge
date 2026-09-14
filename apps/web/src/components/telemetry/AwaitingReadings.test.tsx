import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AwaitingReadings } from "./AwaitingReadings";

describe("AwaitingReadings", () => {
  it("says what will appear, links to setup, and shows sample readings labelled as not from this device", () => {
    const html = renderToStaticMarkup(<AwaitingReadings deviceId="dev 1" revoked={false} />);
    expect(html).toContain("Waiting for the first reading");
    expect(html).toContain('href="/setup?device=dev%201"');
    expect(html).toContain("Sample readings");
    expect(html).toContain("These are not from this device.");
    expect(html).toContain("<table");
  });

  it("a revoked device is told nothing new arrives, without the checklist", () => {
    const html = renderToStaticMarkup(<AwaitingReadings deviceId="dev-1" revoked />);
    expect(html).toContain("credential is revoked");
    expect(html).not.toContain("Power and Wi-Fi");
  });
});
