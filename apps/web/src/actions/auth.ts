"use server";

import { routes, SESSION_COOKIE, VerifyCodeResponse } from "@albusforge/schema";
import { z } from "zod";
import { actionFailure, actionIncomplete } from "@/lib/action-errors";
import type { ActionResult } from "@/lib/action-result";
import { ApiRequestError } from "@/lib/api/core";
import { sessionClient } from "@/lib/api/server";

/*
 * Email-code sign-in (ADR 0008). Arguments are untrusted: validated at
 * runtime (trimming inside the string schema), inside `try`.
 *
 * Verify's response sets __Host-albus_session and clears __Host-albus_anon;
 * `sessionClient()` relays both to the browser. Success is reported only once
 * the session cookie has actually been set. No credential ever appears in a
 * return value or a log line.
 */

const EmailInput = z.string().trim().pipe(z.email());
const CodeInput = z.string().trim().regex(/^\d{6}$/);

const INVALID_EMAIL = "Enter a valid email address.";
const INVALID_CODE = "Enter the 6-digit code from your email.";
const SIGN_IN_INCOMPLETE = "We couldn’t finish signing you in. Try again in a moment.";

/** POST /v1/auth/code → 204. */
export async function requestSignInCode(email: unknown): Promise<ActionResult<{ email: string }>> {
  try {
    const parsed = EmailInput.safeParse(email);
    if (!parsed.success) return { ok: false, message: INVALID_EMAIL };

    const client = await sessionClient();
    await client.mutate("POST", routes.auth.requestCode.path(), z.unknown(), { email: parsed.data });
    return { ok: true, data: { email: parsed.data } };
  } catch (error) {
    return actionFailure("requestSignInCode", error);
  }
}

/** POST /v1/auth/verify → the session; claims anonymous builds (PORTAL.md §5). */
export async function verifySignInCode(email: unknown, code: unknown): Promise<ActionResult<{ email: string }>> {
  try {
    const parsedEmail = EmailInput.safeParse(email);
    if (!parsedEmail.success) return { ok: false, message: INVALID_EMAIL };
    const parsedCode = CodeInput.safeParse(code);
    if (!parsedCode.success) return { ok: false, message: INVALID_CODE };

    const client = await sessionClient();
    const session = await client.mutate("POST", routes.auth.verify.path(), VerifyCodeResponse, {
      email: parsedEmail.data,
      code: parsedCode.data,
    });
    if (client.credentialChange(SESSION_COOKIE) !== "set") {
      return actionIncomplete("verifySignInCode", "verify succeeded without setting a session cookie", SIGN_IN_INCOMPLETE);
    }
    return { ok: true, data: { email: session.user.email } };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) {
      return { ok: false, message: "That code didn’t work. Check it, or send a new one." };
    }
    return actionFailure("verifySignInCode", error);
  }
}
