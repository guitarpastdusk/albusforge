import type { DeviceReadyCard } from "@albusforge/schema";
import { ButtonLink, Pill } from "@/components/ui";
import { EnclosureDialogButton } from "@/components/enclosure/EnclosureDialog";
import type { EnclosurePreviewData } from "@/components/enclosure/fixture";

const usd = (amount: number) => (Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`);

/**
 * Shown once the plan is solved — the only sign-up ask in the chat. Parts come from the plan, never UI strings.
 * `enclosure`: a preview opens the 3D viewer; null says it isn't generated yet (live mode); omitted shows neither.
 */
export function DesignReadyCard({ card, buildId, signedIn = false, enclosure }: { card: DeviceReadyCard; buildId: string; signedIn?: boolean; enclosure?: EnclosurePreviewData | null }) {
  const projectHref = `/projects/${encodeURIComponent(buildId)}`;
  return (
    <section aria-label="Device design ready" className="rounded-[24px] border border-hairline bg-white px-[34px] py-[30px]">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="font-mono text-[14px] uppercase tracking-[0.18em] text-success">✓ Device design ready</div>
        <span className="font-mono text-[14px] text-muted">
          est. {usd(card.est_price_usd)} · {card.fulfillment_note}
        </span>
      </div>
      <h3 className="mt-3.5 font-display text-[28px] font-medium">{card.name}</h3>
      <ul className="mt-4 flex flex-wrap gap-2">
        {card.parts.map((part) => (
          <li key={part.part_id}>
            <Pill accent={part.accent} className="px-4 py-[7px] text-[14px]">
              {part.label}
            </Pill>
          </li>
        ))}
      </ul>
      {enclosure !== undefined ? (
        <div className="mt-4">
          <EnclosureDialogButton preview={enclosure} title={card.name} />
        </div>
      ) : null}
      <div className="mt-[22px] flex flex-wrap items-center justify-between gap-5 rounded-2xl bg-porcelain px-6 py-5">
        <p className="max-w-[420px] text-[16px] font-light leading-[1.45] text-muted">
          {signedIn ? "Your design is saved in your workspace. Open the project to review it." : "Create an account to save this build and return to its project."}
        </p>
        <ButtonLink href={signedIn ? projectHref : `/signup?next=${encodeURIComponent(projectHref)}`} variant="coral" className="rounded-[14px] px-[26px] py-[13px] text-[16px] font-semibold">
          {signedIn ? "Open project →" : "Sign up to continue →"}
        </ButtonLink>
      </div>
    </section>
  );
}
