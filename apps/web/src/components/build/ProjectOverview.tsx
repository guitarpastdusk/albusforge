import type { BuildDetail } from "@albusforge/schema";
import { ButtonLink, Pill } from "@/components/ui";
import { CandidateParts } from "./CandidateParts";
import { SpecPanel } from "./SpecPanel";

/** Overview of the stored build and its next available delivery stages. */
export function ProjectOverview({ build }: { build: BuildDetail }) {
  const conversationHref = `/build/${encodeURIComponent(build.id)}`;
  const planHref = `/projects/${encodeURIComponent(build.id)}/plan`;
  const firmwareHref = `/projects/${encodeURIComponent(build.id)}/firmware`;
  const inConversation = !build.status || build.status === "asking" || build.status === "specifying";
  return (
    <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6">
        <section aria-labelledby="next-step" className="rounded-[24px] border border-hairline bg-white p-6">
          <h2 id="next-step" className="font-display text-[26px]">{inConversation ? "Shape your device" : build.ready ? "Review your design" : "Your specification is taking shape"}</h2>
          <p className="mt-3 text-muted">{inConversation
            ? "Continue the conversation to describe what your device should do and resolve any open questions."
            : build.ready ? "Review the available design summary below. Your conversation stays available for reference."
            : "Review the latest specification and candidate matches below. Candidate parts do not yet confirm a feasible design."}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href={conversationHref} variant="coral" className="rounded-xl px-5 py-3">{inConversation ? "Resume conversation →" : "Open conversation →"}</ButtonLink>
            {build.display_status === "live" ? <ButtonLink href="/live" variant="dark" className="rounded-xl px-5 py-3">Open fleet →</ButtonLink> : null}
          </div>
        </section>
        {build.spec ? <SpecPanel spec={build.spec} status={build.status ?? null} /> : (
          <section aria-label="Specification" className="rounded-[20px] border border-hairline bg-white p-6">
            <h2 className="font-display text-[24px]">Specification</h2>
            <p className="mt-3 text-muted">No specification has been saved yet. Continue the conversation to begin.</p>
          </section>
        )}
        <CandidateParts parts={build.candidate_parts ?? []} />
        {build.ready ? (
          <section aria-labelledby="design-summary" className="rounded-[20px] border border-hairline bg-white p-6">
            <h2 id="design-summary" className="font-display text-[24px]">Design summary</h2>
            <p className="mt-2 text-muted">{build.ready.name} · Estimated ${build.ready.est_price_usd.toFixed(2)}</p>
            <ul className="mt-4 flex flex-wrap gap-2">{build.ready.parts.map(part => <li key={part.part_id}><Pill accent={part.accent}>{part.label}</Pill></li>)}</ul>
            <p className="mt-3 text-muted">{build.ready.fulfillment_note}</p>
          </section>
        ) : null}
      </div>
      <aside className="min-w-0 space-y-6">
        <section aria-labelledby="project-record" className="rounded-[20px] border border-hairline bg-white p-6">
          <h2 id="project-record" className="font-display text-[24px]">Project record</h2>
          <dl className="mt-4 space-y-3 text-[14px]">
            <div><dt className="text-muted">Last updated</dt><dd><time dateTime={build.updated_at}>{new Date(build.updated_at).toISOString().replace("T", " ").slice(0, 16)} UTC</time></dd></div>
            <div><dt className="text-muted">Specification</dt><dd>{build.spec_version ? `Version ${build.spec_version}` : "No saved version"}</dd></div>
            <div><dt className="text-muted">Devices</dt><dd>{build.device_count}</dd></div>
          </dl>
        </section>
        <section aria-labelledby="delivery" className="rounded-[20px] border border-hairline bg-porcelain p-6">
          <h2 id="delivery" className="font-display text-[24px]">Build and setup</h2>
          <p className="mt-3 text-[15px] text-muted">Review the pinned parts before accepting a plan. Firmware becomes available only after an accepted plan and a configured compiler. Generated files still need physical wiring, fit and power checks.</p>
          <div className="mt-5 grid gap-3">
            <ButtonLink href={planHref} variant="coral" className="justify-center rounded-xl px-4 py-3">Review build plan →</ButtonLink>
            <ButtonLink href={firmwareHref} variant="dark" className="justify-center rounded-xl px-4 py-3">Firmware and setup →</ButtonLink>
          </div>
        </section>
      </aside>
    </div>
  );
}
