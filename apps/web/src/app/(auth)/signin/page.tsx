import type { Metadata } from "next";
import { EmailCodeCard } from "@/components/auth/EmailCodeCard";
import { safeNextPath } from "@/lib/next-path";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { next } = await searchParams;
  // Only a same-origin relative path survives; anything else is dropped here.
  const safeNext = safeNextPath(Array.isArray(next) ? next[0] : next);
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <EmailCodeCard intent="signin" next={safeNext} />
    </main>
  );
}
