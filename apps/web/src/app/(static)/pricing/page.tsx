import type { Accent } from "@albusforge/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, Card, Kicker, PageContainer, PageTitle, Pill } from "@/components/ui";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Kits ship at the cost of their parts plus assembly; cloud plans start free. Introductory pricing for the preview.",
};

/*
 * Introductory pricing for the preview. Nothing here is billed yet: there is
 * no checkout, and the numbers are the team's working estimates, tracked in
 * docs/DEMO-ASSUMPTIONS.md so they can be replaced when pricing is set.
 * Every kit line follows what the registry and portal already do: parts are
 * priced from the registry (example builds show "About $NN in parts"), and
 * the device-ready card's estimate is "est. $NN".
 */

interface Plan {
  name: string;
  accent: Accent;
  price: string;
  per: string;
  summary: string;
  includes: readonly string[];
  cta: { label: string; href: string };
}

const KITS: readonly Plan[] = [
  {
    name: "Parts only",
    accent: "blue",
    price: "Parts cost",
    per: "no markup",
    summary: "The parts list, priced from the registry, to order and assemble yourself.",
    includes: ["Every part with its supplier and price", "Wiring diagram from the registry's connector tables", "Firmware built for your exact parts", "3D-printable enclosure files"],
    cta: { label: "Start a build →", href: "/" },
  },
  {
    name: "Kit",
    accent: "peach",
    price: "Parts + $29",
    per: "per kit, assembled",
    summary: "The same design, assembled, flashed and tested before it ships. Plug it in and it appears in your workspace.",
    includes: ["Everything in Parts only", "Assembled and flashed", "Printed enclosure", "Pre-provisioned for your workspace"],
    cta: { label: "Start a build →", href: "/" },
  },
];

const CLOUD: readonly Plan[] = [
  {
    name: "Hobby",
    accent: "green",
    price: "$0",
    per: "per month",
    summary: "For one or two devices at home.",
    includes: ["Up to 3 devices", "30 days of readings", "Sensor questions, 200 a month", "Community Marketplace"],
    cta: { label: "Create an account →", href: "/signup" },
  },
  {
    name: "Maker",
    accent: "violet",
    price: "$9",
    per: "per month",
    summary: "For a workshop, a greenhouse or a small fleet.",
    includes: ["Up to 25 devices", "1 year of readings", "Sensor questions, 2,000 a month", "Camera observations", "Rules that act on the device"],
    cta: { label: "Create an account →", href: "/signup" },
  },
  {
    name: "Team",
    accent: "blue",
    price: "$49",
    per: "per month",
    summary: "For a shared workspace with operators and admins.",
    includes: ["Up to 250 devices", "3 years of readings", "Sensor questions, 20,000 a month", "Workspace roles and audit log", "Email support"],
    cta: { label: "Create an account →", href: "/signup" },
  },
];

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <li>
      <Card className="flex h-full flex-col px-7 pt-6 pb-7">
        <div className="flex items-center justify-between">
          <Pill accent={plan.accent} className="px-3.5 py-1.5 text-[13px] font-semibold uppercase tracking-[0.05em]">
            {plan.name}
          </Pill>
        </div>
        <p className="mt-5 font-display text-[36px] font-medium leading-none tracking-[-0.01em]">{plan.price}</p>
        <p className="mt-1.5 font-mono text-[13px] text-muted">{plan.per}</p>
        <p className="mt-4 text-[15px] font-light leading-[1.5] text-muted">{plan.summary}</p>
        <ul className="mt-5 flex flex-1 flex-col gap-2 text-[15px] leading-[1.45]">
          {plan.includes.map((line) => (
            <li key={line} className="flex gap-2.5">
              <span aria-hidden className="text-success">
                ✓
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <ButtonLink href={plan.cta.href} variant="dark" className="mt-7 rounded-[14px] px-6 py-3 text-[15px] font-medium">
          {plan.cta.label}
        </ButtonLink>
      </Card>
    </li>
  );
}

function Section({ id, kicker, title, description, plans }: { id: string; kicker: string; title: string; description: string; plans: readonly Plan[] }) {
  return (
    <section aria-labelledby={id} className="mt-16">
      <Kicker size={13}>{kicker}</Kicker>
      <h2 id={id} className="mt-2 font-display text-[32px] font-medium tracking-[-0.01em]">
        {title}
      </h2>
      <p className="mt-3 max-w-[620px] text-[17px] font-light leading-[1.5] text-muted">{description}</p>
      <ul className="mt-7 grid gap-[22px] sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard key={plan.name} plan={plan} />
        ))}
      </ul>
    </section>
  );
}

export default function PricingPage() {
  return (
    <PageContainer>
      <PageTitle
        kicker="Pricing"
        title="Pay for parts. Start in the cloud for free."
        description="A kit costs what its parts cost, plus assembly if you want it built. The cloud that watches it starts free."
      />

      <aside aria-label="About these prices" className="mt-8 max-w-[720px] rounded-2xl border border-hairline bg-porcelain px-6 py-5">
        <p className="font-mono text-[13px] uppercase tracking-[0.18em] text-coral-deep">Introductory pricing</p>
        <p className="mt-2 text-[16px] font-light leading-[1.5] text-ink">
          These are the preview&apos;s planned prices, not a bill: nothing is charged today, and every build starts free. Part
          prices come from the registry and change with suppliers.
        </p>
      </aside>

      <Section
        id="kits"
        kicker="Kits"
        title="The device"
        description="Every build prices its parts from our registry as it is designed, so you see the cost before anything ships."
        plans={KITS}
      />

      <Section
        id="cloud"
        kicker="Cloud plans"
        title="The cloud that closes the loop"
        description="Readings, questions answered from your data, and rules that act back on the device. Plans differ in how many devices and how long readings are kept."
        plans={CLOUD}
      />

      <section aria-labelledby="pricing-questions" className="mt-16 max-w-[640px]">
        <h2 id="pricing-questions" className="font-display text-[26px] font-medium">
          Common questions
        </h2>
        <dl className="mt-5 flex flex-col gap-5 text-[16px] font-light leading-[1.5] text-muted">
          <div>
            <dt className="font-medium text-ink">Do I need a plan to design a device?</dt>
            <dd className="mt-1">No. Designing, the parts list, wiring and enclosure files are free. A plan covers the devices you connect.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Can I use my own hardware?</dt>
            <dd className="mt-1">Yes. If your board and sensors are in the registry, the same firmware and cloud work with them at no kit cost.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">What happens to my data?</dt>
            <dd className="mt-1">
              It stays yours. How it is stored, and how devices are patched, is written up in our{" "}
              <Link href="/security" className="font-medium text-coral-deep hover:text-coral">
                Security pledge
              </Link>
              .
            </dd>
          </div>
        </dl>
      </section>
    </PageContainer>
  );
}
