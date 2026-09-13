"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useId, useState, useSyncExternalStore } from "react";
import { Button, Kicker, Toggle } from "@/components/ui";
import { cx } from "@/lib/cx";
import { EnclosureFrame, STAGE_CLASS, ViewControls } from "./EnclosureFrame";
import type { EnclosurePreviewData } from "./fixture";
import { previewMode, supportsWebGL, type EnclosureView } from "./modes";

/**
 * three.js lives only in this chunk: fetched in the browser when a preview
 * renders, never server-rendered and never part of a page's initial JS
 * (Next's lazy-loading guide: next/dynamic with ssr: false, in a Client Component).
 */
const EnclosureCanvas = dynamic(() => import("./EnclosureCanvas"), { ssr: false });

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
const noSubscription = () => () => {};

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

type Status = "loading" | "ready" | "error";

/**
 * The 360° enclosure viewer card (M5.5, docs/ASK-TO-ENCLOSURE.md §6): view,
 * parts and reset controls, the lazily loaded 3D stage, and its loading,
 * error and static-image states. `preview` null is live mode before bodies
 * exist: a placeholder, and nothing is fetched.
 */
export function EnclosurePreview({ preview, autoRotate = false }: { preview: EnclosurePreviewData | null; autoRotate?: boolean }) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const hintId = `${id}-hint`;

  // null on the server and during hydration: the loading state renders until the browser answers.
  const webgl = useSyncExternalStore(noSubscription, () => supportsWebGL(), () => null);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia?.(REDUCED_MOTION).matches ?? false, () => false);

  const [view, setView] = useState<EnclosureView>("base");
  const [showParts, setShowParts] = useState(false);
  const [resetToken, setResetToken] = useState(0);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);

  if (!preview) {
    return (
      <EnclosureFrame
        titleId={titleId}
        descriptionId={descriptionId}
        dimensionsLabel={null}
        description="The 3D preview appears here once the enclosure is generated."
      >
        <div className={cx(STAGE_CLASS, "grid place-items-center")}>
          <p className="px-6 text-center font-mono text-[14px] text-muted">Preview available once the enclosure is generated</p>
        </div>
      </EnclosureFrame>
    );
  }

  const mode = webgl === null ? "checking" : previewMode({ webgl, reducedMotion, autoRotate });
  const interactive = mode === "interactive";

  const controls = (
    <>
      <ViewControls view={view} onChange={setView} disabled={!interactive} />
      <div className="flex items-center gap-5">
        <span className="flex items-center gap-2.5">
          <Toggle checked={showParts} onChange={() => setShowParts((shown) => !shown)} label="Show parts" disabled={!interactive} />
          <span aria-hidden className="text-[14px] text-muted">
            Show parts
          </span>
        </span>
        <button
          type="button"
          onClick={() => setResetToken((token) => token + 1)}
          disabled={!interactive}
          className="text-[14px] font-medium text-coral-deep hover:text-coral disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset view
        </button>
      </div>
    </>
  );

  return (
    <EnclosureFrame
      titleId={titleId}
      descriptionId={descriptionId}
      dimensionsLabel={preview.dimensionsLabel}
      description={preview.description}
      controls={controls}
      footer={
        <p id={hintId} className="mt-1.5 font-mono text-[12px] text-faint">
          {mode === "static"
            ? "Still image — the interactive preview needs WebGL and motion."
            : "Drag to rotate · scroll or pinch to zoom · right-drag to pan · arrow keys rotate"}
        </p>
      }
    >
      <div className={STAGE_CLASS}>
        {mode === "static" ? (
          <Image src={preview.staticImageUrl} alt={preview.description} fill unoptimized sizes="(max-width: 760px) 100vw, 760px" className="object-contain" />
        ) : null}

        {interactive ? (
          <EnclosureCanvas
            key={attempt}
            glbUrl={preview.glbUrl}
            view={view}
            showParts={showParts}
            resetToken={resetToken}
            autoRotate={autoRotate}
            label={`3D model of the enclosure, ${preview.dimensionsLabel}`}
            describedBy={`${descriptionId} ${hintId}`}
            onReady={() => setStatus("ready")}
            onError={() => setStatus("error")}
          />
        ) : null}

        {mode === "checking" || (interactive && status === "loading") ? (
          <div role="status" className="pointer-events-none absolute inset-0 grid place-items-center font-mono text-[13px] text-muted">
            Loading 3D preview…
          </div>
        ) : null}

        {interactive && status === "error" ? (
          <div role="alert" className="absolute inset-0 flex flex-col items-start justify-center gap-3 bg-porcelain px-7">
            <Kicker size={13}>Service unavailable</Kicker>
            <p className="font-display text-[24px] font-medium leading-[1.2] text-ink">We can’t load the 3D preview right now.</p>
            <p className="text-[15px] font-light text-muted">The model didn’t download. It’s usually temporary.</p>
            <Button
              variant="coral"
              pill
              className="mt-1 px-[22px] py-[10px] text-[15px] font-semibold"
              onClick={() => {
                setStatus("loading");
                setAttempt((count) => count + 1);
              }}
            >
              Try again
            </Button>
          </div>
        ) : null}
      </div>
    </EnclosureFrame>
  );
}
