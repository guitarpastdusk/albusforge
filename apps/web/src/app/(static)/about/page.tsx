import type { Accent } from "@albusforge/schema";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink, Card, Kicker, PageContainer, PageTitle, Pill } from "@/components/ui";

export const metadata: Metadata = {
  title: "About us",
  description:
    "Albus Forge turns a plain-language request into a working device — parts, enclosure, firmware — and an AI cloud that closes the loop.",
};

/*
 * Every claim is traceable to one of three sources, and worded close to it:
 *   - docs/checkin/CHECKIN-1.md (the tagline, the loop, principles, team, the hackathon)
 *   - README.md (the parts cart, enclosure, firmware, the part registry)
 *   - the design template (template.html): "Being built with ♥ at MIT" (footer),
 *     "ship the kit ready to deploy, sense and act" (landing subline) and
 *     "ships in kit form" (device-ready card), "Save your build. Own your data." (register card)
 * The "Why we’re building this" section is the user's own copy (approved 2026-09-13).
 * No people, roles, customers, logos, funding or metrics beyond those.
 */

const PIPELINE: Array<{ label: string; accent: Accent; title: string; body: string }> = [
  // CHECKIN-1: "One question in." and the example request.
  { label: "Ask", accent: "peach", title: "A plain-language request", body: "One question in: “keep my greenhouse soil moist.”" },
  // README: "a parts cart of real components from a curated registry".
  { label: "Parts", accent: "blue", title: "A real parts cart", body: "Real components from a curated part registry." },
  { label: "Enclosure", accent: "violet", title: "A 3D-printable enclosure", body: "Generated around those exact parts." },
  { label: "Firmware", accent: "green", title: "Working firmware", body: "Only the app layer is generated." },
  // Design template: "ship the kit ready to deploy, sense and act"; "ships in kit form".
  { label: "Kit", accent: "peach", title: "A kit", body: "Parts, firmware and enclosure ship as a kit." },
  {
    label: "Live",
    accent: "green",
    title: "Live in the cloud",
    body: "The device connects to an AI cloud platform that watches its data, reasons about it and acts back on the device.",
  },
];

const LOOP: Array<{ step: string; body: string }> = [
  { step: "Sense", body: "Telemetry arrives already typed: the part registry declares each channel’s unit, range and meaning before the first packet." },
  { step: "Detect", body: "Statistics run on every data window — learned baselines, seasonality and drift — to find anomalies cheaply, without a model." },
  { step: "Reason", body: "A small model names and triages each detection; a frontier model answers questions through typed queries." },
  { step: "Act", body: "The platform sends commands back to the device — thresholds, setpoints, schedules — or opens a work order." },
  { step: "Confirm", body: "The next telemetry shows whether the action worked, and every confirmed outcome improves the baselines." },
];

const PRINCIPLES: Array<{ title: string; body?: ReactNode }> = [
  {
    title: "One curated part registry drives everything.",
    body: "One data object, the Part Definition, threads through every service. No service hard-codes knowledge about a specific part.",
  },
  {
    title: "Every number comes from the data, never from the model.",
    body: "Models answer questions through typed queries against your telemetry.",
  },
  {
    title: "A person or a policy confirms every action.",
    body: "Actions a model proposes need a person, or a policy, to confirm them.",
  },
  // Design template, register card: "Save your build. Own your data."
  { title: "Own your data." },
  {
    title: "Security patches.",
    body: (
      <>
        How devices are patched and how your data is handled is written up in our{" "}
        <Link href="/security" className="font-medium text-coral-deep hover:text-coral">
          Security pledge
        </Link>
        .
      </>
    ),
  },
];

function Section({ id, kicker, title, children }: { id: string; kicker: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-16">
      <Kicker size={13}>{kicker}</Kicker>
      <h2 id={id} className="mt-2 font-display text-[32px] font-medium tracking-[-0.01em]">
        {title}
      </h2>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <PageContainer>
      <PageTitle
        kicker="About us"
        title="Physical AI, built from a sentence"
        description="One question in. A working device out, and an AI cloud that closes the loop."
      />

      {/* Copy approved by the user, 2026-09-13; expand later. */}
      <Section id="why" kicker="Why we’re building this" title="Physical AI should be something anyone can build.">
        <div className="flex max-w-[640px] flex-col gap-4 text-[17px] font-light leading-[1.6] text-muted">
          <p>
            Making a device that senses and acts still means choosing parts, wiring, writing firmware and building cloud
            plumbing, and every step needs expertise. We think a plain sentence should be enough.
          </p>
          <p>
            A gadget that works is a weekend project. A gadget whose data turns into answers, and then into action, is one
            worth keeping. So we don’t stop at a dashboard: every device we generate closes the loop.
          </p>
          <p>
            It also has to be trustworthy. That means real parts, numbers that come from the data, and a person in charge of
            every action.
          </p>
        </div>
      </Section>

      <Section id="what-we-build" kicker="What we build" title="From a plain-language request to a working device">
        <ol className="grid gap-[22px] sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map(({ label, accent, title, body }, i) => (
            <li key={label}>
              <Card className="h-full px-7 pt-6 pb-7">
                <div className="flex items-center justify-between">
                  <Pill accent={accent} className="px-3.5 py-1.5 text-[13px] font-semibold uppercase tracking-[0.05em]">
                    {label}
                  </Pill>
                  <span className="font-mono text-[14px] text-faint">{String(i + 1).padStart(2, "0")}</span>
                </div>
                <h3 className="mt-4 font-display text-[23px] font-medium leading-[1.2]">{title}</h3>
                <p className="mt-2 text-[15px] font-light leading-[1.5] text-muted">{body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </Section>

      <Section id="closed-loop" kicker="The closed loop" title="Sense → Detect → Reason → Act → Confirm">
        <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {LOOP.map(({ step, body }, i) => (
            <li key={step}>
              <Card className="h-full px-6 pt-5 pb-6">
                <span className="font-mono text-[13px] text-coral-deep">{`${i + 1} · ${step}`}</span>
                <h3 className="mt-2 font-display text-[22px] font-medium">{step}</h3>
                <p className="mt-2 text-[14px] font-light leading-[1.5] text-muted">{body}</p>
              </Card>
            </li>
          ))}
        </ol>
        <p className="mt-5 max-w-[720px] text-[16px] font-light leading-[1.5] text-muted">
          The loop starts on the device: reflex rules keep working offline, and the cloud adds judgment on top.
        </p>
      </Section>

      <Section id="principles" kicker="Our principles" title="What we hold ourselves to">
        <ul className="grid gap-[22px] sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map(({ title, body }) => (
            <li key={title}>
              <Card className="h-full px-7 pt-6 pb-7">
                <h3 className="font-display text-[21px] font-medium leading-[1.25]">{title}</h3>
                {body ? <p className="mt-2 text-[15px] font-light leading-[1.5] text-muted">{body}</p> : null}
              </Card>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="team" kicker="Team" title="Team Albus">
        <div className="grid gap-[22px] lg:grid-cols-[1fr_1fr]">
          <Card className="flex items-center gap-5 px-7 py-7">
            <span
              aria-hidden
              className="flex size-16 shrink-0 items-center justify-center rounded-full bg-pastel-peach text-[22px] font-semibold text-coral-deep"
            >
              SD
            </span>
            <div>
              {/* CHECKIN-1: "Team: Albus · Solo hacker: Sukrit Dasgupta"; the design footer: "Being built with ♥ at MIT". */}
              <h3 className="font-display text-[24px] font-medium">Sukrit Dasgupta</h3>
              <p className="mt-1 text-[15px] font-light text-muted">Solo hacker, Team Albus</p>
              <p className="mt-3 text-[15px] font-light leading-[1.5] text-muted">
                Being built at MIT, for the Battle of the Coasts hackathon, in the{" "}
                <Pill accent="violet" className="px-2.5 py-0.5 text-[13px] font-medium">
                  Deep Tech / Physical AI
                </Pill>{" "}
                track.
              </p>
            </div>
          </Card>

          <Card className="flex flex-col justify-between gap-5 bg-porcelain px-7 py-7">
            <div>
              <Kicker size={13}>Get in touch</Kicker>
              {/* The landing subline and the register card, verbatim. */}
              <h3 className="mt-2 font-display text-[24px] font-medium">Describe the device you want.</h3>
              <p className="mt-2 text-[15px] font-light leading-[1.5] text-muted">Save your build. Own your data.</p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <ButtonLink href="/" variant="dark" pill className="px-6 py-[11px] text-[15px] font-medium">
                Start a build →
              </ButtonLink>
              <Link href="/signup" className="text-[15px] text-coral-deep hover:text-coral">
                Create an account
              </Link>
            </div>
          </Card>
        </div>
      </Section>
    </PageContainer>
  );
}
