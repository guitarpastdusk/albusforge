import { cx } from "@/lib/cx";

/** The design's switch: 44 × 26 track, green when on, knob sliding 3 px ↔ 21 px. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  describedBy,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      onClick={onChange}
      className={cx(
        "relative h-[26px] w-11 flex-none rounded-full transition-colors duration-200",
        checked ? "bg-success" : "bg-hairline",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "absolute top-[3px] size-5 rounded-full bg-white shadow-[0_1px_3px_rgb(46_42_51/0.3)] transition-[left] duration-200",
          checked ? "left-[21px]" : "left-[3px]",
        )}
      />
    </button>
  );
}
