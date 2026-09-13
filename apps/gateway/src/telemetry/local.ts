import { z } from "zod";

/** Development tooling never sends a device credential to a remote endpoint. */
export function localEndpoint(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Simulator requires a loopback HTTP origin without credentials, path or query");
  }
  return url;
}
export const LocalCredential = z.strictObject({
  dev: z.uuid(), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export function localDatabase(host: string): void {
  if (!["127.0.0.1", "localhost", "::1"].includes(host) || process.env.K_SERVICE) {
    throw new Error("Development provisioning requires a loopback database outside Cloud Run");
  }
}
export const simulatorChannels = {
  temperature_c: { unit: "°C", min: -40, max: 85 },
  humidity_pct: { unit: "%", min: 0, max: 100 },
};
