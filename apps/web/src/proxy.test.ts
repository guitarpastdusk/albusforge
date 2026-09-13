import { SESSION_COOKIE } from "@albusforge/schema";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

const request = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, cookie ? { headers: { cookie } } : undefined);

describe("proxy session guard", () => {
  it("runs on the whole (app) group", () => {
    expect(config.matcher).toEqual(["/projects/:path*", "/live/:path*", "/usage/:path*"]);
  });

  it.each([
    ["/projects", "/signin?next=%2Fprojects"],
    ["/projects/greenhouse-soil", "/signin?next=%2Fprojects%2Fgreenhouse-soil"],
    ["/live", "/signin?next=%2Flive"],
    ["/live/bed-a?range=24h", "/signin?next=%2Flive%2Fbed-a%3Frange%3D24h"],
    ["/usage", "/signin?next=%2Fusage"],
  ])("redirects a logged-out visitor from %s to %s", (path, location) => {
    const response = proxy(request(path));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname + new URL(response.headers.get("location")!).search).toBe(location);
    expect(new URL(response.headers.get("location")!).origin).toBe("http://localhost:3000");
  });

  it("ignores other cookies, and an empty session cookie", () => {
    expect(proxy(request("/live", "theme=dark; __Host-albus_anon=a1")).status).toBe(307);
    expect(proxy(request("/live", `${SESSION_COOKIE}=`)).status).toBe(307);
  });

  it("lets a request with a session cookie through to the page, which checks it for real", () => {
    const response = proxy(request("/live/bed-a", `${SESSION_COOKIE}=mock-session.abc`));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
