"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

const SWITCH_KEY = "albus-workspace-transition";
interface Transition { begin: () => void; finish: () => void; fail: (message: string) => void; blocked: boolean; message: string }
const Context = createContext<Transition | null>(null);
export const useWorkspaceTransition = () => useContext(Context);
const reload = () => window.location.replace("/projects");
function signal(phase: "begin" | "finish") {
  const value = JSON.stringify({ phase, nonce: crypto.randomUUID() });
  try { localStorage.setItem(SWITCH_KEY, value); } catch { /* BroadcastChannel covers storage-disabled contexts when available. */ }
  try { const channel = new BroadcastChannel(SWITCH_KEY);channel.postMessage(value);channel.close(); } catch { /* The storage event covers browsers without BroadcastChannel. */ }
  return value;
}

/** A switch removes tenant components before mutation and never restores stale data. */
export function WorkspaceBoundary({ children }: { children: ReactNode }) {
  const ownSignals = useRef(new Set<string>());
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState("Switching workspace…");
  useEffect(() => {
    let revision: string | null = null;
    try { revision = localStorage.getItem(SWITCH_KEY); } catch { /* Optional cross-tab persistence. */ }
    const changed = (value: string | null) => {
      if (value === revision) return;
      revision = value;
      if (value !== null && ownSignals.current.has(value)) return;
      setBlocked(true);
      setMessage("Your workspace changed in another tab. Reload to continue.");
      try { if (JSON.parse(value ?? "{}").phase === "finish") reload(); } catch { /* Reconcile without trusting signal contents. */ }
    };
    const storage = (event: StorageEvent) => { if (event.key === SWITCH_KEY) changed(event.newValue); };
    const focus = () => { try { const current = localStorage.getItem(SWITCH_KEY);if (current !== revision) changed(current); } catch { /* Optional storage. */ } };
    const pageshow = (event: PageTransitionEvent) => { if (event.persisted) reload();else focus(); };
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel(SWITCH_KEY);channel.onmessage = (event: MessageEvent<unknown>) => { if (typeof event.data === "string") changed(event.data); }; } catch { /* storage event remains available. */ }
    window.addEventListener("storage", storage);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("focus", focus);
    return () => { window.removeEventListener("storage", storage);window.removeEventListener("pageshow", pageshow);window.removeEventListener("focus", focus);channel?.close(); };
  }, []);
  return <Context.Provider value={{ blocked, message,
    begin: () => { setBlocked(true);setMessage("Switching workspace…");ownSignals.current.add(signal("begin")); },
    finish: () => { ownSignals.current.add(signal("finish"));reload(); },
    fail: (reason) => { setMessage(reason);ownSignals.current.add(signal("finish")); },
  }}>{children}</Context.Provider>;
}

export function WorkspaceContent({ children }: { children: ReactNode }) {
  const state = useWorkspaceTransition();
  if (!state?.blocked) return children;
  return <main className="mx-auto w-full max-w-[800px] px-6 py-16">
    <h1 className="font-display text-[32px]">Workspace transition</h1>
    <p role="status" className="mt-4 text-muted">{state.message}</p>
    <button type="button" onClick={reload} className="mt-6 rounded-full bg-ink px-5 py-3 text-white">Reload workspace</button>
  </main>;
}
