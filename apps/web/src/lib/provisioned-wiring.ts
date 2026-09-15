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

/** The profile whose channels cover the ones this device reports, if any. */
export function profileForChannels(channels: readonly string[]): ProvisioningProfile | null {
  if (channels.length === 0) return null;
  const wanted = new Set(channels);
  return (
    PROVISIONING.find((profile) => {
      const keys = new Set(profile.channels.map((channel) => channel.key));
      return [...wanted].every((key) => keys.has(key));
    }) ?? null
  );
}

/** "3V3" and "GND" are silkscreen on every ESP32 board here; the signal pins are not. */
const RAIL_PIN = "3V3";
const GROUND_PIN = "GND";

/**
 * The wiring for a provisioned device, drawn from its assembly profile's real
 * ports. Null when the device's channels match no profile, or the profile names
 * parts the portal doesn't bundle — a partial diagram would hide a part.
 */
export function provisionedWiring(channels: readonly string[]): Wiring | null {
  const profile = profileForChannels(channels);
  if (!profile) return null;
  const assembly = ASSEMBLIES.find((candidate) => candidate.id === profile.assembly_profile.id);
  if (!assembly) return null;
  if (!profile.part_versions.every(({ id }) => PARTS.has(id))) return null;

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

  let lastOnBus: { label: string; accepts: boolean } | null = null;
  const nodes: WiringNode[] = peripherals.flatMap((part): WiringNode[] => {
    const connector = connectorOf(part);
    const port = portFor(part);
    if (!connector || !port) return [];
    const usable = usableWindow(rail, part.electrical.voltage_range);
    if (!usable) return [];
    const onBus = part.electrical.interface === "i2c";
    const upstream = onBus && lastOnBus?.accepts ? lastOnBus.label : null;
    if (onBus) lastOnBus = { label: part.id, accepts: acceptsChain(part) };
    const header = (label: string) => ({ kind: "header" as const, label });
    const leads: WiringLead[] = connector.pins.map((pin): WiringLead => {
      if (upstream !== null) {
        return {
          pin,
          source: { kind: "chain", label: upstream },
          window: pin.role === "power" ? usable : null,
          signal: pin.role === "sda" || pin.role === "scl" ? `I²C ${part.electrical.i2c_address}` : null,
        };
      }
      switch (pin.role) {
        case "power":
          return { pin, source: header(RAIL_PIN), window: usable, signal: null };
        case "ground":
          return { pin, source: header(GROUND_PIN), window: null, signal: null };
        case "sda":
          return { pin, source: header(port.resources[0] ?? "SDA"), window: null, signal: `I²C ${part.electrical.i2c_address}` };
        case "scl":
          return { pin, source: header(port.resources[1] ?? port.resources[0] ?? "SCL"), window: null, signal: `I²C ${part.electrical.i2c_address}` };
        case "signal":
          return { pin, source: header(port.resources[0] ?? "IO"), window: null, signal: part.electrical.interface.toUpperCase() };
      }
    });
    return [
      {
        part,
        connector,
        units: [{ label: part.id, leads }],
        rail: { label: `${brain.name} ${RAIL_PIN} rail`, window: rail },
        usable,
        chainedTo: upstream,
        notes: [],
      },
    ];
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
