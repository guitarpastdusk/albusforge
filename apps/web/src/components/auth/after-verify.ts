import { DEFAULT_AFTER_SIGN_IN, safeNextPath } from "@/lib/next-path";

export type AfterVerify = { kind: "navigate"; to: string } | { kind: "done" };

/**
 * After a verified code. With a `next` from the guard, both flows return
 * there. Otherwise sign-in goes to projects, and sign-up shows its done step
 * ("Go to my projects →"). `next` is re-checked here even though the page
 * already validated it.
 */
export function afterVerify(intent: "signin" | "signup", next: string | null): AfterVerify {
  const safe = safeNextPath(next);
  if (safe) return { kind: "navigate", to: safe };
  return intent === "signin" ? { kind: "navigate", to: DEFAULT_AFTER_SIGN_IN } : { kind: "done" };
}
