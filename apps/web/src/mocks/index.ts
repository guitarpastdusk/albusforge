import { routes, type Method } from "@albusforge/schema";
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

const jsonResponse = (status: number, json: unknown): TransportResponse => ({
  status,
  contentType: "application/json",
  isJson: true,
  json,
});

const ok = (json: unknown): TransportResponse => jsonResponse(200, json);

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
      return ok(data.verifiedSession(email));
    },
  ],
  [routes.me.get, () => ok(data.me())],
  [routes.builds.list, () => ok(data.buildList())],
  [
    routes.builds.create,
    async (_params, _query, body) => {
      const ask = field(body, "ask_text")?.trim();
      if (!ask) return badRequest("ask_text is required");
      await latency(TYPING_MS);
      return jsonResponse(201, data.createBuild(ask));
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
  [routes.showcase, () => ok(data.showcase())],
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
  [routes.listings.list, (_, query) => ok(data.listingList(query.get("tags")))],
  [routes.listings.get, ([id = ""]) => orNotFound(`listing ${id}`, data.listing(id))],
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
