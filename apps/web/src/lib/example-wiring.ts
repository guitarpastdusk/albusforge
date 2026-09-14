import { ConnectorDefinition, usableWindow, type ConnectorPin, type PartDefinition, type VoltageWindow } from "@albusforge/schema";
import hsx3pin from "../../../../registry/connectors/hsx-3pin-v1.json";
import hsx4pinGpio from "../../../../registry/connectors/hsx-4pin-gpio-v1.json";
import hsxI2c from "../../../../registry/connectors/hsx-i2c-4pin-v1.json";
import hsxPower from "../../../../registry/connectors/hsx-power-2pin-v1.json";
import usbC from "../../../../registry/connectors/usb-c-v1.json";
import usbMicroB from "../../../../registry/connectors/usb-micro-b-v1.json";
import { EXAMPLE_PARTS, type ExampleBuild } from "./example-builds";

/*
 * The wiring an example build's circuit diagram draws.
 *
 * Where the numbers come from: the parts' own `electrical` blocks and the
 * connector definitions, both read from the registry. Which rail feeds a
 * peripheral, and the window it is usable over, follow the same rules the
 * registry's power check uses (registry/scripts/lib/power.ts, over the shared
 * `usableWindow`): a part that
 * requires `power.5v` runs from the supply, everything else from the brain's
 * regulated rail, and the usable window is the overlap. A supply-fed
 * peripheral is drawn on the supply itself, not on the board's 5V header,
 * which sits after the USB Schottky and carries less than the supply puts out.
 *
 * What is ours, not the registry's: which header pin each signal lands on.
 * The registry has no pin map, so `BRAIN_HEADER` picks pins that exist on the
 * board and the diagram says so. Nothing has been wired on a bench.
 */

export const CONNECTORS: ReadonlyMap<string, ConnectorDefinition> = new Map(
  [hsx3pin, hsx4pinGpio, hsxI2c, hsxPower, usbC, usbMicroB].map((json) => {
    const connector = ConnectorDefinition.parse(json);
    return [connector.id, connector];
  }),
);

/**
 * The ESP32-S3-DevKitC-1 header pins the diagrams use. All exist on the v1.1
 * board (C-001/SOURCES.md): GPIO8/9 are the ESP-IDF I2C default, GPIO1–GPIO4
 * are ADC1_CH0–CH3, and the rest are free digital pins. A build that needs
 * more pins of one kind than are listed here is a diagram bug, not a wiring
 * limit — the board has 45 GPIO.
 */
export const BRAIN_HEADER = {
  rail3v3: "3V3",
  /** A power input, not an output: the board's 5V pin feeds VCC_5V and the regulator. */
  rail5v: "5V",
  ground: "GND",
  sda: "GPIO8",
  scl: "GPIO9",
  adc: ["GPIO1", "GPIO2", "GPIO3", "GPIO4"],
  digital: ["GPIO5", "GPIO6", "GPIO7"],
  pwm: ["GPIO10", "GPIO11"],
} as const;

/** One wire: a pin on the part's connector, and what the other end lands on. */
export interface WiringLead {
  pin: ConnectorPin;
  /**
   * Where the lead ends. A part that runs from the supply takes its power from
   * the supply itself, not from the board's 5V header: that header is VCC_5V,
   * after the USB Schottky, and power.ts's window is the supply's own output.
   * `chain` means it plugs into the part named, not into the board: an I2C
   * breakout has two identical ports, so the bus passes through it.
   */
  source: { kind: "header" | "supply" | "chain"; label: string };
  /** Volts the lead carries, on the power lead; null on ground and signal leads, where the pin names say it. */
  window: VoltageWindow | null;
  /** What the signal is, on signal leads: "I²C 0x77", "ADC", "PWM". */
  signal: string | null;
}

/** One unit of a peripheral. A build with four probes has four of these. */
export interface WiringUnit {
  /** "Probe 1" when the build has several of the part, otherwise the part's id. */
  label: string;
  leads: WiringLead[];
}

export interface WiringNode {
  part: PartDefinition;
  connector: ConnectorDefinition;
  units: WiringUnit[];
  /** The rail the part's VCC comes from, and the volts it puts out. */
  rail: { label: string; window: VoltageWindow };
  /** Where rail and `voltage_range` overlap: the volts the part actually sees. */
  usable: VoltageWindow;
  /**
   * The part this one plugs into instead of the board, when it is further down
   * an I2C chain; null for the part that reaches the board. Only a connector
   * with a second identical port can pass the bus on, which is why a 3-pin
   * probe never chains.
   */
  chainedTo: string | null;
  notes: string[];
}

export interface WiringSupply {
  part: PartDefinition;
  connector: ConnectorDefinition;
  /** The brain input it feeds: "primary" (the board's port) or an alt input. */
  brainInput: string;
  /** The header pin or port that input is. */
  brainPin: string;
  /** Supply voltages over which the brain stays powered. */
  window: VoltageWindow | null;
  /** Power parts that feed the supply rather than the brain, e.g. a charger. */
  upstream: { part: PartDefinition; connector: ConnectorDefinition; output: VoltageWindow }[];
}

export interface Wiring {
  brain: PartDefinition;
  brainConnector: ConnectorDefinition;
  /** The brain's regulated rail, which peripherals run from. */
  rail: VoltageWindow;
  /** Brain GPIO logic levels. */
  logic: VoltageWindow;
  supply: WiringSupply;
  nodes: WiringNode[];
}

/** "3.251–3.349 V", the registry's own spelling of a window. */
export const volts = (window: VoltageWindow) => `${window[0]}–${window[1]} V`;

/**
 * True when a connector can carry a bus onward: it has more than one device on
 * it and every conductor is shared, which is what lets a breakout expose two
 * identical ports. A 3-pin probe with one signal line cannot.
 */
function canPassThrough(connector: ConnectorDefinition): boolean {
  return connector.interfaces.includes("i2c") && connector.pins.some((pin) => pin.role === "sda") && connector.pins.some((pin) => pin.role === "scl");
}

function connectorOf(part: PartDefinition): ConnectorDefinition {
  const found = CONNECTORS.get(part.electrical.connector);
  if (!found) throw new Error(`${part.id} uses connector ${part.electrical.connector}, which isn't bundled in CONNECTORS`);
  return found;
}

function partOf(id: string): PartDefinition {
  const found = EXAMPLE_PARTS.get(id);
  if (!found) throw new Error(`wiring uses ${id}, which isn't bundled in EXAMPLE_PARTS`);
  return found;
}

/** Takes pins from a pool in order, so the same build always draws the same wiring. */
function pinPool(pins: readonly string[], kind: string) {
  let next = 0;
  return () => {
    const pin = pins[next++];
    if (!pin) throw new Error(`the diagram's ${kind} pin pool (${pins.join(", ")}) is exhausted`);
    return pin;
  };
}

const NOTES: Record<string, string> = {
  "1-wire": "One-Wire needs a 4.7 kΩ pull-up from the data line to VCC. It isn't in the parts list.",
  pwm: "The servo's stall current (600 mA) comes from the supply, not the brain's rail.",
};

/**
 * The wiring for an example build, derived from the registry. Throws if the
 * build's parts don't make a wiring — the same conditions
 * example-builds.test.ts already holds every build to.
 */
export function exampleWiring(build: ExampleBuild): Wiring {
  const parts = build.parts.map(({ id, qty }) => ({ part: partOf(id), qty }));
  const brain = parts.find(({ part }) => part.electrical.interface === "host")?.part;
  if (!brain) throw new Error(`${build.id} has no host part`);
  const rail = brain.electrical.supply?.output_v;
  if (!rail) throw new Error(`${brain.id} has no regulated rail`);
  const logic = brain.electrical.logic_v;
  if (!logic) throw new Error(`${brain.id} has no logic levels`);

  const supplyPart = partOf(build.power.supply);
  const output = supplyPart.electrical.supply?.output_v;
  if (!output) throw new Error(`${supplyPart.id} supplies no power`);
  const input =
    build.power.brainInput === "primary"
      ? brain.electrical.voltage_range
      : brain.electrical.alt_inputs?.find((alt) => alt.name === build.power.brainInput)?.voltage_range;
  if (!input) throw new Error(`${brain.id} has no "${build.power.brainInput}" input`);

  const supply: WiringSupply = {
    part: supplyPart,
    connector: connectorOf(supplyPart),
    brainInput: build.power.brainInput,
    brainPin: build.power.brainInput === "primary" ? connectorOf(brain).housing : BRAIN_HEADER.rail5v,
    window: usableWindow(output, input),
    upstream: parts
      .filter(({ part }) => part.electrical.interface === "power" && part.id !== supplyPart.id)
      .flatMap(({ part }) => (part.electrical.supply ? [{ part, connector: connectorOf(part), output: part.electrical.supply.output_v }] : [])),
  };

  const takeAdc = pinPool(BRAIN_HEADER.adc, "ADC");
  const takeDigital = pinPool(BRAIN_HEADER.digital, "digital");
  const takePwm = pinPool(BRAIN_HEADER.pwm, "PWM");

  /**
   * The last thing on the I2C bus, so the next part plugs into it rather than
   * into the board. A Qwiic/STEMMA QT breakout carries two identical ports, so
   * the bus passes straight through: the board sees one cable however many
   * sensors hang off it. Only the first part on the bus reaches the header.
   */
  let lastOnBus: string | null = null;

  const nodes = parts
    .filter(({ part }) => part.electrical.interface !== "host" && part.electrical.interface !== "power")
    .map(({ part, qty }): WiringNode => {
      const connector = connectorOf(part);
      const fromSupply = part.electrical.requires.includes("power.5v");
      const railWindow = fromSupply ? output : rail;
      const usable = usableWindow(railWindow, part.electrical.voltage_range);
      if (!usable) throw new Error(`${part.id} can't run from ${fromSupply ? supplyPart.id : `${brain.id}'s rail`}`);

      // The supply's own power pin, for a peripheral wired to the supply rather than the board.
      const supplyPin = connectorOf(supplyPart).pins.find((pin) => pin.role === "power");
      const header = (label: string) => ({ kind: "header" as const, label });

      const chainsOn = part.electrical.interface === "i2c" && canPassThrough(connector);
      const chainedTo = chainsOn ? lastOnBus : null;

      const units = Array.from({ length: qty }, (_unit, index) => {
        const label = qty > 1 ? `${part.id} · ${index + 1} of ${qty}` : part.id;
        // Each unit plugs into whatever is already on the bus, then becomes its end.
        const upstream = chainsOn ? lastOnBus : null;
        if (chainsOn) lastOnBus = label;
        const chain = (pin: ConnectorPin, signal: string | null, window: VoltageWindow | null): WiringLead => ({
          pin,
          source: { kind: "chain", label: upstream! },
          window,
          signal,
        });
        return {
        label,
        leads: connector.pins.map((pin): WiringLead => {
          // Every conductor of a chained part goes down the same cable to the part before it.
          if (upstream !== null) {
            return chain(
              pin,
              pin.role === "sda" || pin.role === "scl" ? `I²C ${part.electrical.i2c_address}` : null,
              pin.role === "power" ? usable : null,
            );
          }
          switch (pin.role) {
            case "power":
              return {
                pin,
                source: fromSupply
                  ? { kind: "supply", label: `${supplyPart.id} ${supplyPin?.name ?? "+"}` }
                  : header(BRAIN_HEADER.rail3v3),
                window: usable,
                signal: null,
              };
            case "ground":
              // Ground is common: the peripheral's returns to the board, whatever powers it.
              return { pin, source: header(BRAIN_HEADER.ground), window: null, signal: null };
            case "sda":
              return { pin, source: header(BRAIN_HEADER.sda), window: null, signal: `I²C ${part.electrical.i2c_address}` };
            case "scl":
              return { pin, source: header(BRAIN_HEADER.scl), window: null, signal: `I²C ${part.electrical.i2c_address}` };
            case "signal":
              return part.electrical.interface === "adc"
                ? { pin, source: header(takeAdc()), window: null, signal: "ADC" }
                : part.electrical.interface === "pwm"
                  ? { pin, source: header(takePwm()), window: null, signal: "PWM" }
                  : { pin, source: header(takeDigital()), window: null, signal: part.electrical.interface === "1-wire" ? "One-Wire" : "digital in" };
          }
        }),
        };
      });

      const notes = [];
      const note = NOTES[part.electrical.interface];
      if (note) notes.push(note);
      // The case known-issues.json tracks for the HC-SR04: a part that answers above the brain's VIH maximum.
      if (part.electrical.logic_v && part.electrical.logic_v[1] > logic[1] + 0.3 && usable[1] > logic[1] + 0.3) {
        notes.push(
          `${part.name} can answer at up to ${part.electrical.logic_v[1]} V, above the ${logic[1]} V ${brain.name} GPIO accepts. Its signal needs a divider, which isn't in the parts list.`,
        );
      }
      return { part, connector, units, rail: { label: fromSupply ? supplyPart.name : `${brain.name} 3V3 rail`, window: railWindow }, usable, chainedTo, notes };
    });

  return { brain, brainConnector: connectorOf(brain), rail, logic, supply, nodes };
}
