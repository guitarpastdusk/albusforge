import { BuildList, routes } from "@albusforge/schema";
import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink, PageContainer, PageTitle, Pill } from "@/components/ui";
import { apiGet } from "@/lib/api/server";
import { buildHref, buildStatus } from "@/lib/build-status";
import { formatAgo, pluralize } from "@/lib/format";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage() {
  const { builds } = await apiGet(routes.builds.list.path(), BuildList);
  const now = new Date();

  return (
    <PageContainer>
      <PageTitle
        kicker="Your workspace"
        title="Projects"
        actions={
          <ButtonLink href="/" variant="coral" pill className="px-[26px] py-[13px] text-[16px] font-semibold">
            + New build
          </ButtonLink>
        }
      />

      <ul className="mt-9 grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-[22px]">
        {builds.map((build) => {
          const status = buildStatus[build.display_status];
          return (
            <li key={build.id}>
              <Link
                href={buildHref(build)}
                className="flex h-full flex-col gap-3.5 rounded-[24px] border border-hairline bg-white px-[30px] py-7 text-ink transition-shadow duration-200 hover:text-ink hover:shadow-card"
              >
                <div className="flex items-center justify-between gap-3.5">
                  <Pill accent={status.accent} className="px-4 py-1.5 text-[13px] font-semibold uppercase tracking-[0.04em]">
                    {status.label}
                  </Pill>
                  <span className="font-mono text-[13px] text-faint">{formatAgo(build.updated_at, now, "long")}</span>
                </div>
                <h2 className="font-display text-[26px] font-medium leading-[1.2]">{build.name}</h2>
                <p className="text-[16px] font-light leading-[1.45] text-muted">{build.description}</p>
                <div className="mt-auto flex items-center justify-between border-t border-hairline pt-3.5 text-[14px]">
                  <span className="whitespace-nowrap text-muted">{pluralize(build.device_count, "device")}</span>
                  <span className="font-medium text-coral-deep">{status.action} →</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </PageContainer>
  );
}
