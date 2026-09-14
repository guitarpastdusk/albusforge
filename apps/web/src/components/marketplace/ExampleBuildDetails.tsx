import type { ExampleBuildDetail } from "@/lib/example-builds";
import { exampleReadings } from "@/lib/example-readings";
import { exampleWiring, volts } from "@/lib/example-wiring";
import { BuildCircuitDiagram } from "./BuildCircuitDiagram";
import { SampleReadingsTable } from "./SampleReadingsTable";

const usd = (amount: number) => `$${amount.toFixed(2)}`;

const HEADING = "font-display text-[26px] font-medium";

/**
 * An example build's listing page (lib/example-builds.ts): a short note that
 * the design is real but its numbers are sample data, then the parts priced
 * from the registry, the wiring drawn from it, and the readings the build
 * would send.
 */
export function ExampleBuildDetails({ detail }: { detail: ExampleBuildDetail }) {
  const { build, lines, partsCostUsd, unpricedLines, supply, notes } = detail;
  const wiring = exampleWiring(build);
  const readings = exampleReadings(build);
  const wiringNotes = wiring.nodes.flatMap((node) => node.notes);
  return (
    <>
      <aside aria-label="About this example build" className="mt-8 rounded-2xl border border-hairline bg-porcelain px-6 py-5">
        <p className="font-mono text-[13px] uppercase tracking-[0.18em] text-coral-deep">Example build</p>
        <p className="mt-2 max-w-[640px] text-[16px] font-light leading-[1.5] text-ink">
          This build is real: every part comes from our parts registry, and the parts pass its voltage checks. Wiring,
          connectors and fit haven&apos;t been tested on a bench yet. The readings, author and clone count are sample data.
        </p>
      </aside>

      <section aria-labelledby="example-build-parts" className="mt-9">
        <h2 id="example-build-parts" className={HEADING}>
          Parts
        </h2>
        <ul className="mt-4 divide-y divide-hairline overflow-hidden rounded-[20px] border border-hairline bg-white">
          {lines.map(({ part, qty, lineCostUsd }) => (
            <li key={part.id} className="flex flex-wrap items-baseline justify-between gap-3 px-6 py-4">
              <span className="text-[16px]">
                {qty > 1 ? `${qty} × ` : ""}
                {part.name} <span className="font-mono text-[13px] text-faint">{part.id}</span>
              </span>
              <span className="font-mono text-[14px] text-muted">{lineCostUsd === null ? "price pending" : usd(lineCostUsd)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[15px] text-muted">
          {unpricedLines > 0 ? "Parts from " : "Parts "}
          {usd(partsCostUsd)}
          {unpricedLines > 0 ? ` (${unpricedLines} not priced yet)` : ""} · powered by the {supply.name}
        </p>
        {notes.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2 text-[15px] font-light leading-[1.45] text-muted">
            {notes.map((note) => (
              <li key={note}>Note: {note}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="example-build-wiring" className="mt-11">
        <h2 id="example-build-wiring" className={HEADING}>
          Wiring
        </h2>
        <p className="mt-2 max-w-[640px] text-[15px] font-light leading-[1.45] text-muted">
          The volts are the parts&apos; own: the {supply.name} puts out {volts(supply.electrical.supply!.output_v)}, and the{" "}
          {wiring.brain.name}&apos;s regulator makes the {volts(wiring.rail)} rail its GPIO and most of the sensors run from. Which header pin each lead lands
          on is our suggestion — the registry has no pin map, and nothing here has been wired on a bench.
        </p>
        <div className="mt-5 rounded-[20px] border border-hairline bg-porcelain px-4 py-5 sm:px-6">
          <BuildCircuitDiagram wiring={wiring} buildName={build.name} />
        </div>
        {wiringNotes.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2 text-[15px] font-light leading-[1.45] text-muted">
            {wiringNotes.map((note) => (
              <li key={note}>Note: {note}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="example-build-readings" className="mt-11">
        <h2 id="example-build-readings" className={HEADING}>
          Readings
        </h2>
        <p className="mt-2 max-w-[640px] text-[15px] font-light leading-[1.45] text-muted">
          What this build sends: one column per channel its parts read or drive, with the unit the capability carries. The values and times below are sample
          data.
        </p>
        <SampleReadingsTable readings={readings} />
      </section>
    </>
  );
}
