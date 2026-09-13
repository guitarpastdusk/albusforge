// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceCarousel, type CarouselCard } from "./DeviceCarousel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const card = (id: string, name: string): CarouselCard => ({
  id,
  name,
  accent: "green",
  reading: "31% soil",
  chain: ["probe", "ESP32-S3", "Wi-Fi"],
  caption: "caption",
  age: "5s ago",
});
const CARDS = [card("a", "Alpha"), card("b", "Bravo"), card("c", "Charlie"), card("d", "Delta")];

let container: HTMLDivElement;
let root: Root;

const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const current = () => container.querySelector("button[aria-current='true']")?.getAttribute("aria-label");
const track = () => container.querySelector<HTMLElement>("[style*='translateX']")!;

beforeEach(async () => {
  // Reduced motion: no auto-advance timer, so the index only moves on user input.
  vi.spyOn(window, "matchMedia").mockImplementation((() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })) as never);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("DeviceCarousel with example builds", () => {
  beforeEach(async () => {
    await act(async () => root.render(<DeviceCarousel cards={CARDS} examples />));
  });

  it("says they're examples, drops the live heading, and links each card to its build", () => {
    expect(container.querySelector("h2")!.textContent).toBe("Example builds — real designs, sample readings");
    const links = [...container.querySelectorAll<HTMLAnchorElement>("a[href^='/marketplace/']")];
    // Four cards plus three duplicates that pad the track.
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["a", "b", "c", "d", "a", "b", "c"].map((id) => `/marketplace/${id}`));
    expect(links.slice(0, 4).map((a) => a.getAttribute("aria-label"))).toEqual(["Alpha", "Bravo", "Charlie", "Delta"].map((n) => `${n}: see the build`));
  });

  it("duplicates are hidden from assistive tech and can't take focus", () => {
    const duplicates = [...container.querySelectorAll<HTMLAnchorElement>("a[href^='/marketplace/']")].slice(4);
    for (const a of duplicates) {
      expect(a.getAttribute("aria-hidden")).toBe("true");
      expect(a.getAttribute("tabindex")).toBe("-1");
    }
  });

  it("focusing a card that has scrolled off to the side brings it back into view", async () => {
    await act(async () => button("Next device").click());
    await act(async () => button("Next device").click());
    expect(current()).toBe("Show Charlie");
    expect(track().style.transform).toBe("translateX(-720px)");

    // Tab lands on the first card, now off to the left.
    const first = container.querySelector<HTMLAnchorElement>("a[href='/marketplace/a']")!;
    await act(async () => first.focus());
    expect(current()).toBe("Show Alpha");
    expect(track().style.transform).toBe("translateX(-0px)");
  });

  it("wraps from the last card back to the first, and focus still reveals the focused card", async () => {
    await act(async () => button("Previous device").click());
    expect(current()).toBe("Show Delta");

    const second = container.querySelector<HTMLAnchorElement>("a[href='/marketplace/b']")!;
    await act(async () => second.focus());
    expect(current()).toBe("Show Bravo");
    expect(track().style.transform).toBe("translateX(-360px)");
  });
});

describe("DeviceCarousel with live cards", () => {
  it("keeps the live heading and plain cards, with no links", async () => {
    await act(async () => root.render(<DeviceCarousel cards={CARDS} />));
    expect(container.querySelector("h2")!.textContent).toBe("Live right now — built by people like you");
    expect(container.querySelectorAll("a").length).toBe(0);
  });
});
