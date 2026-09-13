import { BuildDetail, routes } from "@albusforge/schema";
import Link from "next/link";
import { EnclosurePreview } from "@/components/enclosure/EnclosurePreview";
import { enclosurePreviewFor } from "@/components/enclosure/fixture";
import { PageContainer, PageTitle, Pill } from "@/components/ui";
import { apiGet, orNotFound } from "@/lib/api/server";
import { buildStatus } from "@/lib/build-status";
import { loadRuntimeConfig } from "@/lib/runtime-config";
import { requireSession } from "@/lib/session";

export default async function ProjectPage({ params }: { params: Promise<{ buildId: string }> }) {
  const { buildId } = await params;
  await requireSession(`/projects/${encodeURIComponent(buildId)}`);
  const build = await orNotFound(apiGet(routes.builds.get.path(buildId), BuildDetail));
  const status = buildStatus[build.display_status];

  return (
    <PageContainer>
      <Link href="/projects" className="text-[15px] text-muted hover:text-coral-deep">
        ← Projects
      </Link>
      <div className="mt-[18px]">
        <PageTitle kicker={status.label} title={build.name} description={build.description} />
      </div>

      {build.ready ? (
        <ul className="mt-8 flex flex-wrap gap-2">
          {build.ready.parts.map((part) => (
            <li key={part.part_id}>
              <Pill accent={part.accent} className="px-4 py-[7px] text-[14px]">
                {part.label}
              </Pill>
            </li>
          ))}
        </ul>
      ) : null}

      <section aria-labelledby="enclosure-heading" className="mt-10 max-w-[760px]">
        <h2 id="enclosure-heading" className="font-display text-[28px] font-medium">
          Enclosure
        </h2>
        <div className="mt-4">
          {/* Mock mode: the fixture model. Live mode: a placeholder until the body endpoint exists (M5.5). */}
          <EnclosurePreview preview={enclosurePreviewFor(loadRuntimeConfig(process.env).apiMode)} />
        </div>
      </section>

      <p className="mt-8 max-w-[560px] text-[16px] font-light leading-[1.5] text-muted">
        Stub — this screen isn’t designed yet. It is where “{status.action}” lands: kit tracking, the parts review,
        or the conversation, depending on status.
      </p>
    </PageContainer>
  );
}
