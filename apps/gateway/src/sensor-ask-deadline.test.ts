import Fastify from "fastify";
import type { Pool } from "pg";
import { expect, it, vi } from "vitest";
import { httpSensorAskClient, registerSensorAsk } from "./sensor-ask";
import { HttpError } from "./http";
// Authentication itself is covered against PostgreSQL in telemetry-read.db.test.ts.
// Here a validated scope isolates the route's deadline around credential acquisition.
vi.mock("./session", () => ({ withSession: async (_pool: unknown, _cookie: unknown, _host: unknown, read: (client: unknown, tenant: string, actor: string) => Promise<unknown>) => read({ query: async () => ({ rowCount: 1 }) }, "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb") }));
it("bounds hung credential acquisition before fetch is called", async () => {
  const app = Fastify();
  app.setErrorHandler((error, _req, reply) => reply.code(error instanceof HttpError ? error.statusCode : 500).send({ error: error instanceof Error ? error.message : "Unknown failure" }));
  const transport = vi.fn<typeof fetch>();
  registerSensorAsk(app, {} as Pool, httpSensorAskClient("https://ask.internal", () => new Promise(() => {}), transport), 15);
  try {
    const response = await app.inject({ method: "POST", url: "/v1/devices/cccccccc-cccc-4ccc-accc-cccccccccccc/ask", payload: { text: "Mean?", channel: "temperature_c", from: "2026-09-13T10:00:00Z", to: "2026-09-13T11:00:00Z" } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "Sensor chat is unavailable; try again shortly" });
    expect(transport).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
