"use client";

import { useEffect, useState } from "react";
import { reconcileWorkspace } from "@/actions/workspace";
import { settle } from "@/lib/safe-action";
import { useWorkspaceTransition } from "./WorkspaceBoundary";

/** Reconcile the streamed header without delaying public server content. */
export function WorkspaceIdentity({ snapshot }: { snapshot: { userId: string; tenantId: string } | null }) {
  const [error, setError] = useState<string | null>(null);
  const setExpectedTenant = useWorkspaceTransition()?.setExpectedTenant;
  const userId = snapshot?.userId ?? null;
  const tenantId = snapshot?.tenantId ?? null;
  useEffect(() => {
    if (!setExpectedTenant) return;
    let alive = true;
    let generation = 0;
    const check = async () => {
      const current = ++generation;
      setExpectedTenant(undefined);
      setError(null);
      const result = await settle(() => reconcileWorkspace(userId && tenantId ? { userId, tenantId } : null));
      if (!alive || current !== generation) return;
      if (result.ok && result.data) setExpectedTenant(tenantId);
      else if (result.ok) window.location.replace(window.location.pathname);
      else setError(result.message);
      // Uncertain reads keep mutation admission disabled. Focus/reload retries.
    };
    const focus = () => { void check(); };
    window.addEventListener("focus", focus);
    void check();
    return () => { alive = false; window.removeEventListener("focus", focus); };
  }, [userId, tenantId, setExpectedTenant]);
  return error ? <div role="alert" className="px-6 py-3 text-muted">{error} <button type="button" className="underline" onClick={() => window.location.reload()}>Reload workspace</button></div> : null;
}
