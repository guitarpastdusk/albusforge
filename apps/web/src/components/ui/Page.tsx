import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Kicker, type KickerTone } from "./Kicker";

/** `compact` is the device dashboard's 44 px top instead of 52 px. */
export function PageContainer({
  compact = false,
  className,
  children,
}: {
  compact?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <main className={cx("mx-auto box-border w-full max-w-[1180px] flex-1 px-8 pb-20", compact ? "pt-11" : "pt-[52px]", className)}>
      {children}
    </main>
  );
}

export function PageTitle({
  kicker,
  kickerTone,
  title,
  description,
  actions,
}: {
  kicker: ReactNode;
  kickerTone?: KickerTone;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-6">
      <div>
        <Kicker tone={kickerTone}>{kicker}</Kicker>
        <h1 className="mt-2.5 font-display text-[46px] font-medium tracking-[-0.01em]">{title}</h1>
        {description ? (
          <p className="mt-3 max-w-[560px] text-[18px] font-light leading-[1.5] text-muted">{description}</p>
        ) : null}
      </div>
      {actions}
    </div>
  );
}
