import { BRAIN_HEADER, volts, type Wiring, type WiringLead } from "@/lib/example-wiring";

/*
 * An example build's wiring, drawn from the registry: the supply and the volts
 * it puts out, the brain with the header pin every lead lands on, and each
 * peripheral with its connector's pins, the volts it sees and its I2C address.
 * Pin choices are ours (lib/example-wiring.ts); the numbers are the parts' own.
 *
 * Geometry is computed, so a build with four probes draws four blocks. The
 * viewBox is 1040 wide — about life size in the page's container — and the
 * diagram scrolls rather than shrinking on a narrow screen.
 */

const WIDTH = 1084;
const TOP = 20;
/** The brain card's own text and power input, above the first peripheral. */
const BRAIN_HEAD = 104;
/** A peripheral card's first line of name, its summary, and its first lead. */
const CARD_HEAD = 62;
const NAME_LINE = 16;
const LEAD = 19;
const CARD_FOOT = 14;
const CARD_GAP = 18;
/** A chained block sits further down, so the cable into the block above it is legible. */
const CHAIN_GAP = 40;

const SUPPLY = { x: 12, w: 250, h: 92 };
const BRAIN = { x: 375, w: 245 };
const NODE = { x: 720, w: 310 };

/**
 * Connector families, for the keyed plug glyphs on a board edge and the legend
 * (WIRING_DIAGRAM_RULES §4). Read from the connector's own housing string, so a
 * new connector in the registry lands in the right family without a code change.
 */
const FAMILIES = [
  { id: "sh", match: /JST SH/i, label: "JST SH 1.0 mm · QT", fill: "var(--color-ink)", stroke: "var(--color-ink)" },
  { id: "ph", match: /JST PH/i, label: "JST PH 2.0 mm", fill: "#ffffff", stroke: "var(--color-muted)" },
  { id: "usb", match: /USB/i, label: "USB", fill: "var(--color-faint)", stroke: "var(--color-muted)" },
] as const;

const HEADER_FAMILY = { id: "header", label: "header pin", fill: "#e5c05b", stroke: "var(--color-muted)" } as const;

export function familyOf(housing: string) {
  return FAMILIES.find((family) => family.match.test(housing)) ?? FAMILIES[2];
}

/** A keyed plug on a board edge. */
function Port({ x, y, housing }: { x: number; y: number; housing: string }) {
  const family = familyOf(housing);
  return <rect x={x - 5} y={y - 7} width="10" height="14" rx="2" fill={family.fill} stroke={family.stroke} strokeWidth="1" />;
}

/** How a part's interface reads on the diagram. */
const INTERFACE: Record<string, string> = { i2c: "I²C", adc: "ADC", pwm: "PWM", gpio: "GPIO", "1-wire": "One-Wire" };

/** Characters that fit one line, at the diagram's display font and the box's width. */
const NODE_NAME_CHARS = 37;
const SUPPLY_NAME_CHARS = 28;

/**
 * A part name over at most two lines, broken on spaces. SVG doesn't wrap, and
 * a registry name ("BME280 Temperature, Humidity and Pressure Sensor") is
 * longer than any box here.
 */
export function wrapName(name: string, chars: number, lines = 2): string[] {
  const wrapped: string[] = [];
  let line = "";
  for (const word of name.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= chars || !line) line = next;
    else {
      wrapped.push(line);
      line = word;
      if (wrapped.length === lines - 1) break;
    }
  }
  const rest = name.slice(wrapped.join(" ").length).trim();
  wrapped.push(wrapped.length === lines - 1 ? (rest.length <= chars ? rest : `${rest.slice(0, chars - 1)}…`) : line);
  return wrapped;
}

/** One line of ~6.2 px-wide mono characters. */
const clip = (text: string, chars: number) => (text.length <= chars ? text : `${text.slice(0, chars - 1)}…`);

function Box({ x, y, w, h, tone = "plain" }: { x: number; y: number; w: number; h: number; tone?: "plain" | "brain" }) {
  return (
    <rect
      x={x}
      y={y}
      width={w}
      height={h}
      rx="14"
      className={tone === "brain" ? "fill-porcelain stroke-ink" : "fill-white stroke-hairline"}
      strokeWidth="1.5"
    />
  );
}

/**
 * A lead, coloured by what the conductor is: red V+, black ground, blue SDA,
 * yellow SCL, coral for a plain signal — the colours the cables themselves come
 * in, so the drawing matches what is in your hand. A signal stays dashed, as it
 * is on the carousel.
 */
const WIRE_STROKE: Record<string, string> = {
  power: "var(--color-wire-power)",
  ground: "var(--color-wire-ground)",
  sda: "var(--color-wire-sda)",
  scl: "var(--color-wire-scl)",
  signal: "var(--color-wire-signal)",
};

function Wire({ y, from, to, lead }: { y: number; from: number; to: number; lead: WiringLead }) {
  const signal = lead.pin.role !== "power" && lead.pin.role !== "ground";
  return (
    <line x1={from} x2={to} y1={y} y2={y} strokeWidth="1.5" strokeDasharray={signal ? "4 4" : undefined} stroke={WIRE_STROKE[lead.pin.role]} />
  );
}

/** What a lead carries: its volts, or what the signal is. */
const leadLabel = (lead: WiringLead) => (lead.window ? volts(lead.window) : (lead.signal ?? ""));

export function BuildCircuitDiagram({ wiring, buildName }: { wiring: Wiring; buildName: string }) {
  const { brain, brainConnector, rail, logic, supply, nodes } = wiring;
  const supplyOutput = supply.part.electrical.supply!;
  const brainInputRange =
    supply.brainInput === "primary"
      ? brain.electrical.voltage_range
      : brain.electrical.alt_inputs!.find((alt) => alt.name === supply.brainInput)!.voltage_range;

  // Every unit of every peripheral is one block in the right-hand stack.
  const stack: { node: (typeof nodes)[number]; unit: (typeof nodes)[number]["units"][number]; name: string[]; y: number; head: number; h: number }[] = [];
  for (const node of nodes) {
    for (const unit of node.units) {
      const name = wrapName(node.part.name, NODE_NAME_CHARS);
      const head = CARD_HEAD + (name.length - 1) * NAME_LINE;
      const previous = stack.at(-1);
      const gap = unit.leads[0]?.source.kind === "chain" ? CHAIN_GAP : CARD_GAP;
      stack.push({ node, unit, name, head, h: head + (unit.leads.length - 1) * LEAD + CARD_FOOT, y: previous ? previous.y + previous.h + gap : TOP + BRAIN_HEAD });
    }
  }

  const blockOf = new Map(stack.map((block) => [block.unit.label, block]));
  const stackBottom = stack.reduce((bottom, block) => Math.max(bottom, block.y + block.h), TOP + BRAIN_HEAD);
  const brainHeight = Math.max(stackBottom - TOP + 14, BRAIN_HEAD + 40);
  // Leads that take their power from the supply run around the board, not through it.
  const fromSupply = stack.flatMap(({ unit, head, y }) =>
    unit.leads.flatMap((lead, index) => (lead.source.kind === "supply" ? [{ lead, y: y + head + index * LEAD - 3.5 }] : [])),
  );
  const busY = TOP + brainHeight + 18;
  const inputY = TOP + BRAIN_HEAD - 12;
  const supplyName = wrapName(supply.part.name, SUPPLY_NAME_CHARS);
  const supplyHeight = SUPPLY.h + (supplyName.length - 1) * NAME_LINE;
  const supplyY = inputY - supplyHeight / 2;
  const chargerY = supplyY + supplyHeight + 30;
  const legendY =
    Math.max(TOP + brainHeight, supply.upstream.length > 0 ? chargerY + 76 : supplyY + supplyHeight, fromSupply.length > 0 ? busY + 10 : 0) + 34;
  const LEGEND_ROW = 18;
  const height = legendY + LEGEND_ROW * 2 + 20;

  // Every bus device shows its address; the map says whether they collide (rules §4).
  const addresses = stack.flatMap(({ node, unit }) => (node.part.electrical.i2c_address ? [{ unit: unit.label, address: node.part.electrical.i2c_address }] : []));
  const clashes = [...new Map(addresses.map((entry) => [entry.address, addresses.filter((other) => other.address === entry.address)])).values()].filter(
    (group) => group.length > 1,
  );
  const addressMap =
    addresses.length === 0
      ? null
      : `I²C ${addresses.map((entry) => `${entry.address} ${entry.unit}`).join(" · ")} — ${
          clashes.length === 0 ? "no conflicts" : `conflict: ${clashes.map((group) => group[0]!.address).join(", ")}`
        }`;

  // Connector families actually used, one legend entry each (rules §4).
  const families = [...new Map([supply.connector, ...nodes.map((node) => node.connector)].map((connector) => {
    const family = familyOf(connector.housing);
    return [family.id, family];
  })).values()];

  const description = [
    `${buildName} wiring.`,
    `${supply.part.name} at ${volts(supplyOutput.output_v)} feeds the ${brain.name}'s ${supply.brainPin}${supply.window ? `, which keeps the board up over ${volts(supply.window)}` : ""}.`,
    `Its ${volts(rail)} rail and ${logic[1]} V logic run:`,
    ...stack.map(
      ({ node, unit }) =>
        `${node.part.name} (${unit.label}) at ${volts(node.usable)} from the ${node.rail.label}, wired ${unit.leads
          .map((lead) => `${lead.pin.name} to ${lead.source.label}`)
          .join(", ")}.`,
    ),
  ].join(" ");

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={description} className="block h-auto w-full min-w-[900px]">
        {/* The supply, and anything upstream of it. */}
        <Box x={SUPPLY.x} y={supplyY} w={SUPPLY.w} h={supplyHeight} />
        {supplyName.map((line, index) => (
          <text key={line} x={SUPPLY.x + 16} y={supplyY + 26 + index * NAME_LINE} fontSize="12.5" className="fill-ink">
            {line}
          </text>
        ))}
        <text x={SUPPLY.x + 16} y={supplyY + 45 + (supplyName.length - 1) * NAME_LINE} fontSize="10" className="fill-coral-deep font-mono">
          {supply.part.id} · out {volts(supplyOutput.output_v)}
        </text>
        <text x={SUPPLY.x + 16} y={supplyY + 62 + (supplyName.length - 1) * NAME_LINE} fontSize="10" className="fill-muted font-mono">
          {clip(supply.connector.housing, 34)}
        </text>
        <text x={SUPPLY.x + 16} y={supplyY + 78 + (supplyName.length - 1) * NAME_LINE} fontSize="10" className="fill-muted font-mono">
          {supplyOutput.capacity_mah ? `${supplyOutput.capacity_mah} mAh · ≤${supplyOutput.max_output_ma} mA` : `≤${supplyOutput.max_output_ma} mA`}
        </text>

        {supply.upstream.map((upstream) => (
          <g key={upstream.part.id}>
            <Box x={SUPPLY.x} y={chargerY} w={SUPPLY.w} h={70} />
            <text x={SUPPLY.x + 16} y={chargerY + 26} fontSize="12.5" className="fill-ink">
              {clip(upstream.part.name, SUPPLY_NAME_CHARS)}
            </text>
            <text x={SUPPLY.x + 16} y={chargerY + 44} fontSize="10" className="fill-muted font-mono">
              {upstream.part.id} · charges at {volts(upstream.output)}
            </text>
            <text x={SUPPLY.x + 16} y={chargerY + 60} fontSize="10" className="fill-muted font-mono">
              {clip(upstream.connector.housing, 34)}
            </text>
            <line x1={SUPPLY.x + SUPPLY.w / 2} x2={SUPPLY.x + SUPPLY.w / 2} y1={chargerY} y2={supplyY + supplyHeight} strokeWidth="1.5" className="stroke-coral-deep" />
          </g>
        ))}

        {/* The supply into the brain's power input. */}
        <line x1={SUPPLY.x + SUPPLY.w} x2={BRAIN.x} y1={inputY} y2={inputY} strokeWidth="1.5" className="stroke-coral-deep" />
        <text x={(SUPPLY.x + SUPPLY.w + BRAIN.x) / 2} y={inputY - 8} fontSize="10" textAnchor="middle" className="fill-coral-deep font-mono">
          {volts(supplyOutput.output_v)}
        </text>
        <text x={(SUPPLY.x + SUPPLY.w + BRAIN.x) / 2} y={inputY + 16} fontSize="10" textAnchor="middle" className="fill-muted font-mono">
          {supply.brainInput === "primary" ? "port" : supply.brainInput}
        </text>

        {/* The brain. */}
        <Box x={BRAIN.x} y={TOP} w={BRAIN.w} h={brainHeight} tone="brain" />
        <text x={BRAIN.x + 16} y={TOP + 26} fontSize="13" className="fill-ink">
          {clip(brain.name, 28)}
        </text>
        <text x={BRAIN.x + 16} y={TOP + 44} fontSize="10" className="fill-muted font-mono">
          {brain.id} · in {volts(brainInputRange)}
        </text>
        <text x={BRAIN.x + 16} y={TOP + 60} fontSize="10" className="fill-muted font-mono">
          3V3 rail {volts(rail)} · ≤{brain.electrical.supply!.max_output_ma} mA
        </text>
        <text x={BRAIN.x + 16} y={TOP + 76} fontSize="10" className="fill-muted font-mono">
          GPIO logic {logic[1]} V · {clip(brainConnector.housing, 20)}
        </text>
        <text x={BRAIN.x + 16} y={inputY + 4} fontSize="10" className="fill-coral-deep font-mono">
          {supply.brainPin}
        </text>

        {/* One block per peripheral unit, and its leads back to the brain's pins. */}
        {stack.map(({ node, unit, name, head, h, y }) => (
          <g key={unit.label}>
            <Box x={NODE.x} y={y} w={NODE.w} h={h} />
            {name.map((line, index) => (
              <text key={line} x={NODE.x + 14} y={y + 24 + index * NAME_LINE} fontSize="12.5" className="fill-ink">
                {line}
              </text>
            ))}
            <text x={NODE.x + 14} y={y + head - 22} fontSize="10" className="fill-muted font-mono">
              {clip(
                `${unit.label} · ${INTERFACE[node.part.electrical.interface] ?? node.part.electrical.interface}${node.part.electrical.i2c_address ? ` ${node.part.electrical.i2c_address}` : ""} · sees ${volts(node.usable)}`,
                48,
              )}
            </text>
            {unit.leads.map((lead, index) => {
              const leadY = y + head + index * LEAD;
              const onHeader = lead.source.kind === "header";
              return (
                <g key={lead.pin.n}>
                  {onHeader ? <Wire y={leadY - 3.5} from={BRAIN.x + BRAIN.w} to={NODE.x} lead={lead} /> : null}
                  <text x={BRAIN.x + BRAIN.w - 14} y={leadY} fontSize="10" textAnchor="end" className="fill-ink font-mono">
                    {onHeader ? lead.source.label : ""}
                  </text>
                  <text x={(BRAIN.x + BRAIN.w + NODE.x) / 2} y={leadY - 8} fontSize="9.5" textAnchor="middle" className="fill-muted font-mono">
                    {onHeader ? leadLabel(lead) : ""}
                  </text>
                  <text x={NODE.x + 14} y={leadY} fontSize="10" className="fill-ink font-mono">
                    {lead.pin.n} {lead.pin.name}
                  </text>
                </g>
              );
            })}
          </g>
        ))}

        {/* The I2C chain: a part with a second port passes the bus on, so the next
            sensor plugs into it rather than into the board. One cable between the
            two blocks, its four conductors in their own colours. */}
        {stack.flatMap((block) => {
          const upstreamLabel = block.unit.leads[0]?.source.kind === "chain" ? block.unit.leads[0].source.label : null;
          const upstream = upstreamLabel === null ? undefined : blockOf.get(upstreamLabel);
          if (!upstream) return [];
          const from = upstream.y + upstream.h;
          const to = block.y;
          return [
            <g key={`chain-${block.unit.label}`}>
              {/* Plugs at both ends, so nothing about the wires is the reader's to decide:
                  one grey cable, named by what it is (rules §4). */}
              <line x1={NODE.x + 30} x2={NODE.x + 30} y1={from} y2={to} strokeWidth="7" strokeLinecap="round" className="stroke-hairline" />
              <line x1={NODE.x + 30} x2={NODE.x + 30} y1={from} y2={to} strokeWidth="2.5" strokeLinecap="round" className="stroke-faint" />
              <Port x={NODE.x + 30} y={from} housing={block.node.connector.housing} />
              <Port x={NODE.x + 30} y={to} housing={block.node.connector.housing} />
              <text x={NODE.x + 46} y={(from + to) / 2} fontSize="9.5" className="fill-ink font-mono">
                {clip(`${block.unit.label} → ${upstreamLabel}`, 40)}
              </text>
              <text x={NODE.x + 46} y={(from + to) / 2 + 13} fontSize="9.5" className="fill-muted font-mono">
                {clip(`${block.node.connector.housing} · either port`, 44)}
              </text>
            </g>,
          ];
        })}

        {/* Peripherals the supply powers directly: down from the supply, under the board and up the
            outside, so the branch crosses none of the board's own leads. */}
        {fromSupply.map(({ lead, y }, index) => {
          const drop = SUPPLY.x + SUPPLY.w - 30;
          const riser = NODE.x + NODE.w + 16 + index * 12;
          return (
            <g key={`${lead.source.label}-${y}`}>
              <path
                d={`M${drop} ${supplyY + supplyHeight}V${busY}H${riser}V${y}H${NODE.x + NODE.w}`}
                fill="none"
                strokeWidth="1.5"
                className="stroke-coral-deep"
              />
              <text x={drop + 10} y={busY - 6} fontSize="9.5" className="fill-coral-deep font-mono">
                {lead.source.label} · {leadLabel(lead)}
              </text>
            </g>
          );
        })}

        {/* Legend. */}
        {/* Legend. Wire colours are for the loose-ended run onto the header: a cable
            with a plug at both end has nothing for the reader to decide (rules §4). */}
        <text x={16} y={legendY + 4} fontSize="10" className="fill-ink font-mono">
          loose ends →
        </text>
        {[
          { x: 104, label: "V+ · red", role: "power", dash: undefined },
          { x: 210, label: "GND · black", role: "ground", dash: undefined },
          { x: 332, label: "SDA · blue", role: "sda", dash: "4 4" },
          { x: 444, label: "SCL · yellow", role: "scl", dash: "4 4" },
          { x: 566, label: "signal · orange", role: "signal", dash: "4 4" },
        ].map((entry) => (
          <g key={entry.label}>
            <line x1={entry.x} x2={entry.x + 30} y1={legendY} y2={legendY} strokeWidth="1.5" strokeDasharray={entry.dash} stroke={WIRE_STROKE[entry.role]} />
            <text x={entry.x + 38} y={legendY + 4} fontSize="10" className="fill-muted font-mono">
              {entry.label}
            </text>
          </g>
        ))}

        <text x={16} y={legendY + LEGEND_ROW + 4} fontSize="10" className="fill-ink font-mono">
          connectors →
        </text>
        {families.map((family, index) => (
          <g key={family.id}>
            <rect x={100 + index * 190} y={legendY + LEGEND_ROW - 3} width="10" height="14" rx="2" fill={family.fill} stroke={family.stroke} strokeWidth="1" />
            <text x={118 + index * 190} y={legendY + LEGEND_ROW + 4} fontSize="10" className="fill-muted font-mono">
              {family.label}
            </text>
          </g>
        ))}
        <rect x={100 + families.length * 190} y={legendY + LEGEND_ROW - 3} width="10" height="14" rx="2" fill={HEADER_FAMILY.fill} stroke={HEADER_FAMILY.stroke} strokeWidth="1" />
        <text x={118 + families.length * 190} y={legendY + LEGEND_ROW + 4} fontSize="10" className="fill-muted font-mono">
          {HEADER_FAMILY.label}
        </text>

        {addressMap ? (
          <text x={16} y={legendY + LEGEND_ROW * 2 + 4} fontSize="10" className="fill-muted font-mono">
            {addressMap}
          </text>
        ) : null}
        <text x={16} y={legendY + LEGEND_ROW * 2 + (addressMap ? 17 : 4)} fontSize="10" className="fill-coral-deep font-mono">
          {`${brain.name} GPIO are ${logic[1]} V only — do not wire a signal to the ${BRAIN_HEADER.rail5v} rail.`}
        </text>
      </svg>
    </div>
  );
}
