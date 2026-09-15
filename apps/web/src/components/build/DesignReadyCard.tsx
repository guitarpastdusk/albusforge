import type { DeviceReadyCard } from "@albusforge/schema";
import { ButtonLink, Pill } from "@/components/ui";
import { BuildCircuitDiagram } from "@/components/marketplace/BuildCircuitDiagram";
import { EnclosureDialogButton } from "@/components/enclosure/EnclosureDialog";
import type { EnclosurePreviewData } from "@/components/enclosure/fixture";
import { assumptionsFor, cadence, cloudWorkspace, readyWiring } from "./ready-artifacts";

const usd = (amount: number) => (Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`);

/**
 * Shown once the plan is solved — the only sign-up ask in the chat. Parts come from the plan, never UI strings.
 * `enclosure`: a preview opens the 3D viewer; null says it isn't generated yet; omitted shows neither.
 * `enclosureError`: the body read failed, so instead of a preview the card says so and offers `onRetryEnclosure`.
 */
export function DesignReadyCard({
  card,
  buildId,
  signedIn = false,
  spec = null,
  enclosure,
  enclosureError = null,
  onRetryEnclosure,
}: {
  card: DeviceReadyCard;
  buildId: string;
  signedIn?: boolean;
  /** The latest spec, for what the device will send to its workspace. */
  spec?: Record<string, unknown> | null;
  enclosure?: EnclosurePreviewData | null;
  enclosureError?: string | null;
  onRetryEnclosure?: () => void;
}) {
  const projectHref = `/projects/${encodeURIComponent(buildId)}`;
  const wiring = readyWiring(card);
  const assumed = wiring ? assumptionsFor(card) : [];
  const workspace = cloudWorkspace(spec);
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
      {enclosureError ? (
        <p role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-[14px] text-coral-deep">
          <span>{enclosureError}</span>
          {onRetryEnclosure ? (
            <button type="button" onClick={onRetryEnclosure} className="font-semibold hover:text-coral">
              Try again
            </button>
          ) : null}
        </p>
      ) : null}

      {/* What the design comes with, beside the parts: the body, the wiring, and
          the workspace that will receive its readings. */}
      <dl className="mt-[22px] divide-y divide-hairline border-y border-hairline">
        {enclosure !== undefined && !enclosureError ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 py-4">
            <dt className="text-[16px] text-ink">3D enclosure</dt>
            <dd className="flex flex-1 flex-wrap items-center justify-between gap-3">
              <span className="text-[15px] font-light text-muted">A printed case sized to these parts.</span>
              <EnclosureDialogButton preview={enclosure} title={card.name} />
            </dd>
          </div>
        ) : null}

        <div className="py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <dt className="text-[16px] text-ink">Circuit diagram</dt>
            <dd className="flex-1 text-[15px] font-light text-muted">
              {wiring
                ? "Example wiring: every connector pin and the volts each part sees, from the registry."
                : "Drawn once every part on this design is a registry part."}
            </dd>
          </div>
          {wiring ? (
            <details className="mt-3 group">
              <summary className="w-fit cursor-pointer list-none rounded-full border border-hairline bg-porcelain px-[18px] py-2 text-[15px] text-ink transition-colors hover:border-coral hover:text-coral-deep">
                <span className="group-open:hidden">Show the circuit diagram</span>
                <span className="hidden group-open:inline">Hide the circuit diagram</span>
              </summary>
              <div className="mt-3 rounded-[16px] border border-hairline bg-porcelain px-4 py-4">
                {/* The viewer is told what is assumed, not just the source. */}
                {assumed.length > 0 ? (
                  <p className="mb-3 rounded-[12px] border border-dashed border-coral-deep/40 bg-white px-4 py-3 text-[14px] font-light leading-[1.45] text-coral-deep">
                    <span className="font-mono text-[12px] uppercase tracking-[0.16em]">Example wiring</span>
                    <br />
                    The parts and their pins are real. Assumed, because the design doesn&apos;t record them yet: {assumed.join("; ")}. Check these before building.
                  </p>
                ) : null}
                <BuildCircuitDiagram wiring={wiring} buildName={card.name} />
              </div>
            </details>
          ) : null}
        </div>

        <div className="py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <dt className="text-[16px] text-ink">Cloud workspace</dt>
            <dd className="flex-1 text-[15px] font-light text-muted">
              {signedIn ? "This build already belongs to your workspace." : "Created when you sign up — this build is anonymous until then."}
            </dd>
          </div>
          {workspace.channels.length > 0 ? (
            <p className="mt-2 font-mono text-[13px] text-muted">
              sends {workspace.channels.join(" · ")}
              {workspace.everySeconds === null ? "" : `, ${cadence(workspace.everySeconds)}`}
            </p>
          ) : null}
        </div>
      </dl>
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
