import { describe, expect, it } from "vitest";
import { Spec } from "@albusforge/schema";
import {
  DEVKITC_CANDIDATE,
  FREENOVE_CANDIDATE,
  NUMERIC_CANDIDATES,
  SENSORS,
  numericProfileHeader,
  selectNumericCandidate,
} from "./candidate";
import { resolveAcceptedCandidate } from "./accepted-candidate";
import { syntheticFreenovePlanFixture, syntheticPlanFixture } from "./testing";
const select = (f: ReturnType<typeof syntheticFreenovePlanFixture>) =>
  selectNumericCandidate(f.plan, f.metadata, Spec.parse(f.spec));
describe("Freenove numeric candidate", () => {
  it("compiles one or more I2C sensors on the reviewed GPIO47/GPIO21 bus", () => {
    const one = select(syntheticFreenovePlanFixture(["bh1750"]));
    expect(one.candidate.id).toBe("freenove-esp32s3-n16r8-i2c-usb-v1");
    expect([one.candidate.sda, one.candidate.scl]).toEqual([47, 21]);
    expect(one.channels).toEqual({ illuminance: { unit: "lux", min: 0, max: 65535 } });
    const three = select(syntheticFreenovePlanFixture(["bh1750", "bme280", "seesaw_soil"]));
    expect(Object.keys(three.channels).sort()).toEqual([
      "humidity", "illuminance", "pressure", "soil_moisture", "temperature",
    ]);
    expect(three.interval_s).toBe(60);
    const environment = select(syntheticFreenovePlanFixture(["bme280"]));
    expect(environment.channels).toEqual({
      temperature: { unit: "degC", min: -40, max: 85 },
      humidity: { unit: "%RH", min: 0, max: 100 },
      pressure: { unit: "hPa", min: 300, max: 1100 },
    });
  });
  it("reaches the same selection through the accepted-plan resolver", () => {
    const f = syntheticFreenovePlanFixture(["bh1750", "bme280"]);
    const candidate = resolveAcceptedCandidate(f.plan, f.metadata, Spec.parse(f.spec));
    expect(candidate).toMatchObject({
      id: FREENOVE_CANDIDATE.id, kind: "numeric", runtime: "0.1.0",
      interval_s: 60, template: "esp32s3",
    });
    expect(Object.keys(candidate.channels)).toContain("humidity");
    expect(candidate.capabilities).toBeUndefined();
  });
  it("writes the board's own pins and sensor set into the firmware profile header", () => {
    const header = numericProfileHeader(select(syntheticFreenovePlanFixture(["bh1750", "bme280"])));
    expect(header).toContain('#define HSX_PROFILE_ID "freenove-esp32s3-n16r8-i2c-usb-v1"');
    expect(header).toContain('#define HSX_RUNTIME "0.1.0"');
    expect(header).toContain("#define HSX_SDA 47");
    expect(header).toContain("#define HSX_SCL 21");
    expect(header).toContain("#define HSX_SENSOR_BH1750 1");
    expect(header).toContain("#define HSX_SENSOR_BME280 1");
    expect(header).toContain("#define HSX_SENSOR_SEESAW_SOIL 0");
    const devkitc = numericProfileHeader(
      selectNumericCandidate(
        { ...syntheticPlanFixtureAsPlan() },
        syntheticPlanFixture().metadata,
        Spec.parse(syntheticPlanFixture().spec),
      ),
    );
    expect(devkitc).toContain("#define HSX_SDA 8");
    expect(devkitc).toContain("#define HSX_SCL 9");
    expect(devkitc).toContain("#define HSX_SENSOR_BME280 0");
  });
  it("refuses camera-conflicting pins, foreign parts, inactive rows and missing compatibility", () => {
    const cases: ((f: ReturnType<typeof syntheticFreenovePlanFixture>) => void)[] = [
      (f) => { f.plan.wiring_graph.peripherals[0]!.resources = ["GPIO8", "GPIO9"]; },
      (f) => { f.metadata.evidence.profile.ports[0]!.resources = ["GPIO8", "GPIO9"]; },
      (f) => { f.metadata.evidence.profile.ports[0]!.resources = ["GPIO21", "GPIO47"]; },
      (f) => { f.plan.wiring_graph.peripherals[0]!.part.id = "P-004"; },
      (f) => { f.plan.wiring_graph.peripherals[0]!.part.version = "9.9.9"; },
      (f) => { f.plan.wiring_graph.brain.id = "C-001"; },
      (f) => { f.plan.wiring_graph.peripherals[0]!.rail = "source"; },
      (f) => { f.plan.wiring_graph.peripherals = []; },
      (f) => { f.plan.wiring_graph.peripherals.push({ ...f.plan.wiring_graph.peripherals[0]! }); },
      (f) => { f.metadata.evidence.parts[0]!.status = "draft"; },
      (f) => { f.metadata.evidence.compat = []; },
      (f) => { f.metadata.evidence.compat[0]!.status = "pending"; },
      (f) => { f.metadata.evidence.compat[0]!.driver_ver = "0.2.0"; },
      (f) => { f.metadata.evidence.compat[0]!.runtime_ver = "0.2.0"; },
      (f) => { f.plan.runtime = "0.2.0"; },
      (f) => { f.plan.profile.version = "2.0.0"; },
      (f) => { f.spec.power.source = "battery"; },
      (f) => { f.spec.connect.transport = "ble"; },
      (f) => { f.spec.sense.interval_s = 5; },
      (f) => { f.metadata.evidence.parts[2]!.software.driver_pkg = "hsx-driver-elsewhere"; },
      (f) => { f.plan.wiring_graph.peripherals[0]!.connector = "stemma-i2c-ph-4pin-v1"; },
      (f) => { f.plan.wiring_graph.peripherals[0]!.connector = "hsx-3pin-v1"; },
      (f) => { f.metadata.evidence.profile.ports[0]!.connector = "hsx-3pin-v1"; },
    ];
    for (const [index, mutate] of cases.entries()) {
      const f = syntheticFreenovePlanFixture(["bh1750", "bme280"]);
      mutate(f);
      expect(() => select(f), `case ${index}`).toThrow("no supported firmware compiler profile");
    }
  });
  it("wires the seesaw soil sensor through either STEMMA connector", () => {
    const soil = syntheticFreenovePlanFixture(["seesaw_soil"]);
    expect(soil.plan.wiring_graph.peripherals[0]!.connector).toBe("stemma-i2c-ph-4pin-v1");
    expect(select(soil).channels).toEqual({ soil_moisture: { unit: "raw", min: 0, max: 4095 } });
    const adapted = syntheticFreenovePlanFixture(["seesaw_soil"]);
    adapted.plan.wiring_graph.peripherals[0]!.connector = "hsx-i2c-4pin-v1";
    adapted.plan.wiring_graph.peripherals[0]!.port = "i2c";
    expect(select(adapted).sensors).toEqual(["seesaw_soil"]);
  });
  it("keeps the allow-list explicit rather than open", () => {
    expect(NUMERIC_CANDIDATES.map((c) => c.id)).toEqual([
      "esp32s3-bh1750-usb-v1", "freenove-esp32s3-n16r8-i2c-usb-v1",
    ]);
    const f = syntheticFreenovePlanFixture(["bh1750"]);
    f.plan.profile.id = "freenove-esp32s3-n16r8-something-else";
    f.metadata.profile.id = f.plan.profile.id;
    f.metadata.evidence.profile.id = f.plan.profile.id;
    expect(() => select(f)).toThrow();
    expect(DEVKITC_CANDIDATE.peripherals).toHaveLength(1);
    expect(Object.keys(SENSORS)).toEqual(["bh1750", "bme280", "seesaw_soil"]);
  });
});
function syntheticPlanFixtureAsPlan() {
  const fixture = syntheticPlanFixture();
  return {
    part_versions: fixture.parts.map(({ id, version }) => ({ id, version })),
    wiring_graph: fixture.wiring,
    power_budget: {
      average_source_ma: 50, peak_source_ma: 400, peak_brain_rail_ma: 400,
      usable_capacity_mah: null, estimated_life_days: null,
    },
    bom: fixture.parts.map(({ id, version }) => ({ part: { id, version }, quantity: 1, unit_cost_usd: 10 })),
    solver_log: [], runtime: "0.1.0",
    profile: { id: fixture.metadata.profile.id, version: "1.0.0" },
    total_cost_usd: 30,
  };
}
