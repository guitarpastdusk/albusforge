import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, PageContainer, PageTitle } from "@/components/ui";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Start a build, understand device setup, and read telemetry with Albus Forge.",
};

const guides = [
  ["quickstart", "Quickstart"],
  ["build", "Build your specification"],
  ["flash", "Prepare to flash"],
  ["telemetry", "Understand telemetry"],
  ["troubleshooting", "Troubleshooting"],
] as const;
const linkStyle = "font-medium text-coral-deep underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4";
const source = "https://github.com/guitarpastdusk/albusforge/blob/main/";

function Guide({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24">
      <h2 id={id} className="scroll-mt-24 font-display text-[28px] font-medium">{title}</h2>
      <div className="mt-4 space-y-4 text-[16px] leading-relaxed text-muted">{children}</div>
    </section>
  );
}

export default function DocsPage() {
  return (
    <PageContainer>
      <PageTitle kicker="Docs" title="From an idea to your first readings" description="Practical guides to the build conversation and telemetry, with setup work that is still in progress called out along the way." />
      <div className="mt-10 grid items-start gap-10 lg:grid-cols-[230px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="lg:sticky lg:top-24">
          <Card className="p-6">
            <p className="mb-4 font-mono text-[13px] uppercase tracking-wide">On this page</p>
            <ul className="space-y-3">
              {guides.map(([id, title]) => <li key={id}><Link className={linkStyle} href={`#${id}`}>{title}</Link></li>)}
            </ul>
          </Card>
        </nav>
        <div className="min-w-0 max-w-[760px] space-y-12">
          <Guide id="quickstart" title="Quickstart">
            <ol className="list-decimal space-y-3 pl-6">
              <li><Link href="/" className={linkStyle}>Start a build</Link> and describe what you want to measure, where the device will live, and what should happen when conditions change.</li>
              <li>Answer the follow-up questions. For example: “Monitor temperature and humidity in my greenhouse. There is Wi-Fi and mains power.” Add the range and sampling interval you need if you know them.</li>
              <li>Review the specification and any assumptions before moving ahead. Candidate parts are suggestions; they are not a final wiring plan or an order.</li>
              <li><Link href="/signup" className={linkStyle}>Create an account</Link> or <Link href="/signin" className={linkStyle}>sign in</Link> to save work. Use the same browser as your anonymous build so it can be associated with your account.</li>
            </ol>
            <p>Sign-in uses an email code. If the service cannot send or verify it, use the error shown on the sign-in screen; delivery depends on the configured environment.</p>
          </Guide>
          <Guide id="build" title="Build your specification">
            <p>Include the measurements you need, indoor or outdoor conditions, network access, power source, and any alert thresholds. State units explicitly, such as degrees Celsius, and explain whether a threshold should only notify you or eventually control something.</p>
            <p>Check the specification as the conversation develops. Correct an assumption by sending another message. A suggested part is a match from the registry, not confirmation that the full design has been validated.</p>
            <p>If a reply takes too long, use “Check for a reply.” If the specification has not caught up, use “Refresh build details.” These controls retrieve the existing work; you do not need to repeat the request.</p>
            <p>Generated wiring, downloadable firmware, enclosure artifacts, and checkout still require integration. A design preview alone does not confirm that a flashable device or purchasable kit is ready.</p>
          </Guide>
          <Guide id="flash" title="Prepare to flash">
            <p><strong className="text-ink">Guided flashing is not available yet.</strong> The portal does not currently provide a verified end-to-end flow for selecting a board, downloading its firmware, and provisioning a live device.</p>
            <ul className="list-disc space-y-2 pl-6">
              <li>Identify the exact board and revision, sensor models, and their required supply voltages.</li>
              <li>Wait for a validated wiring plan and a firmware artifact built for that exact configuration before connecting or flashing hardware.</li>
              <li>Keep Wi-Fi passwords and device credentials out of build messages and screenshots.</li>
            </ul>
            <p>You can exercise ingestion without hardware using the repository’s <a href={`${source}docs/TELEMETRY-INGEST.md#run-locally`} className={linkStyle}>local simulator instructions</a>. They require a development checkout, PostgreSQL, and a locally provisioned device. The readings are fixtures, not measurements from a sensor.</p>
          </Guide>
          <Guide id="telemetry" title="Understand telemetry">
            <p>The ingestion service validates each packet and acknowledges it after the database transaction commits. Retrying the same packet and sequence does not add duplicate readings. Reusing that sequence with changed content is rejected.</p>
            <p>Latest readings describe sample time; last seen describes when the server received a packet. Delayed uploads can contain older samples. A missing point is a gap, not a zero reading.</p>
            <p>The read API supports raw samples, minute averages, and hourly averages. Raw queries cover up to 24 hours at a time, minute queries up to 7 days, and hourly queries up to 366 days. Query-window limits are separate from retention: raw retention is approximately 90 days, minute retention approximately 7 days, and hourly summaries remain after raw expiry.</p>
            <p>Rollups are processed separately and may be pending. Expired history is reported explicitly; oversized results require a narrower window or a coarser resolution. History access requires a valid account session and membership in the device’s tenant.</p>
            <p>The read API provides stored fleet status, latest readings, and history. The screens available to you depend on the deployed portal version. Production event streaming, provisioning-derived widgets, and device onboarding still require integration. Demo data does not prove that your hardware is connected. Developers can use the <a href={`${source}docs/TELEMETRY-READ-API.md`} className={linkStyle}>telemetry API reference</a> and <a href={`${source}docs/TELEMETRY-STORAGE.md`} className={linkStyle}>storage and retention reference</a>.</p>
          </Guide>
          <Guide id="troubleshooting" title="Troubleshooting">
            <dl className="space-y-5">
              <div><dt className="font-medium text-ink">My build is still waiting for a reply.</dt><dd className="mt-1">Use “Check for a reply” when it appears. For a failed send, retry the same text using the conversation’s retry flow.</dd></div>
              <div><dt className="font-medium text-ink">The simulator cannot upload.</dt><dd className="mt-1">Check that the local ingestion service and database are running and the credential file belongs to that device. Follow the local guide’s sequence-number instructions for each new invocation. Do not paste the credential into chat.</dd></div>
              <div><dt className="font-medium text-ink">History is empty or unavailable.</dt><dd className="mt-1">Check the device, channel, and time range. Empty data, expired history, and pending rollups have different meanings. For API access, also verify your session and active tenant. Do not fill missing values with zeros.</dd></div>
            </dl>
            <p>Read <Link href="/security" className={linkStyle}>Security and data handling</Link> for implemented controls and the policies still being defined.</p>
          </Guide>
        </div>
      </div>
    </PageContainer>
  );
}
