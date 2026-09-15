import { AssemblyProfile, ConnectorDefinition, PartDefinition, usableWindow } from "@albusforge/schema";
import assemblyJson from "../../../../registry/assembly-profiles.json";
import provisioningJson from "../../../../registry/provisioning-profiles.json";
import c002 from "../../../../registry/parts/C-002/part.json";
import p006 from "../../../../registry/parts/P-006/part.json";
import stemmaPh from "../../../../registry/connectors/stemma-i2c-ph-4pin-v1.json";
import { EXAMPLE_PARTS } from "./example-builds";
import { acceptsChain, CONNECTORS, type Wiring, type WiringLead, type WiringNode } from "./example-wiring";

/*
 * The wiring of a device that was actually provisioned, for the setup page.
 *
 * Unlike the marketplace diagrams, the header pins here are NOT ours to choose:
 * they come from the assembly profile the device was built against
 * (registry/assembly-profiles.json). That matters more than it sounds. The
 * Freenove board's profile puts sensor I2C on GPIO47/GPIO21 and says why —
 * "GPIO8 and GPIO9 are camera data pins D2 and D1 on this board". Drawing the
 * marketplace's default GPIO8/9 here would tell someone to wire a sensor onto
 * the camera's data lines.
 *
 * What is inferred rather than known: which profile a device was built
 * against. DeviceSetupStatus carries no profile id, so the device's channel
 * keys are matched against each profile's. Good enough to draw for a demo, and
 * the diagram says so; the honest fix is to put the provisioning profile id on
 * the setup status.
 */

/** Parts the portal bundles, plus the ones only a provisioned device uses. */
const PARTS: ReadonlyMap<string, PartDefinition> = new Map([
  ...EXAMPLE_PARTS,
  ...[c002, p006].map((json) => {
    const part = PartDefinition.parse(json);
    return [part.id, part] as const;
  }),
]);

const ALL_CONNECTORS: ReadonlyMap<string, ConnectorDefinition> = new Map([
  ...CONNECTORS,
  [ConnectorDefinition.parse(stemmaPh).id, ConnectorDefinition.parse(stemmaPh)] as const,
]);

const ASSEMBLIES = (assemblyJson as { profiles: unknown[] }).profiles.map((profile) => AssemblyProfile.parse(profile));

interface ProvisioningProfile {
  id: string;
  assembly_profile: { id: string; version: string };
  part_versions: { id: string; version: string }[];
  channels: { key: string; part: { id: string } }[];
}

const PROVISIONING = provisioningJson as unknown as ProvisioningProfile[];

/**
 * The one profile this device was built against, or null when that cannot be
 * told apart.
 *
 * Covering is not enough to identify a build. A device reporting only
 * `illuminance` is covered by both `freenove-light` and
 * `freenove-light-climate`; taking the first would draw a BME280 that is not on
 * the bench. So an exact channel set wins, and a merely-covering match is used
 * only when exactly one profile covers. Anything ambiguous draws nothing: a
 * "demo diagram" label excuses an approximation, never an extra physical part.
 */
export function profileForChannels(channels: readonly string[]): ProvisioningProfile | null {
  if (channels.length === 0) return null;
  const wanted = new Set(channels);
  const keysOf = (profile: ProvisioningProfile) => new Set(profile.channels.map((channel) => channel.key));
  const exact = PROVISIONING.filter((profile) => {
    const keys = keysOf(profile);
    return keys.size === wanted.size && [...wanted].every((key) => keys.has(key));
  });
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const covering = PROVISIONING.filter((profile) => {
    const keys = keysOf(profile);
    return [...wanted].every((key) => keys.has(key));
  });
  return covering.length === 1 ? covering[0]! : null;
}

/**
 * Rail and ground pin names, per brain.
 *
 * The AssemblyProfile schema carries signal `resources` but no rail pin names,
 * so these are not derived — they are read off the board and recorded here. Not
 * a registry guarantee and not "every ESP32 board": a brain absent from this map
 * draws nothing, rather than assuming labels the way the GPIO8/9 default did.
 */
const RAILS: Record<string, { rail: string; ground: string }> = {
  // Freenove ESP32-S3-WROOM CAM (N16R8): 3V3 and GND on the header silkscreen.
  "C-002": { rail: "3V3", ground: "GND" },
};

/**
 * The wiring for a provisioned device, drawn from its assembly profile's real
 * ports. Null when the device's channels match no profile, or the profile names
 * parts the portal doesn't bundle — a partial diagram would hide a part.
 */
export function provisionedWiring(channels: readonly string[]): Wiring | null {
  const profile = profileForChannels(channels);
  if (!profile) return null;
  return wiringForParts(profile.part_versions.map(({ id }) => id), profile.assembly_profile.id);
}

/**
 * The wiring for an explicit part list on a named assembly profile. Separated
 * from profile matching so the demo's bench layout, which is written down
 * rather than inferred, still draws through exactly the same derivation — the
 * pins come from the assembly profile either way.
 */
export function wiringForParts(partIds: readonly string[], assemblyId: string): Wiring | null {
  const assembly = ASSEMBLIES.find((candidate) => candidate.id === assemblyId);
  if (!assembly) return null;
  if (!partIds.every((id) => PARTS.has(id))) return null;
  const profile = { part_versions: partIds.map((id) => ({ id, version: "" })) };

  const brain = PARTS.get(assembly.brain.id);
  const supplyPart = PARTS.get(assembly.source.id);
  if (!brain || !supplyPart) return null;
  const rail = brain.electrical.supply?.output_v;
  const logic = brain.electrical.logic_v;
  const output = supplyPart.electrical.supply?.output_v;
  if (!rail || !logic || !output) return null;

  const connectorOf = (part: PartDefinition) => ALL_CONNECTORS.get(part.electrical.connector);
  const brainConnector = connectorOf(brain);
  const supplyConnector = ALL_CONNECTORS.get(assembly.source_connector) ?? connectorOf(supplyPart);
  if (!brainConnector || !supplyConnector) return null;

  const peripherals = profile.part_versions
    .filter(({ id }) => id !== brain.id && id !== supplyPart.id)
    .map(({ id }) => PARTS.get(id)!)
    .filter((part) => part.electrical.interface !== "power");

  // The bus pins the profile actually allocated, rather than a default pin map.
  const portFor = (part: PartDefinition) =>
    assembly.ports.find((port) => port.interface === part.electrical.interface && port.connector === part.electrical.connector) ??
    assembly.ports.find((port) => port.interface === part.electrical.interface);

  const rails = RAILS[brain.id];
  if (!rails) return null;

  // Everything the diagram needs, resolved before anything is drawn. A
  // peripheral that cannot be represented must stop the whole diagram: drawing
  // the others would quietly omit a part that is physically on the bench.
  const resolved = peripherals.map((part) => ({
    part,
    connector: connectorOf(part),
    port: portFor(part),
    usable: usableWindow(rail, part.electrical.voltage_range),
  }));
  if (resolved.some((entry) => !entry.connector || !entry.port || !entry.usable)) return null;

  let lastOnBus: { label: string; accepts: boolean } | null = null;
  const nodes: WiringNode[] = resolved.map(({ part, connector, port, usable }): WiringNode => {
    const onBus = part.electrical.interface === "i2c";
    const upstream = onBus && lastOnBus?.accepts ? lastOnBus.label : null;
    if (onBus) lastOnBus = { label: part.id, accepts: acceptsChain(part) };
    const header = (label: string) => ({ kind: "header" as const, label });
    const leads: WiringLead[] = connector!.pins.map((pin): WiringLead => {
      if (upstream !== null) {
        return {
          pin,
          source: { kind: "chain", label: upstream },
          window: pin.role === "power" ? usable! : null,
          signal: pin.role === "sda" || pin.role === "scl" ? `I²C ${part.electrical.i2c_address}` : null,
        };
      }
      switch (pin.role) {
        case "power":
          return { pin, source: header(rails.rail), window: usable!, signal: null };
        case "ground":
          return { pin, source: header(rails.ground), window: null, signal: null };
        case "sda":
          return { pin, source: header(port!.resources[0] ?? "SDA"), window: null, signal: `I²C ${part.electrical.i2c_address}` };
        case "scl":
          return { pin, source: header(port!.resources[1] ?? port!.resources[0] ?? "SCL"), window: null, signal: `I²C ${part.electrical.i2c_address}` };
        case "signal":
          return { pin, source: header(port!.resources[0] ?? "IO"), window: null, signal: part.electrical.interface.toUpperCase() };
      }
    });
    return {
      part,
      connector: connector!,
      units: [{ label: part.id, leads }],
      rail: { label: `${brain.name} ${rails.rail} rail`, window: rail },
      usable: usable!,
      chainedTo: upstream,
      notes: [],
    };
  });

  return {
    brain,
    brainConnector,
    rail,
    logic,
    supply: {
      part: supplyPart,
      connector: supplyConnector,
      brainInput: assembly.brain_input,
      brainPin: assembly.brain_input === "primary" ? brainConnector.housing : assembly.brain_input,
      window: usableWindow(output, brain.electrical.voltage_range),
      upstream: [],
    },
    nodes,
  };
}
