import type { Metadata } from "next";
import { PageContainer, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <PageContainer>
      <PageTitle kicker="Pricing" title="Pricing" description="Kits, cloud plans and what each includes. Coming soon." />
    </PageContainer>
  );
}
