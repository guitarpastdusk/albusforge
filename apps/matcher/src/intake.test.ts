import { expect, it } from "vitest";
import { fromIntakeSpec } from "./intake";

const spec = () => ({ settled: true, capabilities: ["read.temperature_c"],
  sense: { what: ["temperature"], interval_s: 60 }, act: { what: [] },
  environment: { location: "indoors", flags: [] }, connect: { transport: "wifi", experience: [] },
  power: { source: "usb" }, experience: { dashboard: true }, assumptions: [], open_questions: [] });

it("accepts the M2 structured spec without mapping prose to part ids", () => {
  expect(fromIntakeSpec(spec(), "0.1.0")).toEqual({ capabilities: ["read.temperature_c"], interval_s: 60, transport: "wifi", power_source: "usb", runtime: "0.1.0" });
});
it("refuses an unsettled, incomplete or environmentally constrained spec", () => {
  expect(() => fromIntakeSpec({ ...spec(), settled: false }, "0.1.0")).toThrow();
  expect(() => fromIntakeSpec({ ...spec(), sense: {} }, "0.1.0")).toThrow();
  expect(() => fromIntakeSpec({ ...spec(), power: { source: "unknown" } }, "0.1.0")).toThrow();
  expect(() => fromIntakeSpec({ ...spec(), environment: { flags: ["waterproof"] } }, "0.1.0")).toThrow();
  expect(() => fromIntakeSpec({ ...spec(), sense: { interval_s: 60, accuracy: "0.1 C" } }, "0.1.0")).toThrow();
});
