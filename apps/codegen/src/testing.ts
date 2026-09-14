import { CAMERA_CANDIDATE } from './camera-candidate';
import { canonicalDigest, type CameraPlanApproval } from './accepted-candidate';
/** SYNTHETIC acceptance fixtures only. Never import from production handlers or activate registry rows. */
import { readFileSync } from "node:fs";
import {
  BuildPlanMetadata,
  BuildPlanV1,
  PartDefinition,
  serializeBuildPlanInput,
} from "@albusforge/schema";
import { CANDIDATE, FREENOVE_CANDIDATE, RUNTIME, SENSORS, type SensorKey } from "./candidate";
import { sha256 } from "./compiler";
export function syntheticPlanFixture() {
  const spec = {
    sense: { what: ["light"], interval_s: 60 },
    environment: { location: "indoors", flags: [] },
    connect: { transport: "wifi", experience: [] },
    power: { source: "usb" },
    experience: {},
    capabilities: ["read.illuminance_lux"],
    assumptions: [],
    open_questions: [],
    settled: true,
  };
  const parts = ["C-001", "E-005", "V-005"].map((id) => {
    const part = JSON.parse(
      readFileSync(
        new URL(`../../../registry/parts/${id}/part.json`, import.meta.url),
        "utf8",
      ),
    );
    return PartDefinition.parse({
      ...part,
      status: "active",
      mechanical: {
        ...part.mechanical,
        bounding_mm: [20, 10, 5],
        mount: { type: "cradle" },
      },
    });
  });
  const pin = (id: string) => ({ id, version: "1.0.0" });
  const wiring = {
    source: pin("E-005"),
    brain: pin("C-001"),
    brain_input: "usb-micro-b-v1",
    peripherals: [
      {
        part: pin("V-005"),
        port: "i2c",
        rail: "brain",
        connector: "hsx-i2c-4pin-v1",
        resources: ["GPIO8", "GPIO9"],
      },
    ],
  };
  const profile = {
    id: CANDIDATE,
    version: "1.0.0",
    evidence: "SYNTHETIC software test fixture, not physical approval",
    brain: pin("C-001"),
    source: pin("E-005"),
    source_connector: "usb-c-v1",
    brain_input: "usb-micro-b-v1",
    regulator_efficiency: 0.9,
    quiescent_source_ma: 0,
    battery_usable_fraction: 0.8,
    ports: [
      {
        id: "i2c",
        interface: "i2c",
        connector: "hsx-i2c-4pin-v1",
        rail: "brain",
        max_current_ma: 100,
        resources: ["GPIO8", "GPIO9"],
        capacity: 2,
      },
    ],
    activity: [],
  };
  const metadata = {
    schema_version: 1,
    runtime: "0.1.0",
    profile: { id: CANDIDATE, version: "1.0.0" },
    total_cost_usd: 30,
    input_digest: "a".repeat(64),
    evidence: {
      parts,
      connectors: [],
      profile,
      compat: [
        {
          driver_pkg: "hsx-driver-bh1750",
          driver_ver: "0.1.0",
          runtime_ver: "0.1.0",
          brain_id: "C-001",
          status: "passed",
        },
      ],
    },
  };
  metadata.input_digest = sha256(
    serializeBuildPlanInput({
      spec,
      runtime: metadata.runtime,
      evidence: BuildPlanMetadata.parse(metadata).evidence,
    }),
  );
  return { spec, parts, wiring, metadata };
}

/** Synthetic wiring approval for resolver/worker tests; never registry data. */
export function syntheticCameraPlanFixture() {
  const f=syntheticPlanFixture();
  f.spec.sense={what:['image'],interval_s:900};f.spec.capabilities=['capture.image'];
  f.metadata.runtime='0.3.0';f.metadata.profile={id:'synthetic-camera-assembly',version:'1.0.0'};
  f.metadata.evidence.profile={...f.metadata.evidence.profile,id:f.metadata.profile.id};
  f.metadata.evidence.compat=f.metadata.evidence.compat.map(c=>({...c,runtime_ver:'0.3.0'}));
  // Test-only snapshot mutation stands in for reviewed camera registry evidence.
  f.metadata.evidence.profile.evidence='SYNTHETIC camera compiler test, not hardware approval';
  const metadata=BuildPlanMetadata.parse(f.metadata);
  metadata.input_digest=sha256(serializeBuildPlanInput({spec:f.spec,runtime:metadata.runtime,evidence:metadata.evidence}));
  const plan=BuildPlanV1.parse({part_versions:f.parts.map(({id,version})=>({id,version})),wiring_graph:f.wiring,
    power_budget:{average_source_ma:50,peak_source_ma:400,peak_brain_rail_ma:400,usable_capacity_mah:null,estimated_life_days:null},
    bom:f.parts.map(({id,version})=>({part:{id,version},quantity:1 as const,unit_cost_usd:10})),solver_log:[],runtime:metadata.runtime,profile:metadata.profile,total_cost_usd:30});
  return {...f,metadata,plan};
}

export function syntheticCameraApproval(f:ReturnType<typeof syntheticCameraPlanFixture>):CameraPlanApproval {
  return {candidate_id:CAMERA_CANDIDATE,assembly_profile:f.plan.profile,part_versions:f.plan.part_versions,evidence_sha256:canonicalDigest(f.metadata.evidence),wiring_sha256:canonicalDigest(f.plan.wiring_graph)};
}

/** SYNTHETIC Freenove fixture. The Freenove board (C-002), the promoted part
 * versions and the seesaw soil part (P-006) are not in this worktree's
 * registry, so their definitions are derived here from the closest committed
 * part and marked synthetic. Never a substitute for reviewed registry rows. */
const FREENOVE_TEMPLATE_PART: Record<string, string> = {
  "C-002": "C-001",
  "E-005": "E-005",
  "V-005": "V-005",
  "P-001": "P-001",
  "P-006": "P-001",
};
function syntheticPart(pin: { id: string; version: string }, sensor?: SensorKey) {
  const part = JSON.parse(
    readFileSync(
      new URL(`../../../registry/parts/${FREENOVE_TEMPLATE_PART[pin.id] ?? pin.id}/part.json`, import.meta.url),
      "utf8",
    ),
  );
  return PartDefinition.parse({
    ...part,
    id: pin.id,
    version: pin.version,
    status: "active",
    mechanical: { ...part.mechanical, bounding_mm: [20, 10, 5], mount: { type: "cradle" } },
    ...(sensor
      ? {
          electrical: { ...part.electrical, i2c_address: SENSORS[sensor].i2c_address },
          software: { ...part.software, driver_pkg: SENSORS[sensor].driver_pkg, driver_version: "0.1.0" },
        }
      : {}),
  });
}
export function syntheticFreenovePlanFixture(
  sensors: readonly SensorKey[] = ["bh1750", "bme280"],
) {
  const candidate = FREENOVE_CANDIDATE;
  const options = sensors.map((sensor) => {
    const option = candidate.peripherals.find((p) => p.sensor === sensor);
    if (!option) throw new Error(`No Freenove peripheral for ${sensor}`);
    return option;
  });
  const parts = [
    syntheticPart(candidate.brain),
    syntheticPart(candidate.source),
    ...options.map((option) => syntheticPart(option.part, option.sensor)),
  ];
  const spec = {
    sense: { what: ["light"], interval_s: 60 },
    environment: { location: "indoors", flags: [] },
    connect: { transport: "wifi", experience: [] },
    power: { source: "usb" },
    experience: {},
    capabilities: ["read.illuminance_lux"],
    assumptions: [],
    open_questions: [],
    settled: true,
  };
  const wiring = {
    source: { ...candidate.source },
    brain: { ...candidate.brain },
    brain_input: "usb-micro-b-v1",
    peripherals: options.map((option) => ({
      part: { ...option.part },
      port: option.connectors[0] === "hsx-i2c-4pin-v1" ? "i2c" : "i2c-stemma",
      rail: "brain",
      connector: option.connectors[0]!,
      resources: [...candidate.resources],
    })),
  };
  const profile = {
    id: candidate.id,
    version: candidate.profile_version,
    evidence: "SYNTHETIC software test fixture, not physical approval",
    brain: { ...candidate.brain },
    source: { ...candidate.source },
    source_connector: "usb-c-v1",
    brain_input: "usb-micro-b-v1",
    regulator_efficiency: 0.9,
    quiescent_source_ma: 0,
    battery_usable_fraction: 0.8,
    ports: [
      {
        id: "i2c",
        interface: "i2c",
        connector: "hsx-i2c-4pin-v1",
        rail: "brain",
        max_current_ma: 100,
        resources: [...candidate.resources],
        capacity: 4,
      },
      {
        id: "i2c-stemma",
        interface: "i2c",
        connector: "stemma-i2c-ph-4pin-v1",
        rail: "brain",
        max_current_ma: 100,
        resources: [...candidate.resources],
        capacity: 4,
      },
    ],
    activity: [],
  };
  const metadata = {
    schema_version: 1,
    runtime: RUNTIME,
    profile: { id: candidate.id, version: candidate.profile_version },
    total_cost_usd: 45,
    input_digest: "a".repeat(64),
    evidence: {
      parts,
      connectors: [],
      profile,
      compat: options.map((option) => ({
        driver_pkg: SENSORS[option.sensor].driver_pkg,
        driver_ver: option.driver_ver,
        runtime_ver: RUNTIME,
        brain_id: candidate.brain.id,
        status: "passed",
      })),
    },
  };
  metadata.input_digest = sha256(
    serializeBuildPlanInput({
      spec,
      runtime: metadata.runtime,
      evidence: BuildPlanMetadata.parse(metadata).evidence,
    }),
  );
  const plan = BuildPlanV1.parse({
    part_versions: parts.map(({ id, version }) => ({ id, version })),
    wiring_graph: wiring,
    power_budget: {
      average_source_ma: 60,
      peak_source_ma: 400,
      peak_brain_rail_ma: 400,
      usable_capacity_mah: null,
      estimated_life_days: null,
    },
    bom: parts.map(({ id, version }) => ({ part: { id, version }, quantity: 1 as const, unit_cost_usd: 10 })),
    solver_log: [],
    runtime: metadata.runtime,
    profile: metadata.profile,
    total_cost_usd: 45,
  });
  return { spec, parts, wiring, metadata: BuildPlanMetadata.parse(metadata), plan };
}
