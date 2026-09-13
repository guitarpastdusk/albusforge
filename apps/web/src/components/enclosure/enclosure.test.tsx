// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnclosureCanvasProps } from "./EnclosureCanvas";

/** The 3D stage is replaced: these tests cover the UI around it, without WebGL. */
const canvasProps: EnclosureCanvasProps[] = [];
vi.mock("./EnclosureCanvas", () => ({
  default: (props: EnclosureCanvasProps) => {
    canvasProps.push(props);
    return <div data-testid="enclosure-canvas" />;
  },
}));

const { EnclosurePreview } = await import("./EnclosurePreview");
const { EnclosureDialogButton } = await import("./EnclosureDialog");
const { ENCLOSURE_FIXTURE } = await import("./fixture");
const { ModelLoadError, previewMode, RendererUnavailableError, resetWebGLSupportCache, supportsWebGL2 } = await import("./modes");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const render = async (ui: ReactNode) => {
  await act(async () => {
    root.render(ui);
  });
};
const flush = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
const webgl = (available: boolean) =>
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => (available ? { getExtension: () => null } : null)) as never);
const reducedMotion = (matches: boolean) =>
  vi.spyOn(window, "matchMedia").mockImplementation(
    (() => ({ matches, addEventListener: () => {}, removeEventListener: () => {} })) as never,
  );
const byName = (name: string) =>
  [...document.querySelectorAll<HTMLElement>("button, [role=switch]")].find((el) => (el.getAttribute("aria-label") ?? el.textContent?.trim()) === name);
const click = (el: HTMLElement | undefined) =>
  act(async () => {
    el!.click();
  });
const key = (keyName: string, shiftKey = false) =>
  act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: keyName, shiftKey, bubbles: true }));
  });
const lastCanvas = () => canvasProps.at(-1)!;
const waitForCanvas = () => vi.waitFor(async () => {
  await flush();
  expect(canvasProps.length).toBeGreaterThan(0);
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  canvasProps.length = 0;
  resetWebGLSupportCache();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("EnclosurePreview (lazy wrapper)", () => {
  it("renders its loading state while the 3D chunk and the model load, then clears it when ready", async () => {
    webgl(true);
    await render(<EnclosurePreview preview={ENCLOSURE_FIXTURE} />);
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Loading 3D preview…");
    expect(document.querySelector("h3")?.textContent).toBe("Enclosure · 3D preview");
    expect(container.textContent).toContain("90 × 60 × 35 mm · 1.6 mm wall");

    await waitForCanvas();
    expect(lastCanvas()).toMatchObject({ glbUrl: "/enclosure/fixture.glb", view: "base", showParts: false, autoRotate: false });
    expect(document.querySelector('[role="status"]')).not.toBeNull();

    await act(async () => lastCanvas().onReady());
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("switching views, parts and reset update the stage's props, with the selected view pressed", async () => {
    webgl(true);
    await render(<EnclosurePreview preview={ENCLOSURE_FIXTURE} />);
    await waitForCanvas();
    await act(async () => lastCanvas().onReady());

    expect(byName("Base")?.getAttribute("aria-pressed")).toBe("true");
    await click(byName("Lid"));
    expect(byName("Lid")?.getAttribute("aria-pressed")).toBe("true");
    expect(byName("Base")?.getAttribute("aria-pressed")).toBe("false");
    expect(lastCanvas().view).toBe("lid");
    expect(byName("Lid")?.className).toContain("bg-coral");

    await click(byName("Exploded"));
    expect(lastCanvas().view).toBe("exploded");

    await click(byName("Show parts"));
    expect(lastCanvas().showParts).toBe(true);
    expect(byName("Show parts")?.getAttribute("aria-checked")).toBe("true");

    await click(byName("Reset view"));
    expect(lastCanvas().resetToken).toBe(1);
  });

  it("a failed model fetch shows the service-unavailable state, and Try again reloads", async () => {
    webgl(true);
    await render(<EnclosurePreview preview={ENCLOSURE_FIXTURE} />);
    await waitForCanvas();
    await act(async () => lastCanvas().onError(new ModelLoadError("GET /enclosure/fixture.glb returned 404")));

    const alert = document.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Service unavailable");
    expect(alert?.textContent).toContain("We can’t load the 3D preview right now.");

    await click(byName("Try again"));
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toBe("Loading 3D preview…");
  });

  it("a WebGL-1-only browser (webgl2 null, webgl available) gets the static image, not a download error", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(((id: string) => (id === "webgl2" ? null : { getExtension: () => null })) as never);
    await render(<EnclosurePreview preview={ENCLOSURE_FIXTURE} />);
    await flush();
    expect(document.querySelector("img")?.getAttribute("alt")).toBe(ENCLOSURE_FIXTURE.description);
    expect(canvasProps).toHaveLength(0);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(byName("Try again")).toBeUndefined();
  });

  it("if the renderer still can't start, the static image replaces the stage — no Try again", async () => {
    webgl(true);
    await render(<EnclosurePreview preview={ENCLOSURE_FIXTURE} />);
    await waitForCanvas();
    await act(async () => lastCanvas().onError(new RendererUnavailableError(new Error("Error creating WebGL context."))));
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/enclosure/fixture.png");
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(byName("Try again")).toBeUndefined();
    expect(document.querySelector('[data-testid="enclosure-canvas"]')).toBeNull();
  });

  it("probes WebGL 2 specifically", () => {
    const doc = (contexts: Record<string, unknown>) =>
      ({ createElement: () => ({ getContext: (id: string) => contexts[id] ?? null }) }) as unknown as Document;
    expect(supportsWebGL2(doc({ webgl: {} }))).toBe(false);
    expect(supportsWebGL2(doc({}))).toBe(false);
    expect(supportsWebGL2(doc({ webgl2: { getExtension: () => null } }))).toBe(true);
  });

  it("without WebGL shows the static image with alt text, loads no 3D stage, and disables the controls", async () => {
    webgl(false);
    await render(<EnclosurePreview preview={ENCLOSURE_FIXTURE} />);
    await flush();

    const image = document.querySelector("img");
    expect(image?.getAttribute("src")).toBe("/enclosure/fixture.png");
    expect(image?.getAttribute("alt")).toBe(ENCLOSURE_FIXTURE.description);
    expect(canvasProps).toHaveLength(0);
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect((byName("Lid") as HTMLButtonElement).disabled).toBe(true);
    expect(container.textContent).toContain("Still image");
  });

  it("with reduced motion, auto-rotate falls back to the static image; without auto-rotate the 3D view stays", async () => {
    webgl(true);
    reducedMotion(true);
    await render(<EnclosurePreview preview={ENCLOSURE_FIXTURE} autoRotate />);
    await flush();
    expect(document.querySelector("img")).not.toBeNull();
    expect(canvasProps).toHaveLength(0);

    await render(<EnclosurePreview preview={ENCLOSURE_FIXTURE} />);
    await waitForCanvas();
    expect(document.querySelector("img")).toBeNull();
  });

  it("live mode (no preview) shows the placeholder and requests nothing", async () => {
    webgl(true);
    await render(<EnclosurePreview preview={null} />);
    await flush();
    expect(container.textContent).toContain("Preview available once the enclosure is generated");
    expect(canvasProps).toHaveLength(0);
    expect(container.querySelector("button")).toBeNull();
  });

  it("chooses the static image only without WebGL, or for auto-rotate with reduced motion", () => {
    expect(previewMode({ webgl: false, reducedMotion: false, autoRotate: false })).toBe("static");
    expect(previewMode({ webgl: true, reducedMotion: true, autoRotate: true })).toBe("static");
    expect(previewMode({ webgl: true, reducedMotion: true, autoRotate: false })).toBe("interactive");
    expect(previewMode({ webgl: true, reducedMotion: false, autoRotate: true })).toBe("interactive");
  });
});

describe("EnclosureDialogButton", () => {
  it("opens a modal dialog, moves focus in, keeps Tab inside, and Escape closes it and returns focus", async () => {
    webgl(true);
    await render(<EnclosureDialogButton preview={ENCLOSURE_FIXTURE} title="Greenhouse soil monitor" />);
    const trigger = byName("View enclosure in 3D →")!;
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    trigger.focus();
    await click(trigger);

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const titleId = dialog?.getAttribute("aria-labelledby");
    expect(document.getElementById(titleId!)?.textContent).toBe("Greenhouse soil monitor · enclosure");
    const close = byName("Close 3D preview")!;
    expect(document.activeElement).toBe(close);

    const focusables = [...dialog!.querySelectorAll<HTMLElement>("button:not([disabled]), [tabindex]:not([tabindex='-1'])")];
    const last = focusables.at(-1)!;
    last.focus();
    await key("Tab");
    expect(document.activeElement).toBe(close);
    await key("Tab", true);
    expect(document.activeElement).toBe(last);

    await key("Escape");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("makes the background inert while open — even a programmatic focus() can't land there — and restores it after", async () => {
    webgl(true);
    const outside = document.createElement("div");
    outside.innerHTML = '<a href="/signup">Sign up</a>';
    document.body.prepend(outside);
    const alreadyInert = document.createElement("div");
    alreadyInert.setAttribute("inert", "");
    document.body.append(alreadyInert);

    await render(
      <>
        <a href="/docs">Docs</a>
        <EnclosureDialogButton preview={ENCLOSURE_FIXTURE} title="Greenhouse soil monitor" />
      </>,
    );
    const trigger = byName("View enclosure in 3D →")!;
    await click(trigger);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;

    expect(outside.hasAttribute("inert")).toBe(true);
    expect(container.hasAttribute("inert")).toBe(true);
    expect(dialog.closest("[inert]")).toBeNull();

    const link = outside.querySelector("a")!;
    await act(async () => link.focus());
    expect(document.activeElement).not.toBe(link);
    expect(dialog.contains(document.activeElement)).toBe(true);
    await act(async () => container.querySelector<HTMLElement>('a[href="/docs"]')!.focus());
    expect(dialog.contains(document.activeElement)).toBe(true);

    await key("Escape");
    expect(outside.hasAttribute("inert")).toBe(false);
    expect(container.hasAttribute("inert")).toBe(false);
    expect(alreadyInert.hasAttribute("inert")).toBe(true);
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("");
    outside.remove();
    alreadyInert.remove();
  });

  it("Close returns focus to the trigger too", async () => {
    webgl(true);
    await render(<EnclosureDialogButton preview={ENCLOSURE_FIXTURE} title="Greenhouse soil monitor" />);
    const trigger = byName("View enclosure in 3D →")!;
    await click(trigger);
    await click(byName("Close 3D preview"));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
