"use client";

import { useEffect, useState, type ReactNode } from "react";
import { reconcileWorkspace } from "@/actions/workspace";
import { settle } from "@/lib/safe-action";

/** A streamed document may predate a switch that completed before hydration. */
export function WorkspaceAdmission({ snapshot, children }: {
  snapshot: { userId: string; tenantId: string };
  children: ReactNode;
}) {
  const [admitted, setAdmitted] = useState(false);
  const [message, setMessage] = useState("Checking current workspace…");
  const { userId, tenantId } = snapshot;
  useEffect(() => {
    let alive = true;
    let generation = 0;
    const check = async () => {
      const current = ++generation;
      setAdmitted(false);
      const result = await settle(() => reconcileWorkspace({ userId, tenantId }));
      if (!alive || current !== generation) return;
      if (!result.ok) setMessage(result.message);
      else if (!result.data) window.location.replace("/projects");
      else setAdmitted(true);
    };
    const focus = () => { void check(); };
    const show = (event: PageTransitionEvent) => { if (event.persisted) void check(); };
    window.addEventListener("focus", focus);
    window.addEventListener("pageshow", show);
    void check();
    return () => {
      alive = false;
      window.removeEventListener("focus", focus);
      window.removeEventListener("pageshow", show);
    };
  }, [userId, tenantId]);
  if (admitted) return children;
  return <main className="mx-auto w-full max-w-[800px] px-6 py-16">
    <h1 className="font-display text-[32px]">Checking workspace</h1>
    <p role="status" className="mt-4 text-muted">{message}</p>
    <button type="button" onClick={() => window.location.replace("/projects")} className="mt-6 rounded-full bg-ink px-5 py-3 text-white">Reload workspace</button>
  </main>;
}
