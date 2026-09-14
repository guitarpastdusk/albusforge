import type { FastifyRequest } from "fastify";
import { HttpError } from "./http";

/** Browser credential mutations require an explicit same-host Origin. Never trust forwarded host. */
export function assertSameOrigin(request: Pick<FastifyRequest, "headers">): void {
  const origin = request.headers.origin, host = request.headers.host;
  try {
    if (typeof origin !== "string" || typeof host !== "string") throw new Error();
    const url = new URL(origin);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.origin !== origin || (url.protocol !== "https:" && !(local && url.protocol === "http:"))
      || url.host !== new URL(`${url.protocol}//${host}`).host) throw new Error();
  } catch { throw new HttpError(403, "INVALID_ORIGIN", "A same-origin request is required"); }
}
