const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * "today 06:12", "yesterday 06:12", or "12 Sep 06:12" — in the server's time
 * zone, which renders it.
 *
 * TODO: format in the tenant's or site's time zone once the API carries one.
 */
export function formatWhen(when: Date | string, now: Date = new Date()): string {
  const at = new Date(when);
  const days = Math.round((startOfDay(now) - startOfDay(at)) / 86_400_000);
  const hhmm = time.format(at);
  if (days === 0) return `today ${hhmm}`;
  if (days === 1) return `yesterday ${hhmm}`;
  return `${date.format(at)} ${hhmm}`;
}
