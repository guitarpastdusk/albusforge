"use server";

import {
  ActionProposal,
  ConfirmActionRequest,
  DeviceAction,
  Id,
  ProposeActionRequest,
  routes,
  SetActionEnabledRequest,
} from "@albusforge/schema";
import { headers } from "next/headers";
import { actionFailure } from "@/lib/action-errors";
import { ApiRequestError, isNotImplemented } from "@/lib/api/core";
import { apiPatch, apiPost } from "@/lib/api/server";
import { log, traceFromHeaders } from "@/lib/log";

/**
 * A rule write's result. `refused` means gateway answered and said no (not
 * built, wrong role, a stale or unresolved proposal): nothing changed.
 * `unknown` means we can't say — the call failed, or gateway's answer didn't
 * parse — and the write may have been committed; the caller must reconcile
 * from the server rather than assume either way.
 */
export type WriteResult<T> = { ok: true; data: T } | { ok: false; message: string; outcome: "refused" | "unknown" };

const NOT_CONNECTED = "Changing rules from the portal isn’t connected for this device yet.";
const NOT_ALLOWED = "Your role on this tenant can view rules but not change them.";
const UNKNOWN = "We couldn’t confirm whether the change went through. Refreshing from the device service.";
const CONFIRM_UNKNOWN = "We couldn’t confirm whether the rule was saved. Confirming the same proposal again is safe.";

/** The message for a refused write: says why, never claims the change happened. */
function refusal(error: unknown): string | null {
  if (isNotImplemented(error)) return NOT_CONNECTED;
  if (error instanceof ApiRequestError && error.status === 403) return NOT_ALLOWED;
  if (error instanceof ApiRequestError && error.status === 409) return error.message;
  return null;
}

/**
 * A write gateway refused (not built yet, wrong role, a stale proposal) is
 * expected and is logged once at WARNING, traced; anything else is the one
 * ERROR entry actionFailure writes.
 */
async function failed(action: string, error: unknown, unknownMessage = UNKNOWN): Promise<WriteResult<never>> {
  const why = refusal(error);
  if (!why) return { ...(await actionFailure(action, error, unknownMessage)), outcome: "unknown" };
  log("WARNING", `action ${action} refused: ${error instanceof Error ? error.message : String(error)}`, {
    trace: traceFromHeaders(await headers()),
    fields: { action, status: error instanceof ApiRequestError ? error.status : null },
  });
  return { ok: false, message: why, outcome: "refused" };
}

const invalid = (message: string): WriteResult<never> => ({ ok: false, message, outcome: "refused" });

/**
 * PATCH /v1/devices/:id/actions/:actionId — enable or disable a rule. Gateway
 * checks the session's role, writes the audit entry and queues the change for
 * the device's next check-in (PORTAL.md §3). Arguments are validated at runtime.
 */
export async function setActionEnabled(deviceId: unknown, actionId: unknown, enabled: unknown): Promise<WriteResult<DeviceAction>> {
  try {
    const device = Id.safeParse(deviceId);
    const action = Id.safeParse(actionId);
    const body = SetActionEnabledRequest.safeParse({ enabled });
    if (!device.success || !action.success || !body.success) return invalid("That rule can’t be changed.");

    const data = await apiPatch(routes.devices.actions.setEnabled.path(device.data, action.data), DeviceAction, body.data);
    return { ok: true, data };
  } catch (error) {
    return failed("setActionEnabled", error);
  }
}

/** POST /v1/devices/:id/actions/proposals — read a plain-words rule back as a proposal. Writes nothing. */
export async function proposeAction(deviceId: unknown, text: unknown): Promise<WriteResult<ActionProposal>> {
  try {
    const device = Id.safeParse(deviceId);
    const body = ProposeActionRequest.safeParse({ text });
    if (!device.success || !body.success) return invalid("Describe the rule in a sentence.");

    const data = await apiPost(routes.devices.actions.propose.path(device.data), ActionProposal, body.data);
    return { ok: true, data };
  } catch (error) {
    return failed("proposeAction", error);
  }
}

/**
 * POST /v1/devices/:id/actions — confirm a proposal; the only way a rule is
 * created (ADR 0010). Idempotent on the proposal id: a retry after a lost
 * response returns the rule that was already created, never a second one.
 */
export async function confirmAction(deviceId: unknown, proposalId: unknown): Promise<WriteResult<DeviceAction>> {
  try {
    const device = Id.safeParse(deviceId);
    const body = ConfirmActionRequest.safeParse({ proposal_id: proposalId });
    if (!device.success || !body.success) return invalid("That proposal has gone. Propose the rule again.");

    const data = await apiPost(routes.devices.actions.create.path(device.data), DeviceAction, body.data);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return { ok: false, message: "That proposal expired. Propose the rule again.", outcome: "refused" };
    }
    return failed("confirmAction", error, CONFIRM_UNKNOWN);
  }
}
