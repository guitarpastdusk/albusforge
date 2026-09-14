/*
 * A stalled database must fail requests with a JSON 503 inside the configured
 * budgets and leave the pool usable. Postgres runs in testcontainers; a TCP
 * proxy in front of it simulates a handshake that never completes and a
 * connection whose responses stop arriving.
 */
import net from "node:net";
import { createDb, type DbConfig } from "@albusforge/db";
import { runMigrations } from "@albusforge/db/migrate";
import { loadParts, readValidatedParts } from "@albusforge/registry/db-load";
import { REGISTRY_ROOT } from "@albusforge/registry/load";
import { PartList } from "@albusforge/schema";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { FastifyInstance } from "fastify";
import pg from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { createLogger } from "./log";
import { createPartsStore } from "./parts";

const MAX = 2;
/*
 * Budgets are generous on purpose. Every test ends by proving the pool is
 * usable again, and that recovery request opens a fresh connection and runs a
 * real query through the proxy. On a loaded CI runner that alone has taken
 * more than the 300 ms / 500 ms these once were, turning a recovered pool into
 * a 503 (three different assertions in this file failed that way on main in one
 * afternoon). The stall tests measure elapsed time relative to these values,
 * so widening them costs a few seconds, not correctness. READ_MS stays well
 * above STATEMENT_MS so the server's cancel (57014) wins over the client's
 * read timeout, which would report a terminated connection instead.
 *
 * Wider budgets raise the threshold; they don't remove the race. If this file
 * fails again with "expected 503 to be 200" on the recovery half, the durable
 * fix is to let expectHealthy retry against a slack deadline (waitFor) so it
 * asserts "the pool recovered", not "within one fixed window".
 */
const CONNECT_MS = 1500;
const STATEMENT_MS = 1500;
const READ_MS = 3500;
/** Slack for CI. Unbounded waits would hang until the test timeout instead. */
const SLACK_MS = 4000;

type Mode = "forward" | "stall" | "blackhole";

/**
 * forward:   pipe both ways
 * stall:     accept new connections and never answer (a handshake that hangs)
 * blackhole: keep forwarding requests but drop every response, on existing
 *            connections too (a connection that silently died mid-query)
 */
function startProxy(target: { host: string; port: number }) {
  const sockets = new Set<net.Socket>();
  const state = { mode: "forward" as Mode };
  const server = net.createServer((client) => {
    sockets.add(client);
    client.on("close", () => sockets.delete(client));
    client.on("error", () => {});
    if (state.mode === "stall") {
      // Read and discard, never answer. A paused socket would never see the
      // client's EOF, so it would look open after pg had closed it.
      client.resume();
      return;
    }
    const upstream = net.connect(target.port, target.host);
    upstream.on("error", () => client.destroy());
    upstream.on("data", (chunk) => {
      if (state.mode !== "blackhole") client.write(chunk);
    });
    upstream.on("close", () => client.destroy());
    client.on("data", (chunk) => upstream.write(chunk));
    client.on("close", () => upstream.destroy());
  });
  return {
    state,
    sockets,
    listen: () =>
      new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port))),
    close: () => {
      for (const socket of sockets) socket.destroy();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function waitFor(check: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

let container: StartedPostgreSqlContainer;
let proxy: ReturnType<typeof startProxy>;
let viaProxy: DbConfig;
let handle: ReturnType<typeof createDb>;
let app: FastifyInstance;

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16-alpine").withTmpFs({ "/var/lib/postgresql/data": "rw,size=256m" }).start();
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  await admin.query("CREATE ROLE albus_migrate LOGIN CREATEROLE PASSWORD 'migrate-secret'");
  await admin.query("CREATE DATABASE albus OWNER albus_migrate");
  await admin.end();

  const direct: DbConfig = {
    host: container.getHost(),
    port: container.getPort(),
    database: "albus",
    user: "albus_migrate",
    password: "migrate-secret",
    ssl: "disable",
  };
  await runMigrations(direct, { appRole: { name: "albus_app", password: "app-secret" } });
  const loader = createDb({ ...direct, user: "albus_app", password: "app-secret" }, { max: 1 });
  await loadParts(loader.db, readValidatedParts(REGISTRY_ROOT));
  await loader.pool.end();

  proxy = startProxy({ host: container.getHost(), port: container.getPort() });
  viaProxy = { ...direct, host: "127.0.0.1", port: await proxy.listen(), user: "albus_app", password: "app-secret" };
});

/** A fresh pool with no connected clients, and the app on it, wired as server.ts does. */
beforeEach(() => {
  handle = createDb(viaProxy, {
    max: MAX,
    connectTimeoutMs: CONNECT_MS,
    statementTimeoutMs: STATEMENT_MS,
    queryTimeoutMs: READ_MS,
    idleTimeoutMs: 30_000,
  });
  // As in server.ts: an idle client's failure is reported on the pool.
  handle.pool.on("error", () => {});
  app = buildApp({
    parts: createPartsStore(handle.db),
    ping: async () => void (await handle.pool.query("SELECT 1")),
    log: createLogger({ write: () => {} }),
    readyTimeoutMs: SLACK_MS,
  });
});

afterEach(async () => {
  proxy.state.mode = "forward";
  await app.close();
  await handle.pool.end();
});

afterAll(async () => {
  await proxy?.close();
  await container?.stop();
});

/** More concurrent requests than the pool has clients, so some must queue. */
async function burst(count = MAX * 2) {
  const started = Date.now();
  const responses = await Promise.all(Array.from({ length: count }, () => app.inject({ method: "GET", url: "/v1/parts" })));
  return { elapsed: Date.now() - started, responses };
}

function expectAllUnavailable(responses: { statusCode: number; json: () => unknown }[]) {
  for (const response of responses) {
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: "UNAVAILABLE" } });
  }
}

async function expectHealthy() {
  const response = await app.inject({ method: "GET", url: "/v1/parts" });
  expect(response.statusCode).toBe(200);
  expect(PartList.parse(response.json()).parts).toHaveLength(12);
  expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(200);
  expect(handle.pool.waitingCount).toBe(0);
  expect(handle.pool.totalCount).toBeLessThanOrEqual(MAX);
}

describe("database timeouts", () => {
  it("fails requests fast during a stalled handshake, then recovers", async () => {
    proxy.state.mode = "stall";
    const { elapsed, responses } = await burst();

    expectAllUnavailable(responses);
    expect(elapsed).toBeLessThan(CONNECT_MS * 2 + SLACK_MS);
    expect((await app.inject({ method: "GET", url: "/readyz" })).statusCode).toBe(503);
    // pg destroys a socket whose handshake timed out: nothing is left open, pooled or queued.
    await waitFor(() => proxy.sockets.size === 0);
    expect(handle.pool.totalCount).toBe(0);
    expect(handle.pool.waitingCount).toBe(0);

    proxy.state.mode = "forward";
    await expectHealthy();
  });

  it("cancels reads stuck behind a lock with statement_timeout, then recovers", async () => {
    await expectHealthy();
    const locker = new pg.Client({ connectionString: container.getConnectionUri().replace(/\/[^/]*$/, "/albus") });
    await locker.connect();
    try {
      await locker.query("BEGIN");
      await locker.query("LOCK TABLE registry.parts IN ACCESS EXCLUSIVE MODE");

      const { elapsed, responses } = await burst();

      expectAllUnavailable(responses);
      expect(elapsed).toBeLessThan(STATEMENT_MS * MAX + CONNECT_MS + SLACK_MS);
    } finally {
      await locker.query("ROLLBACK");
      await locker.end();
    }
    await expectHealthy();
  });

  it("cancels pg_sleep beyond statement_timeout on the server, and the pool keeps working", async () => {
    const started = Date.now();
    await expect(handle.pool.query("SELECT pg_sleep(5)")).rejects.toMatchObject({ code: "57014" });
    expect(Date.now() - started).toBeLessThan(STATEMENT_MS + SLACK_MS);
    expect((await handle.pool.query("SELECT 1 AS ok")).rows).toEqual([{ ok: 1 }]);
  });

  it("destroys clients whose responses stop arriving, instead of reusing them", async () => {
    // Connect both clients first, so the burst runs on established connections.
    await Promise.all([expectHealthy(), expectHealthy()]);
    const established = new Set(proxy.sockets);
    expect(established.size).toBeGreaterThan(0);

    proxy.state.mode = "blackhole";
    const { elapsed, responses } = await burst();

    expectAllUnavailable(responses);
    expect(elapsed).toBeLessThan(READ_MS * MAX + CONNECT_MS + SLACK_MS);
    // Every client whose read timed out was closed, not returned to the pool.
    await waitFor(() => [...established].every((socket) => !proxy.sockets.has(socket)));
    expect(handle.pool.waitingCount).toBe(0);

    // A reused client would still have the lost response pending, and fail or desync.
    proxy.state.mode = "forward";
    await expectHealthy();
    await expectHealthy();
  });
});
