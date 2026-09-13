const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

/** 2400 → "2.4k", as in "2.4k readings/day". */
export function formatCompact(value: number): string {
  return compact.format(value).toLowerCase();
}
