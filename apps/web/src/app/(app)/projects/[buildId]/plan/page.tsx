import type { Metadata } from "next";
import Link from "next/link";
import { BuildPlanPage } from "@albusforge/schema";
import { BuildPlanPanel } from "@/components/build/BuildPlanPanel";
import { PageContainer, PageTitle } from "@/components/ui";
import { apiGet, orNotFound } from "@/lib/api/server";
import { requireSession } from "@/lib/session";
export const metadata:Metadata={title:"Build plan"};
export default async function PlanPage({params}:{params:Promise<{buildId:string}>}){
  const {buildId}=await params,path=`/projects/${encodeURIComponent(buildId)}/plan`;
  const session=await requireSession(path);
  const page=await orNotFound(apiGet(`/v1/builds/${encodeURIComponent(buildId)}/plans`,BuildPlanPage));
  return <PageContainer><Link href={`/projects/${encodeURIComponent(buildId)}`} className="text-muted hover:text-coral-deep">← Project</Link><div className="mt-5"><PageTitle kicker="Pinned design" title="Build plan" description="Review the bill of materials and assembly evidence for an exact spec revision."/></div><BuildPlanPanel key={`${page.build_id}:${page.current_spec_version}`} page={page} tenantId={session.tenant.id}/></PageContainer>;
}
