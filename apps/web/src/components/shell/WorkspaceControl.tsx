"use client";

import type { TenantMembership } from "@albusforge/schema";
import { useId, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { switchWorkspace } from "@/actions/workspace";
import { settle } from "@/lib/safe-action";
import { useWorkspaceTransition } from "./WorkspaceBoundary";

export function WorkspaceControl({ workspace, memberships, hostScoped = false }: { workspace: TenantMembership; memberships: TenantMembership[]; hostScoped?: boolean }) {
  const id = useId();
  const transition = useWorkspaceTransition();
  const [selected, setSelected] = useState(workspace.id);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  return <div className="min-w-0 max-w-[240px] text-[13px]">
    <p className="truncate font-medium" title={workspace.name}>{workspace.name}</p>
    <p className="text-muted">{workspace.role}</p>
    {memberships.length > 1 && !hostScoped && transition ? <form className="mt-2 flex gap-2" onSubmit={(event) => {
      event.preventDefault();
      if (inFlight.current || selected === workspace.id || transition.blocked) return;
      inFlight.current = true;
      // Commit unmount/effect cleanup before issuing the mutation: old streams
      // and tenant forms must not consume the changed session's next response.
      flushSync(() => transition.begin());
      startTransition(async () => {
        const result = await settle(() => switchWorkspace(selected));
        if (result.ok) transition.finish();
        else transition.fail(result.message);
      });
    }}>
      <label className="sr-only" htmlFor={id}>Workspace</label>
      <select id={id} value={selected} onChange={(event) => setSelected(event.target.value)} disabled={pending || transition.blocked} className="min-w-0 flex-1 rounded-lg border border-hairline bg-white px-2 py-2">
        {memberships.map((member) => <option key={member.id} value={member.id}>{member.name} ({member.role})</option>)}
      </select>
      <button type="submit" disabled={pending || transition.blocked || selected === workspace.id} className="rounded-lg border border-hairline bg-white px-2 py-2 disabled:opacity-50">Switch</button>
    </form> : null}
    {hostScoped && memberships.length > 1 ? <p className="mt-2 text-muted">This host stays in this workspace.</p> : null}
  </div>;
}
