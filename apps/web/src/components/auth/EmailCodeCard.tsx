"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { requestSignInCode, verifySignInCode } from "@/actions/auth";
import { Button, ButtonLink, Kicker } from "@/components/ui";
import { cx } from "@/lib/cx";
import { authHref, DEFAULT_AFTER_SIGN_IN } from "@/lib/next-path";
import { settle } from "@/lib/safe-action";
import { afterVerify } from "./after-verify";

export type EmailCodeIntent = "signup" | "signin";
type Step = "email" | "code" | "done";

const COPY = {
  signup: {
    kicker: "Create account",
    title: "Save your build. Own your data.",
    verify: "Verify & create account",
    doneTitle: "You’re verified.",
    doneBody: "Your account is ready. Continue to your projects.",
  },
  signin: {
    kicker: "Sign in",
    title: "Welcome back.",
    verify: "Verify & sign in",
    doneTitle: "You’re signed in.",
    doneBody: "Pick up where you left off.",
  },
} as const;

const CODE_LENGTH = 6;
const LOCAL_RESEND_WAIT_MS = 30_000;

/**
 * Email → 6-digit code → done (ADR 0008). Sign-up and sign-in are the same
 * flow with different copy. In mock mode any 6 digits verify.
 */
export function EmailCodeCard({ intent, next = null }: { intent: EmailCodeIntent; next?: string | null }) {
  const copy = COPY[intent];
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const sending = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const [localResendUntil, setLocalResendUntil] = useState(0);
  const [sendLimitUntil, setSendLimitUntil] = useState(0);
  const [verifyLimitUntil, setVerifyLimitUntil] = useState(0);
  const emailInput = useRef<HTMLInputElement>(null);
  const sendUntil = Math.max(sendLimitUntil, step === "code" ? localResendUntil : 0);
  const sendWait = Math.max(0, Math.ceil((sendUntil - clock) / 1000));
  const verifyWait = Math.max(0, Math.ceil((verifyLimitUntil - clock) / 1000));
  const counting = sendWait > 0 || verifyWait > 0;
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setClock(Date.now()), 250);
    return () => clearInterval(timer);
  }, [counting]);
  useEffect(() => { if (step === "email") emailInput.current?.focus(); }, [step]);

  const limit = (result: { ok: false; message: string; retryAfterSeconds?: unknown }, kind: "send" | "verify") => {
    setError(result.message);
    const seconds = result.retryAfterSeconds;
    if (typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 31_536_000) {
      const now = Date.now();
      setClock(now);
      (kind === "send" ? setSendLimitUntil : setVerifyLimitUntil)(now + seconds * 1000);
    }
  };

  const sendCode = () => {
    if (sending.current || Date.now() < sendUntil) return;
    sending.current = true;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await settle(() => requestSignInCode(email));
        if (!result.ok) return limit(result, "send");
        const now = Date.now();
        setClock(now);
        setLocalResendUntil(now + LOCAL_RESEND_WAIT_MS);
        setEmail(result.data.email);
        setCode("");
        setNotice("Code sent. Use the most recent email; requesting another code replaces earlier codes.");
        setStep("code");
      } finally { sending.current = false; }
    });
  };

  const verify = () => {
    if (sending.current || Date.now() < verifyLimitUntil || code.length !== CODE_LENGTH) return;
    sending.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await settle(() => verifySignInCode(email, code));
        if (!result.ok) return limit(result, "verify");
        const outcome = afterVerify(intent, next);
        if (outcome.kind === "navigate") router.push(outcome.to);
        else setStep("done");
      } finally { sending.current = false; }
    });
  };

  const useExistingCode = () => {
    if (sending.current || !emailInput.current?.reportValidity()) return;
    setEmail(email.trim());
    setCode("");
    setError(null);
    setNotice("Use the most recent code already sent to this address. This does not request another email.");
    setStep("code");
  };

  const changeEmail = () => {
    if (sending.current) return;
    setCode("");
    setError(null);
    setNotice(null);
    setLocalResendUntil(0);
    setStep("email"); // Keep `next` and real backend limits; they may be per IP.
  };

  return (
    <div className="w-full max-w-[550px] rounded-[28px] border border-hairline bg-white px-6 pt-8 pb-8 sm:px-11 sm:pt-11 sm:pb-10 shadow-[0_24px_60px_-30px_rgb(46_42_51/0.2)]">
      {step === "email" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            sendCode();
          }}
        >
          <Kicker size={13}>{copy.kicker}</Kicker>
          <h1 className="mt-3.5 font-display text-[34px] font-medium leading-[1.15]">{copy.title}</h1>
          <p className="mt-3.5 text-[16px] font-light leading-[1.5] text-muted">
            We only need an email — we’ll send a 6-digit code to verify it. No password to remember.
          </p>
          <label htmlFor="email" className="mt-7 mb-2 block text-[14px] font-medium text-muted">
            Email
          </label>
          <input
            ref={emailInput}
            id="email"
            disabled={pending}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="block w-full rounded-[14px] border border-hairline bg-porcelain px-[18px] py-[15px] text-[17px] text-ink outline-none focus:border-coral"
          />
          <ErrorLine message={error} />
          <Button
            type="submit"
            variant="dark"
            disabled={pending || sendWait > 0}
            className="mt-[18px] w-full rounded-[14px] py-4 text-[17px] font-semibold"
          >
            {pending ? "Sending code…" : sendWait > 0 ? `Try again in ${sendWait}s` : "Email me a code"}
          </Button>
          <button type="button" onClick={useExistingCode} disabled={pending} className="mx-auto mt-4 block text-[14px] font-medium text-coral-deep underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">I already have a code</button>
          <p className="mt-[18px] text-center text-[14px] font-light text-faint">
            {intent === "signup" ? (
              <>
                <Link href="/security">Security and data handling</Link>. Already verified?{" "}
                <Link href={authHref("/signin", next)}>Sign in</Link>
              </>
            ) : (
              <>
                New here? <Link href={authHref("/signup", next)}>Create an account</Link>
              </>
            )}
          </p>
        </form>
      ) : null}

      {step === "code" ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            verify();
          }}
        >
          <Kicker tone="success" size={13}>
            Check your inbox
          </Kicker>
          <h1 className="mt-3.5 font-display text-[34px] font-medium leading-[1.15]">Enter the 6-digit code</h1>
          <p className="mt-3.5 text-[16px] font-light leading-[1.5] text-muted">
            Use the latest code sent to <b className="break-all font-medium text-ink">{email}</b>. Codes are valid for 10 minutes.
          </p>
          <p role="status" className="mt-3 text-[14px] leading-relaxed text-muted">{notice}</p>
          <CodeBoxes code={code} onChange={setCode} disabled={pending} />
          <ErrorLine message={error} />
          <Button
            type="submit"
            variant="coral"
            disabled={pending || code.length !== CODE_LENGTH || verifyWait > 0}
            className="mt-6 w-full rounded-[14px] py-4 text-[17px] font-semibold"
          >
            {pending ? "Please wait…" : verifyWait > 0 ? `Verify in ${verifyWait}s` : copy.verify}
          </Button>
          <p className="mt-[18px] text-center text-[14px] font-light text-faint">
            Didn’t get it?{" "}
            <button type="button" onClick={sendCode} disabled={pending || sendWait > 0} className="text-coral-deep hover:text-coral">
              {sendWait > 0 ? `Resend in ${sendWait}s` : "Resend code"}
            </button>
          </p>
          <p className="mt-3 text-center text-[14px] leading-relaxed text-muted">Check your spam folder. If delivery failed, retry requesting a code and use the latest email.</p>
          <button type="button" onClick={changeEmail} disabled={pending} className="mx-auto mt-4 block text-[14px] font-medium text-coral-deep underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Change email</button>
        </form>
      ) : null}

      {step === "done" ? (
        <div>
          <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-pastel-green text-[30px] text-success">
            ✓
          </div>
          <h1 className="mt-[22px] text-center font-display text-[34px] font-medium leading-[1.15]">{copy.doneTitle}</h1>
          <p className="mt-3 text-center text-[16px] font-light leading-[1.5] text-muted">{copy.doneBody}</p>
          <ButtonLink
            href={DEFAULT_AFTER_SIGN_IN}
            variant="dark"
            className="mt-[26px] w-full rounded-[14px] py-4 text-[17px] font-semibold"
          >
            Go to my projects →
          </ButtonLink>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Six boxes drawn over one real input, so paste and one-time-code autofill
 * work. The input is transparent, so focus shows on the drawn boxes: the box
 * the next digit goes into gets a coral ring while the input is focused.
 */
export function CodeBoxes({ code, onChange, disabled = false }: { code: string; onChange: (code: string) => void; disabled?: boolean }) {
  const active = Math.min(code.length, CODE_LENGTH - 1);
  return (
    <div className="group relative mt-7 flex justify-between gap-2.5">
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cx(
            "flex aspect-[0.85] flex-1 items-center justify-center rounded-xl border bg-porcelain font-mono text-[26px] text-ink",
            i < code.length ? "border-coral" : "border-hairline",
            i === active && "group-focus-within:border-coral group-focus-within:shadow-[0_0_0_3px_rgb(232_121_74/0.28)]",
          )}
        >
          {code[i] ?? ""}
        </span>
      ))}
      <input
        aria-label="6-digit code"
        disabled={disabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        maxLength={CODE_LENGTH}
        value={code}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
        className="absolute inset-0 size-full cursor-text opacity-0"
      />
    </div>
  );
}

function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="mt-3 text-[14px] text-coral-deep">
      {message}
    </p>
  ) : null;
}
