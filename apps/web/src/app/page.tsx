import { getBuildSignedIn } from "@/lib/session";
import { BuildConversation, WhenConversationEmpty } from "@/components/build/BuildConversation";
import { ConversationView } from "@/components/build/ConversationView";
import { DeviceCarousel } from "@/components/carousel/DeviceCarousel";
import { ChatStart } from "@/components/landing/ChatStart";
import { enclosurePreviewFor } from "@/components/enclosure/fixture";
import { seededAsk } from "@/lib/clone-ask";
import { loadShowcaseCards } from "@/lib/showcase";

/** `?ask=` seeds the input: the Marketplace's "Clone build" (lib/clone-ask.ts). */
export default async function LandingPage({ searchParams }: { searchParams: Promise<{ ask?: string | string[] }> }) {
  const [{ cards, examples }, params] = await Promise.all([loadShowcaseCards(), searchParams]);

  return (
    <BuildConversation
      signedIn={getBuildSignedIn()}
      initialDraft={seededAsk(params.ask)}
      enclosurePreview={enclosurePreviewFor()}
    >
      <main className="flex flex-1 flex-col">
        <WhenConversationEmpty>
          <div className="flex flex-1 flex-col items-center px-8 py-[72px] text-center">
            <p className="mb-5 font-mono text-[14px] uppercase tracking-[0.24em] text-coral-deep">
              Physical AI, built from a sentence
            </p>
            <h1 className="max-w-[720px] font-display text-[clamp(30px,3.4vw,44px)] font-medium leading-[1.15] tracking-[-0.01em]">
              Your own <em className="italic text-coral">Physical AI</em>.
            </h1>
            <p className="mt-3.5 max-w-[620px] text-[18px] font-light leading-[1.5] text-muted">
              Describe the device you want and what you require it to do. We design it, pick the parts, write the
              firmware, and ship the kit ready to deploy, sense and act.
            </p>
            <ChatStart />
            <DeviceCarousel cards={cards} examples={examples} />
          </div>
        </WhenConversationEmpty>
        <ConversationView />
      </main>
    </BuildConversation>
  );
}
