import { describe, it, expect } from "vitest";
import { editInterval, renderApp, sha256 } from "./compiler";
import {
  FirmwareManifest,
  serializeFirmwareManifest,
} from "@albusforge/schema";
describe("bounded firmware app edits", () => {
  it("renders only the supported SDK call", () => {
    expect(renderApp(editInterval("Set interval to 120 seconds"))).toBe(
      '#include "hsx-sdk.h"\nextern "C" void app_main(void) { hsx_run(120); }\n',
    );
  });
  it("refuses arbitrary source/shell and unsupported frequencies", () => {
    for (const instruction of [
      "#include <stdlib.h>",
      "set interval to 0 seconds",
      "set interval to 86401 seconds",
      "set interval to 1; rm -rf / seconds",
    ])
      expect(() => editInterval(instruction)).toThrow();
    for (const interval of [0, 9, 86401, NaN, Infinity, 10.5])
      expect(() => renderApp(interval)).toThrow();
  });
  it("serializes manifest fields deterministically for cross-language byte hashing", () => {
    const manifest = FirmwareManifest.parse({
      v: 1,
      build_id: "11111111-1111-4111-8111-111111111111",
      plan_version: 1,
      code_version: 1,
      profile_id: "fixture",
      runtime: "0.1.0",
      channels: { illuminance: { unit: "lux", min: 0, max: 65535 } },
      files: ["bootloader.bin", "partition-table.bin", "albusforge.bin"].map(
        (path) => ({ path, size: 1, sha256: "a".repeat(64) }),
      ),
      flash: { chip: "esp32s3", config_offset: 36864, config_size: 24576 },
    });
    expect(serializeFirmwareManifest(manifest)).toBe(
      serializeFirmwareManifest(
        Object.fromEntries(
          Object.entries(manifest).reverse(),
        ) as typeof manifest,
      ),
    );
    expect(sha256(serializeFirmwareManifest(manifest))).toHaveLength(64);
  });
});

import { candidateInterval } from "./candidate";
import { syntheticPlanFixture } from "./testing";
import { Spec } from "@albusforge/schema";
it("requires the exact immutable host, source and physical port tuple", () => {
  const fixture = syntheticPlanFixture();
  const plan = {
    part_versions: fixture.parts.map(({ id, version }) => ({ id, version })),
    wiring_graph: fixture.wiring,
    power_budget: {
      average_source_ma: 50,
      peak_source_ma: 400,
      peak_brain_rail_ma: 400,
      usable_capacity_mah: null,
      estimated_life_days: null,
    },
    bom: fixture.parts.map(({ id, version }) => ({
      part: { id, version },
      quantity: 1,
      unit_cost_usd: 10,
    })),
    solver_log: [],
    runtime: "0.1.0",
    profile: { id: fixture.metadata.profile.id, version: "1.0.0" },
    total_cost_usd: 30,
  };
  expect(
    candidateInterval(plan, fixture.metadata, Spec.parse(fixture.spec)),
  ).toBe(60);
  const wrongHost = structuredClone(plan);
  wrongHost.wiring_graph.brain.version = "2.0.0";
  expect(() =>
    candidateInterval(wrongHost, fixture.metadata, Spec.parse(fixture.spec)),
  ).toThrow();
  const wrongProfile = structuredClone(fixture.metadata);
  wrongProfile.evidence.profile.ports[0]!.resources = ["GPIO9", "GPIO8"];
  expect(() =>
    candidateInterval(plan, wrongProfile, Spec.parse(fixture.spec)),
  ).toThrow();
});
