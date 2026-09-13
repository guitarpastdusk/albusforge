import type { ExampleBuildDetail } from "@/lib/example-builds";

const usd = (amount: number) => `$${amount.toFixed(2)}`;

/**
 * An example build's listing page (lib/example-builds.ts): a short note that
 * the design is real but its numbers are sample data, then the parts, priced
 * from the registry.
 */
export function ExampleBuildDetails({ detail }: { detail: ExampleBuildDetail }) {
  const { lines, partsCostUsd, unpricedLines, supply, notes } = detail;
  return (
    <>
      <aside aria-label="About this example build" className="mt-8 rounded-2xl border border-hairline bg-porcelain px-6 py-5">
        <p className="font-mono text-[13px] uppercase tracking-[0.18em] text-coral-deep">Example build</p>
        <p className="mt-2 max-w-[640px] text-[16px] font-light leading-[1.5] text-ink">
          This build is real: every part comes from our parts registry and passes its power and compatibility checks. The
          readings, author and clone count are sample data.
        </p>
      </aside>

      <section aria-labelledby="example-build-parts" className="mt-9">
        <h2 id="example-build-parts" className="font-display text-[26px] font-medium">
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
    </>
  );
}
