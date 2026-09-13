import { routes, UsageSummary } from "@albusforge/schema";
import type { Metadata } from "next";
import { UsageDashboard } from "@/components/usage/UsageDashboard";
import { apiGet } from "@/lib/api/server";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Usage" };

export default async function UsagePage() {
  const me = await requireSession("/usage");
  const usage = await apiGet(routes.usage.path(), UsageSummary);
  return <UsageDashboard usage={usage} workspace={me.tenant.name} />;
}
