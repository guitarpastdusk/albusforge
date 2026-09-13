import type { Metadata } from "next";
import { PageContainer, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Docs" };

export default function DocsPage() {
  return (
    <PageContainer>
      <PageTitle kicker="Docs" title="Documentation" description="Guides for building, flashing and running your device. Coming soon." />
    </PageContainer>
  );
}
