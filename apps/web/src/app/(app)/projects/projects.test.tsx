import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import ProjectsPage from "./page";
import ProjectPage from "./[buildId]/page";

const mocks = vi.hoisted(() => ({ requireSession: vi.fn(), apiGet: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/api/server", () => ({ apiGet: mocks.apiGet, orNotFound: (result: unknown) => result }));
beforeEach(() => vi.resetAllMocks());

it("shows a first-project invitation when the authenticated list is empty", async () => {
  mocks.apiGet.mockResolvedValue({ builds: [] });
  const html = renderToStaticMarkup(await ProjectsPage());
  expect(mocks.requireSession).toHaveBeenCalledWith("/projects");
  expect(html).toContain("Start your first project");
  expect(html).toContain("Describe a device");
});

it("links every project card to its overview including designs", async () => {
  mocks.apiGet.mockResolvedValue({ builds: [{ id: "bld_1", name: "Garden", description: "Plants", display_status: "designing", device_count: 0, updated_at: "2026-09-13T12:00:00Z" }] });
  const html = renderToStaticMarkup(await ProjectsPage());
  expect(html).toContain('href="/projects/bld_1"');
  expect(html).not.toContain("Start your first project");
});

it("does not request protected project data before session authorization", async () => {
  mocks.requireSession.mockRejectedValue(new Error("redirect to sign in"));
  await expect(ProjectPage({ params: Promise.resolve({ buildId: "bld_1" }) })).rejects.toThrow("redirect to sign in");
  expect(mocks.requireSession).toHaveBeenCalledWith("/projects/bld_1");
  expect(mocks.apiGet).not.toHaveBeenCalled();
});
