import { routes, type Method } from "@albusforge/schema";
import type { Transport, TransportResponse } from "@/lib/api/core";
import * as data from "./data";

type Handler = (params: string[], query: URLSearchParams, body: unknown) => TransportResponse;

const jsonResponse = (status: number, json: unknown): TransportResponse => ({
  status,
  contentType: "application/json",
  isJson: true,
  json,
});

const ok = (json: unknown): TransportResponse => jsonResponse(200, json);

const notFound = (what: string): TransportResponse =>
  jsonResponse(404, { error: { code: "not_found", message: `${what} not found` } });

const orNotFound = (what: string, json: unknown) => (json === null ? notFound(what) : ok(json));

const handlers: Array<[{ method: Method; pattern: string }, Handler]> = [
  [routes.me.get, () => ok(data.me())],
  [routes.builds.list, () => ok(data.buildList())],
  [routes.builds.get, ([id = ""]) => orNotFound(`build ${id}`, data.buildDetail(id))],
  [routes.builds.messages, ([id = ""]) => orNotFound(`build ${id}`, data.messages(id))],
  [routes.showcase, () => ok(data.showcase())],
  [routes.tenants.devices, () => ok(data.fleet())],
  [routes.devices.dashboard, ([id = ""]) => orNotFound(`device ${id}`, data.dashboard(id))],
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
    if (params) return handler(params, url.searchParams, body);
  }

  return jsonResponse(501, { error: { code: "no_mock", message: `No mock for ${method} ${url.pathname}` } });
};
