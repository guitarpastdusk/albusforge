const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Decimal units, one decimal place: 48_300_000 → "48.3 MB". */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const rounded = unit === 0 ? String(value) : value.toFixed(1).replace(/\.0$/, "");
  return `${rounded} ${UNITS[unit]}`;
}
