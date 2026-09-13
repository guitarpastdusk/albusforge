// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectLoading from "@/app/(app)/projects/loading";
import DetailLoading from "@/app/(app)/projects/[buildId]/loading";
import UsageLoading from "@/app/(app)/usage/loading";
import DeviceLoading from "@/app/(app)/live/[deviceId]/loading";
import ProjectMissing from "@/app/(app)/projects/[buildId]/not-found";
import DeviceMissing from "@/app/(app)/live/[deviceId]/not-found";
import ProjectsError from "@/app/(app)/projects/error";
import ProjectError from "@/app/(app)/projects/[buildId]/error";
import UsageError from "@/app/(app)/usage/error";
import DeviceError from "@/app/(app)/live/[deviceId]/error";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
afterEach(() => {
  document.body.innerHTML = "";
});
describe("segment loading states", () => {
  it.each([ProjectLoading, DetailLoading, UsageLoading, DeviceLoading])(
    "has one main, a heading, live progress and an escape link",
    (Loading) => {
      document.body.innerHTML = renderToStaticMarkup(<Loading />);
      expect(document.querySelectorAll("main")).toHaveLength(1);
      expect(document.querySelector("h1")?.textContent).toMatch(/^Loading /);
      expect(document.querySelector('[role="status"]')?.textContent).toContain(
        "loading",
      );
      expect(document.querySelector("a")?.getAttribute("href")).toMatch(/^\//);
      expect(document.activeElement).toBe(document.body);
    },
  );
});
it.each([
  [ProjectMissing, "/projects"],
  [DeviceMissing, "/live"],
] as const)(
  "keeps not-found opaque with safe list navigation",
  (Missing, href) => {
    document.body.innerHTML = renderToStaticMarkup(<Missing />);
    expect(document.querySelector("h1")?.textContent).toContain("unavailable");
    expect(document.querySelector("main")?.textContent).toContain(
      "current workspace",
    );
    expect(document.querySelector("a")?.getAttribute("href")).toBe(href);
  },
);
it.each([ProjectsError, ProjectError, UsageError, DeviceError])(
  "focuses the recovery heading and invokes current Next retry without exposing failure content",
  async (ErrorPage) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host),
      retry = vi.fn();
    const error = Object.assign(new Error("secret driver credential"), {
      digest: "diagnostic-123",
    });
    try {
      await act(async () =>
        root.render(<ErrorPage error={error} retry={retry} />),
      );
      expect(document.activeElement).toBe(host.querySelector("h1"));
      expect(host.textContent).not.toContain("secret driver credential");
      expect(host.textContent).toContain("diagnostic-123");
      expect(host.textContent).toContain("access may have changed");
      await act(async () => host.querySelector("button")!.click());
      expect(retry).toHaveBeenCalledTimes(1);
      expect(host.querySelector("a")?.getAttribute("href")).toMatch(/^\//);
    } finally {
      await act(async () => root.unmount());
    }
  },
);
