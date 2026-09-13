import type { ComponentProps } from "react";
import { cx } from "@/lib/cx";

export function Card({ interactive = false, className, ...props }: ComponentProps<"div"> & { interactive?: boolean }) {
  return (
    <div
      className={cx(
        "rounded-[24px] border border-hairline bg-white",
        interactive && "transition-shadow duration-200 hover:shadow-card",
        className,
      )}
      {...props}
    />
  );
}
