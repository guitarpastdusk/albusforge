"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { EnclosurePreview } from "./EnclosurePreview";
import type { EnclosurePreviewData } from "./fixture";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog: focus moves in (to Close), Tab and Shift+Tab stay inside,
 * Escape or a click on the backdrop closes it, and `onClose` returns focus.
 */
export function EnclosureDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = focusables[0];
      const last = focusables.at(-1);
      if (!first || !last) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const active = document.activeElement;
      const inside = active instanceof Node && panel.contains(active);
      if (event.shiftKey && (active === first || active === panel || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
    };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-ink/40 px-3 py-6 sm:items-center sm:px-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-[760px] rounded-[28px] bg-porcelain p-3 shadow-[0_24px_60px_-30px_rgb(46_42_51/0.35)] outline-none sm:p-4"
      >
        <div className="flex items-center justify-between gap-4 px-2 pt-1 pb-3 sm:px-3">
          <h2 id={titleId} className="font-display text-[22px] font-medium leading-[1.2]">
            {title}
          </h2>
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            aria-label="Close 3D preview"
            className="shrink-0 rounded-full border border-hairline bg-white px-4 py-1.5 text-[14px] text-muted hover:text-ink"
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The device-ready card's secondary action. With a preview (mock mode) it
 * opens the viewer in a dialog; without one (live mode, before bodies exist)
 * it says the preview isn't there yet, and nothing is requested.
 */
export function EnclosureDialogButton({ preview, title }: { preview: EnclosurePreviewData | null; title: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!preview) {
    return <p className="font-mono text-[13px] text-faint">3D preview available once the enclosure is generated</p>;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="text-[15px] font-semibold text-coral-deep hover:text-coral"
      >
        View enclosure in 3D →
      </button>
      {open ? (
        <EnclosureDialog
          title={`${title} · enclosure`}
          onClose={() => {
            setOpen(false);
            triggerRef.current?.focus();
          }}
        >
          <EnclosurePreview preview={preview} />
        </EnclosureDialog>
      ) : null}
    </>
  );
}
