"use server";

import { RequestCodeRequest, routes, VerifyCodeRequest, VerifyCodeResponse } from "@albusforge/schema";
import { z } from "zod";
import { actionFailure } from "@/lib/action-errors";
import type { ActionResult } from "@/lib/action-result";
import { ApiRequestError } from "@/lib/api/core";
import { apiPost } from "@/lib/api/server";

/*
 * Email-code sign-in (ADR 0008).
 *
 * TODO(auth): in live mode gateway answers verify with Set-Cookie for
 * __Host-albus_session (and clears __Host-albus_anon). A Server Function's
 * fetch to gateway doesn't pass that through to the browser: relay those two
 * cookies with cookies().set once gateway exists. Mock mode sets no session.
 */

/** POST /v1/auth/code → 204. */
export async function requestSignInCode(email: string): Promise<ActionResult<{ email: string }>> {
  const parsed = RequestCodeRequest.safeParse({ email: email.trim() });
  if (!parsed.success) return { ok: false, message: "Enter a valid email address." };

  try {
    await apiPost(routes.auth.requestCode.path(), z.unknown(), parsed.data);
    return { ok: true, data: { email: parsed.data.email } };
  } catch (error) {
    return actionFailure("requestSignInCode", error);
  }
}

/** POST /v1/auth/verify → the session; claims anonymous builds (PORTAL.md §5). */
export async function verifySignInCode(email: string, code: string): Promise<ActionResult<{ email: string }>> {
  const parsed = VerifyCodeRequest.safeParse({ email: email.trim(), code });
  if (!parsed.success) return { ok: false, message: "Enter the 6-digit code from your email." };

  try {
    const session = await apiPost(routes.auth.verify.path(), VerifyCodeResponse, parsed.data);
    return { ok: true, data: { email: session.user.email } };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
      return { ok: false, message: "That code didn’t work. Check it, or send a new one." };
    }
    return actionFailure("verifySignInCode", error);
  }
}
