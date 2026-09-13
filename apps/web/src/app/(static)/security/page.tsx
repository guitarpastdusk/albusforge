import type { Metadata } from "next";
import { PageContainer, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Security pledge" };

export default function SecurityPage() {
  return (
    <PageContainer>
      <PageTitle
        kicker="Security"
        title="Security pledge"
        description="How devices are patched and how your data is handled. Written up before launch."
      />
    </PageContainer>
  );
}
