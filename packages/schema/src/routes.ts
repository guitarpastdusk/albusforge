/**
 * Every portal-facing route. `pattern` is the canonical spelling (and what the
 * portal's mock resolver matches on); `path()` builds a concrete URL.
 */

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface Route<Args extends string[] = []> {
  method: Method;
  pattern: string;
  path: (...args: Args) => string;
}

const seg = encodeURIComponent;

function fixed(method: Method, pattern: string): Route {
  return { method, pattern, path: () => pattern };
}

function byId(method: Method, pattern: string): Route<[id: string]> {
  return { method, pattern, path: (id) => pattern.replace(":id", seg(id)) };
}

export const routes = {
  auth: {
    requestCode: fixed("POST", "/v1/auth/code"),
    /** Body VerifyCodeRequest → VerifyCodeResponse (= Me) + Set-Cookie. */
    verify: fixed("POST", "/v1/auth/verify"),
    signOut: fixed("POST", "/v1/auth/signout"),
  },
  me: {
    /** GET /v1/me → Me | 401 */
    get: fixed("GET", "/v1/me"),
    /** Body SetActiveTenantRequest → 204. */
    setActiveTenant: fixed("PUT", "/v1/me/active-tenant"),
  },

  builds: {
    create: fixed("POST", "/v1/builds"),
    list: fixed("GET", "/v1/builds"),
    get: byId("GET", "/v1/builds/:id"),
    messages: byId("GET", "/v1/builds/:id/messages"),
    postMessage: byId("POST", "/v1/builds/:id/messages"),
    /** SSE — stage progress and assistant replies. */
    events: byId("GET", "/v1/builds/:id/events"),
  },

  showcase: fixed("GET", "/v1/showcase"),

  tenants: {
    devices: byId("GET", "/v1/tenants/:id/devices"),
    /** SSE — live readings for every device the session may see. */
    stream: byId("GET", "/v1/tenants/:id/stream"),
  },

  devices: {
    dashboard: byId("GET", "/v1/devices/:id/dashboard"),
    series: byId("GET", "/v1/devices/:id/series"),
    ask: byId("POST", "/v1/devices/:id/ask"),
  },

  listings: {
    list: fixed("GET", "/v1/listings"),
    get: byId("GET", "/v1/listings/:id"),
    remix: byId("POST", "/v1/listings/:id/remix"),
  },

  /** The active tenant's current period. */
  usage: fixed("GET", "/v1/usage"),
} as const;
