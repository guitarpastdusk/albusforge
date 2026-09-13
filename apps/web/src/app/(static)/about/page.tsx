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
 * Content from the project's own docs only (README, check-in 1). No people,
 * customers, logos, funding or metrics beyond what those say.
 */

const PIPELINE: Array<{ label: string; accent: Accent; title: string; body: string }> = [
  { label: "Ask", accent: "peach", title: "A plain-language request", body: "“Keep my greenhouse soil moist.” One sentence is the brief." },
  { label: "Parts", accent: "blue", title: "A real parts cart", body: "Real components, picked from one curated part registry." },
  { label: "Enclosure", accent: "violet", title: "A 3D-printable enclosure", body: "Generated around those exact parts." },
  { label: "Firmware", accent: "green", title: "Working firmware", body: "Only the app layer is generated." },
  { label: "Kit", accent: "peach", title: "A kit", body: "The parts for your build, shipped in kit form." },
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

const PRINCIPLES: Array<{ title: string; body: ReactNode }> = [
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
  { title: "You own your data.", body: "Your builds and your devices’ readings are yours." },
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

      <Section id="what-we-build" kicker="What we build" title="From a request to a device that’s live">
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
                <p className="mt-2 text-[15px] font-light leading-[1.5] text-muted">{body}</p>
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
              <h3 className="font-display text-[24px] font-medium">Sukrit Dasgupta</h3>
              <p className="mt-1 text-[15px] font-light text-muted">Founder · building at MIT</p>
              <p className="mt-3 text-[15px] font-light leading-[1.5] text-muted">
                Being built for the Battle of the Coasts hackathon, in the{" "}
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
              <h3 className="mt-2 font-display text-[24px] font-medium">Describe the device you want.</h3>
              <p className="mt-2 text-[15px] font-light leading-[1.5] text-muted">
                Start a build from a sentence, or create an account to save it.
              </p>
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
