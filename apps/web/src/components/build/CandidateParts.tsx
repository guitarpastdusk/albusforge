import type { CandidatePart } from "@albusforge/schema";

const usd = (amount: number) => `$${amount.toFixed(2)}`;

/**
 * Registry parts whose capabilities match the spec so far. A capability match,
 * not a plan: no wiring, power, conflict or quantity check has run yet (the
 * matcher, M3, replaces it). The copy says so.
 */
export function CandidateParts({ parts }: { parts: readonly CandidatePart[] }) {
  if (parts.length === 0) return null;
  return (
    <section aria-label="Candidate parts" className="rounded-[20px] border border-hairline bg-white px-6 py-5">
      <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-muted">Candidate parts</h2>
      <p className="mt-2 text-[14px] font-light leading-[1.45] text-muted">
        Parts from our registry that match what the spec needs so far. Not a final plan yet: wiring, power and quantities come next.
      </p>
      <ul className="mt-3 divide-y divide-hairline">
        {parts.map((part) => (
          <li key={`${part.id}@${part.version}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <span className="text-[15px] text-ink">
              {part.name} <span className="font-mono text-[12px] text-faint">{part.id}</span>
            </span>
            <span className="flex flex-wrap items-center gap-2">
              {part.matched_capabilities.map((capability) => (
                <span key={capability} className="rounded-full bg-porcelain px-2.5 py-0.5 font-mono text-[12px] text-muted">
                  {capability}
                </span>
              ))}
              {part.unit_cost_usd !== null ? <span className="font-mono text-[13px] text-muted">{usd(part.unit_cost_usd)}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
