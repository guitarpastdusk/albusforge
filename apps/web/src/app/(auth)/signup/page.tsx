import type { Metadata } from "next";
import { Kicker } from "@/components/ui";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-[460px] rounded-[28px] border border-hairline bg-white px-11 pt-11 pb-10 shadow-[0_24px_60px_-30px_rgb(46_42_51/0.2)]">
        <Kicker className="text-[13px]">Create account</Kicker>
        <h1 className="mt-3.5 font-display text-[34px] font-medium leading-[1.15]">Save your build. Own your data.</h1>
        <p className="mt-3.5 text-[16px] font-light leading-[1.5] text-muted">
          We only need an email — we’ll send a 6-digit code to verify it. No password to remember.
        </p>
        {/* TODO(auth): email → POST /v1/auth/code → code → POST /v1/auth/verify → done. Verify claims anonymous builds via __Host-albus_anon (ADR 0008). */}
        <p className="mt-7 rounded-2xl bg-porcelain px-5 py-4 text-[14px] text-muted">
          Stub — the email → code → done flow lands with auth.
        </p>
      </div>
    </main>
  );
}
