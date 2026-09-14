import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api/core";
vi.mock("@/lib/session", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/api/server", () => ({ apiGet: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); }, useRouter: () => ({ refresh: vi.fn() }) }));
const { apiGet } = await import("@/lib/api/server");
const { requireSession } = await import("@/lib/session");
const { default: SetupPage } = await import("./page");
const id = "6bb677e5-d5ce-4557-b90f-109e579cb629";
const render = async (device?: string | string[]) => renderToStaticMarkup(await SetupPage({ searchParams: Promise.resolve({ device }) }));
beforeEach(() => { vi.mocked(apiGet).mockReset(); vi.mocked(requireSession).mockReset(); });
it("guards the exact destination before reading setup; malformed IDs never reach API", async () => {
  expect(await render("not-a-device")).toContain("Enter a valid device ID");
  expect(requireSession).toHaveBeenCalledWith("/setup?device=not-a-device");
  expect(apiGet).not.toHaveBeenCalled();
  expect(await render([id, id])).toContain("Enter a valid device ID");
  vi.mocked(requireSession).mockRejectedValue(new Error("guarded"));
  await expect(render(id)).rejects.toThrow("guarded"); expect(apiGet).not.toHaveBeenCalled();
});
it("explains registration limits without asking for credentials", async () => {
  const html = await render();
  expect(html).toContain("Start with an existing registration");
  expect(html).toContain("does not create or transfer a device");
  expect(html).not.toContain('name="token"'); expect(apiGet).not.toHaveBeenCalled();
});
it.each([403,404])("gives the same opaque unavailable UI for %s", async status => {
  vi.mocked(apiGet).mockRejectedValue(new ApiRequestError(status, "NOT_FOUND", "private backend detail"));
  const html = await render(id); expect(html).toContain("Device unavailable"); expect(html).not.toContain("private backend detail");
});
it("preserves setup destination on session expiry and distinguishes service failure", async () => {
  vi.mocked(apiGet).mockRejectedValue(new ApiRequestError(401, "UNAUTHORIZED", "expired"));
  await expect(render(id)).rejects.toThrow(`/signin?next=%2Fsetup%3Fdevice%3D${id}`);
  vi.mocked(apiGet).mockRejectedValue(new ApiRequestError(503, "UNAVAILABLE", "busy"));
  expect(await render(id)).toContain("Setup status is temporarily unavailable");
  vi.mocked(apiGet).mockRejectedValue(new Error("unexpected"));
  await expect(render(id)).rejects.toThrow("unexpected");
});
