/** Additional guard for server mutation transports; Next also checks Server Action origins. */
export function assertActionOrigin(origin: string | null, host: string | null): void {
  if (!origin || !host) throw new Error("A same-origin Server Action is required");
  const url = new URL(origin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.origin !== origin || (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    || url.host !== new URL(`${url.protocol}//${host}`).host) throw new Error("A same-origin Server Action is required");
}
