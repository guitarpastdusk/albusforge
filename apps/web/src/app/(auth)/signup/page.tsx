import type { Metadata } from "next";
import { EmailCodeCard } from "@/components/auth/EmailCodeCard";

export const metadata: Metadata = { title: "Create account" };

export default function SignUpPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16">
      <EmailCodeCard intent="signup" />
    </main>
  );
}
