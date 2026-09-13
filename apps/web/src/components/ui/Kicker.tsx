import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

const TONES = {
  coral: "text-coral-deep",
  success: "text-success",
  muted: "text-muted",
} as const;

export type KickerTone = keyof typeof TONES;

export function Kicker({
  tone = "coral",
  className,
  children,
}: {
  tone?: KickerTone;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cx("font-mono text-[14px] uppercase tracking-[0.2em]", TONES[tone], className)}>{children}</div>;
}
