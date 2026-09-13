import type { Accent } from "@albusforge/schema";
import type { ReactNode } from "react";
import { accentClasses } from "@/lib/accent";
import { cx } from "@/lib/cx";

export function Pill({ accent, className, children }: { accent: Accent; className?: string; children: ReactNode }) {
  const { bg, fg } = accentClasses[accent];
  return <span className={cx("inline-flex items-center rounded-full", bg, fg, className)}>{children}</span>;
}
