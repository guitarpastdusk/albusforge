import { cx } from "@/lib/cx";

const SIZES = { 8: "size-2", 9: "size-[9px]", 10: "size-2.5" } as const;

export function PulseDot({ size = 8, className }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden
      className={cx(
        "inline-block shrink-0 rounded-full bg-success animate-af-pulse motion-reduce:animate-none",
        SIZES[size],
        className,
      )}
    />
  );
}
