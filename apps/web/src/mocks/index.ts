import { routes, type Me, type Method } from "@albusforge/schema";
import { z } from "zod";
import type { Transport, TransportResponse } from "@/lib/api/core";
import * as data from "./data";

type Handler = (
  params: string[],
  query: URLSearchParams,
  body: unknown,
) => TransportResponse | Promise<TransportResponse>;

/** The prototype's timings: the chat's typing delay and the device's reply. Zero under vitest. */
const TYPING_MS = 900;
const DEVICE_REPLY_MS = 800;

const latency = (ms: number) =>
  process.env.NODE_ENV === "test" ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, ms));

const jsonResponse = (status: number, json: unknown, setCookies: readonly string[] = []): TransportResponse => ({
  status,
  contentType: "application/json",
  isJson: true,
  json,
  setCookies,
});

/** The cookies gateway sets (PORTAL.md §5, ADR 0008), so mock mode exercises the same relay as live. */
const COOKIE_ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";
const MONTH = 30 * 24 * 60 * 60;

const ok = (json: unknown): TransportResponse => jsonResponse(200, json);

const MOCK_SESSION_PREFIX = "mock-session.";

/** The session cookie value mock verify issues: the email, so the header can show it. Not a secret — mock mode only. */
export function mockSessionCookie(email: string): string {
  return MOCK_SESSION_PREFIX + Buffer.from(email, "utf8").toString("base64url");
}

/** Mock mode's GET /v1/me for a session cookie: the session it issued, or null (logged out). */
export function mockSession(cookieValue: string): Me | null {
  if (!cookieValue.startsWith(MOCK_SESSION_PREFIX)) return null;
  const encoded = cookieValue.slice(MOCK_SESSION_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  const email = z.email().safeParse(Buffer.from(encoded, "base64url").toString("utf8"));
  return email.success ? data.verifiedSession(email.data) : null;
}

/** 202/204: success with an empty body. */
const empty = (status: number): TransportResponse => ({ status, contentType: null, isJson: true, json: null });

const badRequest = (message: string): TransportResponse =>
  jsonResponse(400, { error: { code: "invalid_request", message } });

const notFound = (what: string): TransportResponse =>
  jsonResponse(404, { error: { code: "not_found", message: `${what} not found` } });

const orNotFound = (what: string, json: unknown) => (json === null ? notFound(what) : ok(json));

function field(body: unknown, key: string): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

const handlers: Array<[{ method: Method; pattern: string }, Handler]> = [
  [routes.auth.requestCode, (_params, _query, body) => (field(body, "email") ? empty(204) : badRequest("email is required"))],
  [
    routes.auth.verify,
    (_params, _query, body) => {
      const email = field(body, "email");
      const code = field(body, "code");
      // Mock mode: any 6 digits verify.
      if (!email || !code || !/^\d{6}$/.test(code)) return badRequest("email and a 6-digit code are required");
      return jsonResponse(200, data.verifiedSession(email), [
        `__Host-albus_session=${mockSessionCookie(email)}; ${COOKIE_ATTRIBUTES}; Max-Age=${MONTH}`,
        `__Host-albus_anon=; ${COOKIE_ATTRIBUTES}; Max-Age=0`,
      ]);
    },
  ],
  [
    routes.auth.signOut,
    () => ({ ...empty(204), setCookies: [`__Host-albus_session=; ${COOKIE_ATTRIBUTES}; Max-Age=0`] }),
  ],
  [routes.me.get, () => ok(data.me())],
  [routes.builds.list, () => ok(data.buildList())],
  [
    routes.builds.create,
    async (_params, _query, body) => {
      const ask = field(body, "ask_text")?.trim();
      if (!ask) return badRequest("ask_text is required");
      await latency(TYPING_MS);
      const created = data.createBuild(ask);
      return jsonResponse(201, created, [`__Host-albus_anon=mock-anon-${created.build_id}; ${COOKIE_ATTRIBUTES}; Max-Age=${MONTH}`]);
    },
  ],
  [routes.builds.get, ([id = ""]) => orNotFound(`build ${id}`, data.buildDetail(id))],
  [routes.builds.messages, ([id = ""]) => orNotFound(`build ${id}`, data.messages(id))],
  [
    routes.builds.postMessage,
    async ([id = ""], _query, body) => {
      const text = field(body, "text")?.trim();
      if (!text) return badRequest("text is required");
      await latency(TYPING_MS);
      return data.postBuildMessage(id, text) ? empty(202) : notFound(`build ${id}`);
    },
  ],
  [routes.tenants.devices, () => ok(data.fleet())],
  [routes.devices.dashboard, ([id = ""]) => orNotFound(`device ${id}`, data.dashboard(id))],
  [
    routes.devices.ask,
    async ([id = ""], _query, body) => {
      if (!field(body, "text")?.trim()) return badRequest("text is required");
      await latency(DEVICE_REPLY_MS);
      return orNotFound(`device ${id}`, data.askDevice(id));
    },
  ],
  [
    routes.devices.actions.setEnabled,
    ([id = "", actionId = ""], _query, body) => {
      const enabled = typeof body === "object" && body !== null ? (body as Record<string, unknown>).enabled : undefined;
      if (typeof enabled !== "boolean") return badRequest("enabled must be a boolean");
      return orNotFound(`action ${actionId} on device ${id}`, data.setActionEnabled(id, actionId, enabled));
    },
  ],
  [
    routes.devices.actions.propose,
    async ([id = ""], _query, body) => {
      const text = field(body, "text")?.trim();
      if (!text) return badRequest("text is required");
      await latency(DEVICE_REPLY_MS);
      return orNotFound(`device ${id}`, data.proposeAction(id, text));
    },
  ],
  [
    routes.devices.actions.create,
    ([id = ""], _query, body) => {
      const proposalId = field(body, "proposal_id");
      if (!proposalId) return badRequest("proposal_id is required");
      const outcome = data.confirmAction(id, proposalId);
      if (outcome.ok) return jsonResponse(201, outcome.action);
      if (outcome.reason === "unresolved") {
        return jsonResponse(409, { error: { code: "unresolved_proposal", message: "Resolve the proposal's issues before confirming it.", details: outcome.issues } });
      }
      return notFound(`proposal ${proposalId}`);
    },
  ],
  [routes.usage, () => ok(data.usage())],
];

/** Match "/v1/builds/:id" against "/v1/builds/abc"; returns the decoded params, or null. */
function match(pattern: string, pathname: string): string[] | null {
  const want = pattern.split("/");
  const got = pathname.split("/");
  if (want.length !== got.length) return null;

  const params: string[] = [];
  for (const [i, part] of want.entries()) {
    const actual = got[i] ?? "";
    if (part.startsWith(":")) params.push(decodeURIComponent(actual));
    else if (part !== actual) return null;
  }
  return params;
}

/** Answers API calls from ./data. Routes without a mock return 501. */
export const mockTransport: Transport = async (method, path, body) => {
  const url = new URL(path, "http://mock");

  for (const [route, handler] of handlers) {
    if (route.method !== method) continue;
    const params = match(route.pattern, url.pathname);
    if (params) return await handler(params, url.searchParams, body);
  }

  return jsonResponse(501, { error: { code: "no_mock", message: `No mock for ${method} ${url.pathname}` } });
};
