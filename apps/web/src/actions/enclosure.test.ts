import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "@/lib/api/core";

vi.mock("@/lib/api/server", () => ({ sessionClient: vi.fn() }));
vi.mock("@/lib/action-errors", () => ({ actionFailure: vi.fn(async () => ({ ok: false, message: "failure" })) }));

const { sessionClient } = await import("@/lib/api/server");
const { actionFailure } = await import("@/lib/action-errors");
const { loadEnclosureBody } = await import("./enclosure");

const BODY = { glb_url: "https://storage.googleapis.com/b/1.glb", png_url: "https://storage.googleapis.com/b/1.png", dimensions_label: "90 × 60 × 35 mm", description: "A box.", extra: 1 };

function client(get: (path: string) => Promise<unknown>) {
  const stub = { get: vi.fn(get), mutate: vi.fn(), credentialChange: vi.fn() };
  vi.mocked(sessionClient).mockResolvedValue(stub as never);
  return stub;
}

beforeEach(() => {
  vi.mocked(sessionClient).mockReset();
  vi.mocked(actionFailure).mockClear();
});

describe("loadEnclosureBody", () => {
  it.each([null, 42, "", {}])("(%j) returns the validation result without calling gateway", async (id) => {
    await expect(loadEnclosureBody(id)).resolves.toMatchObject({ ok: false });
    expect(sessionClient).not.toHaveBeenCalled();
  });

  it("a body becomes the build's own preview, not a sample", async () => {
    const stub = client(async () => BODY);
    await expect(loadEnclosureBody("bld_1")).resolves.toEqual({
      ok: true,
      data: { glbUrl: BODY.glb_url, staticImageUrl: BODY.png_url, dimensionsLabel: BODY.dimensions_label, description: BODY.description },
    });
    expect(stub.get.mock.calls[0]![0]).toBe("/v1/builds/bld_1/body");
  });

  it.each([
    ["501, the route isn't built", new ApiRequestError(501, "NOT_IMPLEMENTED", "GET /v1/builds/bld_1/body is not implemented")],
    ["404, no body for this build", new ApiRequestError(404, "NOT_FOUND", "no body")],
  ])("%s: no body yet, nothing logged", async (_label, failure) => {
    client(async () => {
      throw failure;
    });
    await expect(loadEnclosureBody("bld_1")).resolves.toEqual({ ok: true, data: null });
    expect(actionFailure).not.toHaveBeenCalled();
  });

  it("any other failure is logged and reported, never passed off as no body", async () => {
    client(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(loadEnclosureBody("bld_1")).resolves.toEqual({ ok: false, message: "failure" });
    expect(actionFailure).toHaveBeenCalledTimes(1);
  });
});
