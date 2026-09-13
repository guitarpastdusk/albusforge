import { routes, Usage, type TierUsage } from "@albusforge/schema";
import type { Metadata } from "next";
import { PageContainer, PageTitle } from "@/components/ui";
import { apiGet } from "@/lib/api/server";
import { formatBytes, formatCompact } from "@/lib/format";

export const metadata: Metadata = { title: "Usage" };

const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });

function TierRow({ label, tier }: { label: string; tier: TierUsage }) {
  return (
    <tr className="border-t border-hairline">
      <td className="py-3">{label}</td>
      <td className="py-3 font-mono">{formatCompact(tier.model_calls)}</td>
      <td className="py-3 font-mono">{formatCompact(tier.tokens_in)}</td>
      <td className="py-3 font-mono">{formatCompact(tier.tokens_out)}</td>
    </tr>
  );
}

/** Not in the header nav — the design has four items. Reached from the account menu later. */
export default async function UsagePage() {
  const usage = await apiGet(routes.usage.path(), Usage);
  // `end` is exclusive; show the last day inside the period.
  const lastDay = new Date(Date.parse(usage.period.end) - 1);

  return (
    <PageContainer>
      <PageTitle
        kicker={`Current period · ${day.format(new Date(usage.period.start))} – ${day.format(lastDay)}`}
        title="Usage"
        description="What this workspace has used so far — visible before it is billed."
      />

      {/* Stub: proves the data path. Not designed yet. */}
      <table className="mt-9 w-full max-w-[720px] border-collapse text-left text-[15px]">
        <thead className="font-mono text-[12px] uppercase tracking-[0.12em] text-muted">
          <tr>
            <th className="py-2 font-normal">Model tier</th>
            <th className="py-2 font-normal">Calls</th>
            <th className="py-2 font-normal">Tokens in</th>
            <th className="py-2 font-normal">Tokens out</th>
          </tr>
        </thead>
        <tbody>
          <TierRow label="Tier 2 — narration" tier={usage.tiers.tier2} />
          <TierRow label="Tier 3 — Ask" tier={usage.tiers.tier3} />
        </tbody>
      </table>

      <dl className="mt-8 flex gap-10 text-[15px]">
        {usage.readings_in !== undefined ? (
          <div>
            <dt className="text-muted">Readings in</dt>
            <dd className="mt-1 font-mono text-[22px]">{formatCompact(usage.readings_in)}</dd>
          </div>
        ) : null}
        {usage.bytes_stored !== undefined ? (
          <div>
            <dt className="text-muted">Stored</dt>
            <dd className="mt-1 font-mono text-[22px]">{formatBytes(usage.bytes_stored)}</dd>
          </div>
        ) : null}
      </dl>
    </PageContainer>
  );
}
