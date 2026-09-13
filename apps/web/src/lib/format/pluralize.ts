/** `pluralize(1, "device")` → "1 device"; `pluralize(4, "device")` → "4 devices". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
