import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

const TONES = {
  coral: "text-coral-deep",
  success: "text-success",
  muted: "text-muted",
} as const;

export type KickerTone = keyof typeof TONES;

const SIZES = { 13: "text-[13px]", 14: "text-[14px]" } as const;
const TRACKING = { 0.16: "tracking-[0.16em]", 0.2: "tracking-[0.2em]" } as const;

/** Size and tracking are props, not override classes: two text sizes in one class list don't reliably cascade. */
export function Kicker({
  tone = "coral",
  size = 14,
  tracking = 0.2,
  className,
  children,
}: {
  tone?: KickerTone;
  size?: keyof typeof SIZES;
  tracking?: keyof typeof TRACKING;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cx("font-mono uppercase", SIZES[size], TRACKING[tracking], TONES[tone], className)}>{children}</div>;
}
