"use server";

import { routes, SetActiveTenantRequest } from "@albusforge/schema";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { ApiRequestError } from "@/lib/api/core";
import { apiMutationAction } from "@/lib/api/server";
import type { ActionResult } from "@/lib/action-result";

export async function switchWorkspace(tenantId: unknown): Promise<ActionResult<null>> {
  const parsed = SetActiveTenantRequest.safeParse({ tenant_id: tenantId });
  if (!parsed.success) return { ok: false, message: "Choose an available workspace." };
  const hostname = ((await headers()).get("host") ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  if (hostname.endsWith(".albusforge.ai") && hostname !== "staging.albusforge.ai") {
    return { ok: false, message: "Workspace switching is available on the main site. This host stays scoped to its workspace." };
  }
  try {
    await apiMutationAction("PUT", routes.me.setActiveTenant.path(), z.unknown(), parsed.data);
    return { ok: true, data: null };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ApiRequestError && error.status === 401) return { ok: false, message: "Your session changed or expired. Reload to sign in again." };
    if (error instanceof ApiRequestError && error.status === 403) return { ok: false, message: "Workspace access changed. Reload to see your available workspaces." };
    return { ok: false, message: "We couldn’t confirm the workspace switch. Reload to check your current workspace." };
  }
}
