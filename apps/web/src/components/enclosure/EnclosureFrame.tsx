import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { ENCLOSURE_VIEWS, type EnclosureView } from "./modes";

/** The porcelain stage the canvas, image, loading and error states fill. */
export const STAGE_CLASS = "relative aspect-[4/3] w-full overflow-hidden rounded-[18px] bg-porcelain";

/** The white card: mono kicker, dimensions, controls, stage, description. No three.js. */
export function EnclosureFrame({
  titleId,
  descriptionId,
  dimensionsLabel,
  description,
  controls,
  footer,
  children,
}: {
  titleId: string;
  descriptionId: string;
  dimensionsLabel: string | null;
  description: string;
  controls?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="rounded-[24px] border border-hairline bg-white px-5 pt-5 pb-5 sm:px-7 sm:pt-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={titleId} className="font-mono text-[13px] uppercase tracking-[0.2em] text-coral-deep">
          Enclosure · 3D preview
        </h3>
        {dimensionsLabel ? <span className="font-mono text-[13px] text-muted">{dimensionsLabel}</span> : null}
      </div>
      {controls ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3">{controls}</div> : null}
      <div className="mt-4">{children}</div>
      <p id={descriptionId} className="mt-3 text-[14px] font-light leading-[1.5] text-muted">
        {description}
      </p>
      {footer}
    </section>
  );
}

/** Base / Lid / Exploded, in the design's pill style with coral for the selected view. */
export function ViewControls({
  view,
  onChange,
  disabled = false,
}: {
  view: EnclosureView;
  onChange: (view: EnclosureView) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label="Enclosure view" className="flex flex-wrap gap-2">
      {ENCLOSURE_VIEWS.map(({ id, label }) => {
        const selected = view === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={cx(
              "rounded-full border px-[18px] py-2 text-[14px]",
              selected ? "border-coral bg-coral font-semibold text-white" : "border-hairline bg-white text-muted hover:text-ink",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
