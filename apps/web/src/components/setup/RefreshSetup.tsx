"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/** A visible setup screen checks at most 60 times, with no overlapping refreshes. */
export function RefreshSetup({ waiting }: { waiting: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [automatic, setAutomatic] = useState(true);
  const checks = useRef(0);
  useEffect(() => {
    if (!waiting || pending || !automatic) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      if (checks.current >= 60) { setAutomatic(false); return; }
      checks.current += 1;
      startTransition(() => router.refresh());
    }, 5000);
    return () => clearInterval(timer);
  }, [automatic, pending, router, waiting]);
  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <button type="button" disabled={pending} className="rounded-xl bg-coral px-5 py-3 font-medium text-white disabled:opacity-60" onClick={() => {
        checks.current = 0;
        setAutomatic(true);
        startTransition(() => router.refresh());
      }}>{pending ? "Checking…" : "Check again"}</button>
      {waiting ? <p role="status" className="text-sm text-muted">{automatic ? "Checks every 5 seconds while this page is visible." : "Automatic checks paused. Check again when your device is ready."}</p> : null}
    </div>
  );
}
