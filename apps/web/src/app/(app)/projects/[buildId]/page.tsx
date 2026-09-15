import type { Metadata } from "next";
import { BuildDetail, routes } from "@albusforge/schema";
import Link from "next/link";
import { ProjectOverview } from "@/components/build/ProjectOverview";
import { PageContainer, PageTitle } from "@/components/ui";
import { apiGet, orNotFound } from "@/lib/api/server";
import { buildStatus } from "@/lib/build-status";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: { params: Promise<{ buildId: string }> }) {
  const { buildId } = await params;
  await requireSession(`/projects/${encodeURIComponent(buildId)}`);
  const build = await orNotFound(apiGet(routes.builds.get.path(buildId), BuildDetail));
  return (
    <PageContainer>
      <Link href="/projects" className="text-[15px] text-muted hover:text-coral-deep">← Projects</Link>
      <div className="mt-[18px]">
        <PageTitle kicker={buildStatus[build.display_status].label} title={build.name} description={build.description} />
      </div>
      <Link href={`/projects/${encodeURIComponent(buildId)}/plan`} className="mt-5 inline-block rounded-xl border border-hairline bg-white px-5 py-3 text-ink hover:text-coral-deep">Review build plan →</Link>
      <Link href={`/projects/${buildId}/firmware`} className="mt-5 inline-block text-coral-deep underline">Firmware versions and downloads</Link>
      <ProjectOverview build={build} />
    </PageContainer>
  );
}
