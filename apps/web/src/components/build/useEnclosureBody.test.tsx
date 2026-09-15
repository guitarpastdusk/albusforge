// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ENCLOSURE_FIXTURE, ENCLOSURE_SAMPLE } from "@/components/enclosure/fixture";
import type { ActionResult } from "@/lib/action-result";
import type { EnclosurePreviewData } from "@/components/enclosure/fixture";
import { useEnclosureBody, type EnclosureBodyState } from "./useEnclosureBody";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Load = (buildId: string) => Promise<ActionResult<EnclosurePreviewData | null>>;

let container: HTMLDivElement;
let root: Root;
let latest: EnclosureBodyState;

function Probe({ buildId, ready, load, report }: { buildId: string | null; ready: boolean; load: Load; report: (state: EnclosureBodyState) => void }) {
  report(useEnclosureBody(buildId, ready, ENCLOSURE_SAMPLE, load));
  return null;
}

const report = (state: EnclosureBodyState) => {
  latest = state;
};
const render = (buildId: string | null, ready: boolean, load: Load) => act(async () => root.render(<Probe buildId={buildId} ready={ready} load={load} report={report} />));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("useEnclosureBody", () => {
  it("reads nothing before the card is due, and shows the sample", async () => {
    const load = vi.fn<Load>(async () => ({ ok: true, data: ENCLOSURE_FIXTURE }));
    await render(null, false, load);
    await render("bld_1", false, load);
    expect(load).not.toHaveBeenCalled();
    expect(latest).toMatchObject({ preview: ENCLOSURE_SAMPLE, error: null });
  });

  it("a body replaces the sample; 'no body yet' keeps it", async () => {
    const load = vi.fn<Load>(async () => ({ ok: true, data: ENCLOSURE_FIXTURE }));
    await render("bld_1", true, load);
    expect(load).toHaveBeenCalledWith("bld_1");
    expect(latest.preview).toBe(ENCLOSURE_FIXTURE);

    const none = vi.fn<Load>(async () => ({ ok: true, data: null }));
    await render("bld_2", true, none);
    expect(latest).toMatchObject({ preview: ENCLOSURE_SAMPLE, error: null });
  });

  it("a failed read withdraws the sample, says so, and retry reads again", async () => {
    let calls = 0;
    const load = vi.fn<Load>(async () => (calls++ === 0 ? { ok: false, message: "We couldn’t load the enclosure preview." } : { ok: true, data: ENCLOSURE_FIXTURE }));
    await render("bld_1", true, load);
    expect(latest).toMatchObject({ preview: null, error: "We couldn’t load the enclosure preview." });

    await act(async () => latest.retry());
    expect(load).toHaveBeenCalledTimes(2);
    expect(latest).toMatchObject({ preview: ENCLOSURE_FIXTURE, error: null });
  });

  it("a rejected call is a failure too, never the sample", async () => {
    const load = vi.fn<Load>(async () => {
      throw new Error("lost connection");
    });
    await render("bld_1", true, load);
    expect(latest.preview).toBeNull();
    expect(latest.error).toMatch(/couldn’t reach/);
  });
});
