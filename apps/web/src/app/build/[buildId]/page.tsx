import { getBuildSignedIn } from "@/lib/session";
import { BuildDetail, MessageList, routes } from "@albusforge/schema";
import type { Metadata } from "next";
import { BuildConversation } from "@/components/build/BuildConversation";
import { ConversationView } from "@/components/build/ConversationView";
import { enclosurePreviewFor } from "@/components/enclosure/fixture";
import { apiGet, orNotFound } from "@/lib/api/server";
import { transcriptFrom } from "@/lib/build-transcript";
import { loadRuntimeConfig } from "@/lib/runtime-config";

export const metadata: Metadata = { title: "Build" };

/** A build conversation, reopened from its URL. The landing chat moves here after the first message. */
export default async function BuildPage({ params }: { params: Promise<{ buildId: string }> }) {
  const { buildId } = await params;
  const [build, { messages }] = await Promise.all([
    orNotFound(apiGet(routes.builds.get.path(buildId), BuildDetail)),
    orNotFound(apiGet(routes.builds.messages.path(buildId), MessageList)),
  ]);

  return (
    <BuildConversation signedIn={getBuildSignedIn()}
      initial={transcriptFrom(build, messages)}
      enclosurePreview={enclosurePreviewFor(loadRuntimeConfig(process.env).apiMode)}
    >
      <main className="flex flex-1 flex-col">
        <ConversationView active />
      </main>
    </BuildConversation>
  );
}
