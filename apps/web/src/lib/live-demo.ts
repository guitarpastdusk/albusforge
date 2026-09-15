/**
 * Where the landing page's "Live demo" pill points.
 *
 * Configuration, not code, because the destination is a device that happens to
 * be running rather than anything this repository knows about. Unset means the
 * pill does not render, which is the correct default: every device page in this
 * app requires a session, so an unconfigured or careless value would send a
 * visitor to a sign-in wall.
 *
 * Read at request time (not inlined at build), so one image can carry it across
 * environments and it can be changed without a rebuild.
 */
export function liveDemoUrl(): string | null {
  const raw = process.env.LIVE_DEMO_URL?.trim();
  if (!raw) return null;
  // A path stays internal, but "//host" is protocol-relative and leaves the site,
  // so it is not a path. Anything else must be an absolute http(s) URL.
  if (raw.startsWith("//")) return null;
  if (raw.startsWith("/")) return raw;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
