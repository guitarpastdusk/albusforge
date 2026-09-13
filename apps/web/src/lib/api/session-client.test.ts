import { ANON_OWNER_COOKIE, BuildDetail, CreateBuildResponse, Me, MessageList, routes, SESSION_COOKIE } from "@albusforge/schema";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiRequestError, fetchTransport, request } from "./core";
import { gatewayHeaders } from "./gateway-headers.server";
import { createSessionClient } from "./session-client";

/*
 * A local HTTP gateway stub that enforces ownership the way PORTAL.md §5
 * describes: reading a build needs its anonymous owner cookie or a session.
 */

const ATTRS = "Path=/; Secure; HttpOnly; SameSite=Lax";
const ME = {
  user: { id: "usr_1", email: "you@example.com", display_name: null },
  tenant: { id: "ten_1", name: "Personal", slug: null, role: "admin" },
  tenants: [{ id: "ten_1", name: "Personal", slug: null, role: "admin" }],
};

const seen: Array<{ method: string; path: string; cookie: string | undefined }> = [];
/** Resolves when the server sees a held-open request's connection close (the client aborted). */
const closed = new Map<string, Promise<void>>();
let base = "";
let server: http.Server;

const json = (res: http.ServerResponse, status: number, body: unknown, cookies: string[] = []) => {
  res.writeHead(status, { "content-type": "application/json", ...(cookies.length ? { "set-cookie": cookies } : {}) });
  res.end(JSON.stringify(body));
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const path = (req.url ?? "").split("?")[0]!;
    const cookie = req.headers.cookie;
    seen.push({ method: req.method ?? "", path, cookie });
    if (path === "/v1/hang/headers" || path === "/v1/hang/body") {
      closed.set(path, new Promise((resolve) => res.on("close", () => resolve())));
      // Never finish: no headers at all, or headers and half a body.
      if (path === "/v1/hang/body") {
        res.writeHead(200, { "content-type": "application/json" });
        res.write('{"messages":[');
      }
      return;
    }
    const owner = cookie?.includes(`${ANON_OWNER_COOKIE}=anon-1`) || cookie?.includes(`${SESSION_COOKIE}=sess-1`);

    if (req.method === "POST" && path === "/v1/builds") {
      return json(res, 201, { build_id: "b1", status: "designing" }, [
        `${ANON_OWNER_COOKIE}=anon-1; ${ATTRS}; Max-Age=2592000`,
        "tracker=abc; Path=/; Max-Age=60",
      ]);
    }
    if (req.method === "GET" && path === "/v1/builds/b1/messages") {
      return owner ? json(res, 200, { messages: [] }) : json(res, 401, { error: { code: "unauthorized", message: "not the owner" } });
    }
    if (req.method === "GET" && path === "/v1/builds/b1") {
      return owner
        ? json(res, 200, { id: "b1", name: "New build", description: "", display_status: "designing", device_count: 0, updated_at: "2026-09-13T12:00:00Z", ready: null })
        : json(res, 401, { error: { code: "unauthorized", message: "not the owner" } });
    }
    if (req.method === "POST" && path === "/v1/auth/verify") {
      return json(res, 200, ME, [`${SESSION_COOKIE}=sess-1; ${ATTRS}; Max-Age=2592000`, `${ANON_OWNER_COOKIE}=; ${ATTRS}; Max-Age=0`, "tracker=def; Path=/"]);
    }
    if (req.method === "GET" && path === "/v1/me") {
      return cookie?.includes(`${SESSION_COOKIE}=sess-1`) ? json(res, 200, ME) : json(res, 401, { error: { code: "unauthorized", message: "no session" } });
    }
    json(res, 404, { error: { code: "not_found", message: path } });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
);
beforeEach(() => {
  seen.length = 0;
});

/** The live transport's header assembly: only allowlisted cookies go upstream. */
const transportFor = (cookie: string | null) => fetchTransport(base, gatewayHeaders({ host: "albusforge.ai", forwardedFor: null, cookie }, null, 1));

describe("createSessionClient against a gateway stub", () => {
  it("without relaying, the follow-up read after creating a build is refused (the bug)", async () => {
    await request(transportFor("theme=dark"), "POST", routes.builds.create.path(), CreateBuildResponse, { ask_text: "hi" });
    await expect(request(transportFor("theme=dark"), "GET", routes.builds.messages.path("b1"), MessageList)).rejects.toBeInstanceOf(ApiRequestError);
  });

  it("create → relays only the anonymous cookie, and the follow-up reads carry it", async () => {
    const writer = { set: vi.fn(), delete: vi.fn() };
    const client = createSessionClient({ transportFor, cookieHeader: "theme=dark", writer });

    const { build_id } = await client.mutate("POST", routes.builds.create.path(), CreateBuildResponse, { ask_text: "hi" });
    await client.get(routes.builds.get.path(build_id), BuildDetail);
    await client.get(routes.builds.messages.path(build_id), MessageList);

    expect(writer.set).toHaveBeenCalledTimes(1);
    expect(writer.set).toHaveBeenCalledWith(ANON_OWNER_COOKIE, "anon-1", {
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      maxAge: 2592000,
    });
    expect(writer.delete).not.toHaveBeenCalled();
    expect(client.credentialChange(ANON_OWNER_COOKIE)).toBe("set");

    const reads = seen.filter((r) => r.method === "GET");
    expect(reads.map((r) => r.cookie)).toEqual([`${ANON_OWNER_COOKIE}=anon-1`, `${ANON_OWNER_COOKIE}=anon-1`]);
    expect(JSON.stringify(seen)).not.toContain("tracker");
    expect(JSON.stringify(seen)).not.toContain("theme");
  });

  it("verify → sets the session, clears the anonymous cookie, and later calls use the session only", async () => {
    const writer = { set: vi.fn(), delete: vi.fn() };
    const client = createSessionClient({ transportFor, cookieHeader: `${ANON_OWNER_COOKIE}=anon-1; theme=dark`, writer });

    await client.mutate("POST", routes.auth.verify.path(), Me, { email: "you@example.com", code: "123456" });
    await client.get(routes.me.get.path(), Me);

    expect(writer.set).toHaveBeenCalledTimes(1);
    expect(writer.set).toHaveBeenCalledWith(SESSION_COOKIE, "sess-1", { path: "/", secure: true, httpOnly: true, sameSite: "lax", maxAge: 2592000 });
    expect(writer.delete).toHaveBeenCalledWith(ANON_OWNER_COOKIE, expect.objectContaining({ path: "/", secure: true }));
    expect(client.credentialChange(SESSION_COOKIE)).toBe("set");
    expect(client.credentialChange(ANON_OWNER_COOKIE)).toBe("deleted");
    expect(seen.at(-1)).toMatchObject({ path: "/v1/me", cookie: `${SESSION_COOKIE}=sess-1` });
  });

  it("records no change when a mutation sets no credential cookie", async () => {
    const writer = { set: vi.fn(), delete: vi.fn() };
    const client = createSessionClient({ transportFor, cookieHeader: null, writer });
    await expect(client.mutate("POST", "/v1/nowhere", z.unknown(), {})).rejects.toBeInstanceOf(ApiRequestError);
    expect(client.credentialChange(SESSION_COOKIE)).toBeUndefined();
    expect(writer.set).not.toHaveBeenCalled();
  });
});

describe("aborting a read", () => {
  it.each(["/v1/hang/headers", "/v1/hang/body"])("the signal reaches fetch and cancels %s, closing the connection", async (path) => {
    const client = createSessionClient({ transportFor, cookieHeader: null, writer: { set: vi.fn(), delete: vi.fn() } });
    const controller = new AbortController();
    const read = client.get(path, MessageList, { signal: controller.signal });
    const outcome = read.then(
      () => "resolved",
      (error: unknown) => error,
    );

    await vi.waitFor(() => expect(closed.has(path)).toBe(true));
    const reason = new Error("deadline");
    controller.abort(reason);

    expect(await outcome).toBe(reason);
    await closed.get(path);
  });
});
