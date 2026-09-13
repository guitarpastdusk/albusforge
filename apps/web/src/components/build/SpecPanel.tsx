import { Spec, type BuildStatus } from "@albusforge/schema";
import { z } from "zod";

/** Use the shared stored Spec fields, tolerating missing or malformed draft sections. */
export const DraftSpec = z.object({
  sense: Spec.shape.sense.optional().catch(undefined),
  act: Spec.shape.act.catch(undefined),
  environment: Spec.shape.environment.optional().catch(undefined),
  connect: Spec.shape.connect.optional().catch(undefined),
  power: Spec.shape.power.optional().catch(undefined),
  experience: Spec.shape.experience.optional().catch(undefined),
  capabilities: Spec.shape.capabilities.catch([]),
  assumptions: Spec.shape.assumptions.catch([]),
  open_questions: Spec.shape.open_questions.catch([]),
  settled: Spec.shape.settled.catch(false),
});
export type DraftSpec = z.infer<typeof DraftSpec>;

const STATUS_LABEL: Record<BuildStatus, string> = {
  asking: "Asking a few questions",
  specifying: "Writing the spec",
  planning: "Spec settled · picking parts",
  coding: "Writing the firmware",
  bodying: "Designing the enclosure",
  ready: "Design ready",
  ordered: "Ordered",
};

const TRANSPORT: Record<string, string> = { wifi: "Wi-Fi", ble: "Bluetooth LE", lora: "LoRa", none: "No radio" };
const POWER: Record<string, string> = { battery: "Battery", solar: "Solar", usb: "USB power" };

function every(seconds: number): string {
  if (seconds < 60) return `every ${seconds} s`;
  if (seconds < 3600) return `every ${Math.round(seconds / 60)} min`;
  return `every ${Math.round(seconds / 3600)} h`;
}

const list = (items: readonly string[]) => items.filter(Boolean).join(", ");

function rows(spec: DraftSpec): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (spec.sense?.what.length) {
    const detail = [spec.sense.accuracy, spec.sense.interval_s ? every(spec.sense.interval_s) : undefined].filter(Boolean).join(", ");
    out.push(["Senses", detail ? `${list(spec.sense.what)} (${detail})` : list(spec.sense.what)]);
  }
  if (spec.act?.what.length) out.push(["Acts", list(spec.act.what)]);
  if (spec.environment?.location) {
    const flags = list(spec.environment.flags);
    out.push(["Where", flags ? `${spec.environment.location} (${flags})` : spec.environment.location]);
  }
  if (spec.connect?.transport) {
    const transport = TRANSPORT[spec.connect.transport] ?? spec.connect.transport;
    const experience = list(spec.connect.experience);
    out.push(["Connects", experience ? `${transport}, ${experience}` : transport]);
  }
  if (spec.power?.source) {
    const source = POWER[spec.power.source] ?? "Not decided yet";
    out.push(["Power", spec.power.target_life_days ? `${source}, about ${spec.power.target_life_days} days` : source]);
  }
  const alerts = spec.experience?.alerts ?? [];
  if (alerts.length || spec.experience?.dashboard) {
    out.push(["You get", [alerts.length ? `alerts: ${list(alerts)}` : "", spec.experience?.dashboard ? "a dashboard" : ""].filter(Boolean).join("; ")]);
  }
  return out;
}

/** The spec so far, beside the chat. Renders nothing until intake has written something worth showing. */
export function SpecPanel({ spec: raw, status }: { spec: Record<string, unknown> | null; status: BuildStatus | null }) {
  if (!raw) return null;
  const parsed = DraftSpec.safeParse(raw);
  if (!parsed.success) return null;
  const spec = parsed.data;
  const facts = rows(spec);
  if (facts.length === 0 && spec.capabilities.length === 0 && spec.assumptions.length === 0 && spec.open_questions.length === 0) return null;

  return (
    <section aria-label="Spec so far" className="rounded-[20px] border border-hairline bg-white px-6 py-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-mono text-[13px] uppercase tracking-[0.18em] text-muted">{spec.settled ? "✓ Spec settled" : "Spec so far"}</h2>
        {status ? <span className="text-[13px] text-faint">{STATUS_LABEL[status]}</span> : null}
      </div>
      {facts.length > 0 ? (
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-[15px]">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {spec.capabilities.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[14px] font-semibold text-ink">Capabilities</h3>
          <ul className="mt-1.5 flex flex-wrap gap-2 text-[13px]">
            {spec.capabilities.map((capability) => <li key={capability} className="break-all rounded-lg bg-porcelain px-2 py-1 font-mono">{capability}</li>)}
          </ul>
        </div>
      ) : null}
      {spec.open_questions.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[14px] font-semibold text-ink">Still to decide</h3>
          <ul className="mt-1.5 flex flex-col gap-1 text-[15px] font-light text-muted">
            {spec.open_questions.map((q) => (
              <li key={`${q.field}:${q.question}`}>{q.question}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {spec.assumptions.length > 0 ? (
        <div className="mt-4">
          <h3 className="text-[14px] font-semibold text-ink">Assuming</h3>
          <ul className="mt-1.5 flex flex-col gap-1 text-[15px] font-light text-muted">
            {spec.assumptions.map((assumption) => (
              <li key={assumption}>{assumption}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
