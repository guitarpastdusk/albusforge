import type { ModelConsumption, UsageSummary } from "@albusforge/schema";
import { ButtonLink, PageContainer, PageTitle } from "@/components/ui";

const date = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const exactCount = (value: string) => BigInt(value).toLocaleString("en-US");
export function exactDollars(value: string) {
  const [whole = "0", fraction = "000000"] = value.split(".");
  return `$${exactCount(whole)}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
}
const STAGE_NAMES: Record<UsageSummary["model"]["stages"][number]["stage"], string> = {
  intake: "Build conversation", codegen: "Firmware generation", bodygen: "Enclosure generation",
  narration: "Narration", ask: "Device questions", explain: "Plan explanations", other: "Other model work",
};
function ModelCells({ row }: { row: ModelConsumption }) {
  return <>
    {[row.calls, row.input_tokens, row.output_tokens, row.cache_read_tokens, row.cache_creation_tokens].map((value, i) => (
      <td key={i} className="px-4 py-4 text-right font-mono tabular-nums">{exactCount(value)}</td>
    ))}
    <td className="px-4 py-4 text-right font-mono tabular-nums">{exactDollars(row.cost_usd)}</td>
  </>;
}

export function UsageDashboard({ usage, workspace }: { usage: UsageSummary; workspace: string }) {
  const lastDay = new Date(Date.parse(usage.period.end) - 1);
  const cards = [
    { label: "Recorded model calls", value: exactCount(usage.model.total.calls), note: "Includes calls attributed to this workspace." },
    { label: "Recorded model cost", value: exactDollars(usage.model.total.cost_usd), note: "USD model-cost estimate, not an invoice." },
    { label: "Sensor readings accepted", value: exactCount(usage.telemetry.readings_in), note: "Retries of the same packet count once." },
    { label: "Uploaded payload", value: exactCount(usage.telemetry.payload_bytes), suffix: "bytes", note: "Accepted JSON payload, not database storage." },
    ...(usage.images ? [
      { label: "Images accepted", value: exactCount(usage.images.accepted_count), note: "Retries of the same image count once." },
      { label: "Accepted image upload", value: exactCount(usage.images.accepted_bytes), suffix: "bytes", note: "Accepted JPEG bytes, not retained or billed storage." },
    ] : []),
  ];
  return <PageContainer>
    <PageTitle kicker={`${date.format(new Date(usage.period.start))} – ${date.format(lastDay)} · UTC`}
      title="Usage" description={`Recorded consumption for ${workspace}. See what your builds and devices have used this month.`} />
    <dl className={`mt-8 grid gap-4 sm:grid-cols-2 ${usage.images ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}>
      {cards.map((card) => <div key={card.label} className="min-w-0 rounded-[22px] border border-hairline bg-white p-6">
        <dt className="text-[14px] text-muted">{card.label}</dt>
        <dd className="mt-3 break-words font-mono text-[28px] leading-tight tracking-tight text-ink tabular-nums">{card.value}{card.suffix ? <span className="ml-2 whitespace-nowrap text-[14px] text-muted">{card.suffix}</span> : null}</dd>
        <dd className="mt-3 text-[13px] leading-relaxed text-muted">{card.note}</dd>
      </div>)}
    </dl>
    <section aria-labelledby="model-usage-heading" className="mt-10">
      <h2 id="model-usage-heading" className="font-display text-[28px] font-medium">Model activity</h2>
      <p className="mt-2 max-w-[760px] text-[15px] leading-relaxed text-muted">Each stage is counted from saved model-call records. Uncached input, cache reads and new cache entries are shown separately.</p>
      {usage.model.stages.length === 0 ? <div className="mt-5 rounded-[22px] border border-hairline bg-white p-6">
        <h3 className="font-medium">No model calls recorded this month</h3>
        <p className="mt-2 text-[15px] text-muted">Start a build conversation to describe what you want your device to do.</p>
        <ButtonLink href="/" variant="dark" className="mt-5 rounded-full px-5 py-2.5">Start a build →</ButtonLink>
      </div> : <div className="mt-5 overflow-x-auto rounded-[22px] border border-hairline bg-white focus-visible:outline-2 focus-visible:outline-coral" tabIndex={0} role="region" aria-label="Model usage table, scroll horizontally on narrow screens">
        <table className="w-full min-w-[900px] border-collapse text-[14px]">
          <caption className="sr-only">Model consumption by activity, current UTC month</caption>
          <thead className="bg-porcelain text-[12px] text-muted"><tr>
            {["Activity", "Calls", "Uncached input", "Output tokens", "Cache reads", "New cache tokens", "Model cost (USD)"].map((label, i) => <th scope="col" key={label} className={`px-4 py-4 font-medium ${i ? "text-right" : "text-left"}`}>{label}</th>)}
          </tr></thead>
          <tbody>{usage.model.stages.map((row) => <tr key={row.stage} className="border-t border-hairline"><th scope="row" className="px-4 py-4 text-left font-medium">{STAGE_NAMES[row.stage]}</th><ModelCells row={row} /></tr>)}</tbody>
          <tfoot><tr className="border-t border-hairline bg-porcelain"><th scope="row" className="px-4 py-4 text-left font-semibold">Total</th><ModelCells row={usage.model.total} /></tr></tfoot>
        </table>
      </div>}
    </section>
    <aside aria-label="How usage is counted" className="mt-8 max-w-[820px] rounded-[22px] bg-porcelain p-6 text-[14px] leading-relaxed text-muted">
      <h2 className="font-semibold text-ink">About these numbers</h2>
      <p className="mt-2">This is recorded consumption, not your bill. Model costs use the prices recorded when each call completed. Plan allowances, subscription charges and physical storage measurements are not included.</p>
      <p className="mt-2">Sensor and image totals cover uploads accepted this month for devices still in this workspace. Backfills count when uploaded. Image retention and media deletion do not subtract accepted uploads; deleting a device removes its sensor and image usage records. Saved model records remain attributable after a build is deleted.</p>
      <p className="mt-2">Snapshot: <time dateTime={usage.as_of}>{new Date(usage.as_of).toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" })} UTC</time>. Reload this page for updated figures.</p>
    </aside>
  </PageContainer>;
}
