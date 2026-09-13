/*
 * Sending the sign-in code (ADR 0008). `resendEmailSender` posts to Resend's
 * API from the address Terraform's DNS verifies (auth.albusforge.ai);
 * `logEmailSender` writes the code to the log instead, for local runs and
 * tests, and must never be the production adapter.
 */
import type { Log } from "./log";

export interface SignInCodeEmail {
  to: string;
  code: string;
  /** Minutes until the code expires, for the message text. */
  validForMinutes: number;
}

export interface EmailSender {
  /** Resolves when the provider has accepted the message; rejects otherwise. */
  sendSignInCode(email: SignInCodeEmail): Promise<void>;
}

export class EmailError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EmailError";
  }
}

export const RESEND_ENDPOINT = "https://api.resend.com/emails";

/** How long one send may take; the code request as a whole should answer well inside web's timeout. */
export const SEND_TIMEOUT_MS = 10_000;

export function signInCodeMessage({ code, validForMinutes }: Pick<SignInCodeEmail, "code" | "validForMinutes">): { subject: string; text: string } {
  return {
    subject: `${code} is your Albusforge sign-in code`,
    text: [
      `Your Albusforge sign-in code is ${code}.`,
      "",
      `It expires in ${validForMinutes} minutes and works once. If you didn't ask for it, you can ignore this email.`,
      "",
      "Albusforge",
    ].join("\n"),
  };
}

export interface ResendOptions {
  apiKey: string;
  /** RFC 5322 mailbox, such as `Albusforge <sign-in@auth.albusforge.ai>`. */
  from: string;
  fetch?: typeof fetch;
  endpoint?: string;
  timeoutMs?: number;
}

export function resendEmailSender({ apiKey, from, fetch: fetchImpl = fetch, endpoint = RESEND_ENDPOINT, timeoutMs = SEND_TIMEOUT_MS }: ResendOptions): EmailSender {
  return {
    async sendSignInCode({ to, code, validForMinutes }) {
      const { subject, text } = signInCodeMessage({ code, validForMinutes });
      let response: Response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ from, to: [to], subject, text }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        throw new EmailError("email provider unreachable", undefined, { cause: error });
      }
      // The body is discarded: Resend's error messages can echo the recipient.
      if (!response.ok) throw new EmailError(`email provider answered ${response.status}`, response.status);
    },
  };
}

/** Logs the code at INFO. Local development and tests only. */
export function logEmailSender(log: Log): EmailSender {
  return {
    async sendSignInCode({ to, code }) {
      log("INFO", "sign-in code (log email adapter)", { fields: { to, code } });
    },
  };
}
