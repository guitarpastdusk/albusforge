// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PrivateObservationImage } from "./PrivateObservationImage";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it("replaces expired or failed pictures with actionable status and resets when a different image is selected", async () => {
  await act(async () => root.render(<PrivateObservationImage src="/v1/private/one" alt="First capture" width={320} height={240} />));
  const image = container.querySelector("img")!;
  expect(image.getAttribute("src")).toBe("/v1/private/one");
  expect(image.getAttribute("loading")).toBe("lazy");
  await act(async () => image.dispatchEvent(new Event("error")));
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Picture expired or unavailable");
  expect(container.textContent).toContain("Refresh");
  await act(async () => root.render(<PrivateObservationImage src="/v1/private/two" alt="Second capture" width={320} height={240} />));
  expect(container.querySelector("img")?.getAttribute("src")).toBe("/v1/private/two");
  expect(container.querySelector('[role="status"]')).toBeNull();
});
