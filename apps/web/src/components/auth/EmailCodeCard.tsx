"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { requestSignInCode, verifySignInCode } from "@/actions/auth";
import { Button, ButtonLink, Kicker } from "@/components/ui";
import { cx } from "@/lib/cx";

export type EmailCodeIntent = "signup" | "signin";
type Step = "email" | "code" | "done";

const COPY = {
  signup: {
    kicker: "Create account",
    title: "Save your build. Own your data.",
    verify: "Verify & create account",
    doneTitle: "You’re verified.",
    doneBody: "Your greenhouse soil monitor is saved to your projects.",
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

/**
 * Email → 6-digit code → done (ADR 0008). Sign-up and sign-in are the same
 * flow with different copy. In mock mode any 6 digits verify.
 */
export function EmailCodeCard({ intent }: { intent: EmailCodeIntent }) {
  const copy = COPY[intent];
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const sendCode = () =>
    startTransition(async () => {
      const result = await requestSignInCode(email);
      if (!result.ok) return setError(result.message);
      setError(null);
      setEmail(result.data.email);
      setCode("");
      setStep("code");
    });

  const verify = () =>
    startTransition(async () => {
      const result = await verifySignInCode(email, code);
      if (!result.ok) return setError(result.message);
      setError(null);
      setStep("done");
    });

  return (
    <div className="w-full max-w-[550px] rounded-[28px] border border-hairline bg-white px-11 pt-11 pb-10 shadow-[0_24px_60px_-30px_rgb(46_42_51/0.2)]">
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
            id="email"
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
            disabled={pending}
            className="mt-[18px] w-full rounded-[14px] py-4 text-[17px] font-semibold"
          >
            Email me a code
          </Button>
          <p className="mt-[18px] text-center text-[14px] font-light text-faint">
            {intent === "signup" ? (
              <>
                By continuing you agree to the <Link href="/security">terms</Link>. Already verified?{" "}
                <Link href="/signin">Sign in</Link>
              </>
            ) : (
              <>
                New here? <Link href="/signup">Create an account</Link>
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
            Sent to <b className="font-medium text-ink">{email}</b> · valid for 10 minutes.
          </p>
          <CodeBoxes code={code} onChange={setCode} />
          <ErrorLine message={error} />
          <Button
            type="submit"
            variant="coral"
            disabled={pending}
            className="mt-6 w-full rounded-[14px] py-4 text-[17px] font-semibold"
          >
            {copy.verify}
          </Button>
          <p className="mt-[18px] text-center text-[14px] font-light text-faint">
            Didn’t get it?{" "}
            <button type="button" onClick={sendCode} disabled={pending} className="text-coral-deep hover:text-coral">
              Resend code
            </button>
          </p>
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
            href="/projects"
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

/** Six boxes drawn over one real input, so paste and one-time-code autofill work. */
function CodeBoxes({ code, onChange }: { code: string; onChange: (code: string) => void }) {
  return (
    <div className="relative mt-7 flex justify-between gap-2.5">
      {Array.from({ length: CODE_LENGTH }, (_, i) => (
        <span
          key={i}
          aria-hidden
          className={cx(
            "flex aspect-[0.85] flex-1 items-center justify-center rounded-xl border bg-porcelain font-mono text-[26px] text-ink",
            i < code.length ? "border-coral" : "border-hairline",
          )}
        >
          {code[i] ?? ""}
        </span>
      ))}
      <input
        aria-label="6-digit code"
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
