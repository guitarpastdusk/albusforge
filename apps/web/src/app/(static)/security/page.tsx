import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageContainer, PageTitle } from "@/components/ui";

export const metadata: Metadata = {
  title: "Security and data handling",
  description: "Implemented account and telemetry controls, and security policies still being defined.",
};

const controls = [
  { title: "Account sessions", body: "The gateway issues random session tokens and stores their hashes. Session cookies use Secure, HttpOnly, and SameSite=Lax attributes. Signing out revokes the session family on the server." },
  { title: "Telemetry access", body: "Telemetry reads check the account session and current tenant membership. Device queries are scoped to that tenant. Responses use private, no-store cache controls." },
  { title: "Device credentials", body: "Uploads use a separate device bearer credential; the database stores its hash. A revoked credential cannot authorize a new upload. Device credentials do not grant access to account telemetry queries." },
  { title: "Validated, durable uploads", body: "Ingestion validates packet structure, provisioned channels, value ranges, and timestamps before committing readings. An acknowledgment follows a successful transaction. Identical retries do not duplicate stored samples." },
];

export default function SecurityPage() {
  return (
    <PageContainer>
      <PageTitle kicker="Security" title="Security and data handling" description="These controls are implemented in the repository. Production rollout and policy commitments require separate verification." />
      <section aria-labelledby="controls" className="mt-10">
        <h2 id="controls" className="font-display text-[28px] font-medium">Implemented controls</h2>
        <ul className="mt-6 grid gap-5 sm:grid-cols-2">
          {controls.map(({ title, body }) => <li key={title}><Card className="h-full p-6"><h3 className="font-display text-[23px] font-medium">{title}</h3><p className="mt-3 leading-relaxed text-muted">{body}</p></Card></li>)}
        </ul>
      </section>
      <section aria-labelledby="policies" className="mt-12 max-w-[760px]">
        <h2 id="policies" className="font-display text-[28px] font-medium">Before launch</h2>
        <p className="mt-4 leading-relaxed text-muted">The security patch policy, supported device lifetime, vulnerability reporting process, privacy notice, and terms are still being defined. Automatic signed firmware updates and a fleet patch rollout are not currently provided by this portal. This page does not establish a patch-duration, compliance, or service guarantee.</p>
        <p className="mt-4 leading-relaxed text-muted">Keep session cookies, email codes, device tokens, and Wi-Fi passwords private. Use a local development device for simulator experiments.</p>
        <Link href="/docs" className="mt-6 inline-block font-medium text-coral-deep underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Read the setup and telemetry guides</Link>
      </section>
    </PageContainer>
  );
}
