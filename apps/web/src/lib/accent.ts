import type { Accent } from "@albusforge/schema";

/** Full class names, spelled out so Tailwind can see them. */
export const accentClasses: Record<Accent, { bg: string; fg: string }> = {
  peach: { bg: "bg-pastel-peach", fg: "text-pastel-peach-fg" },
  blue: { bg: "bg-pastel-blue", fg: "text-pastel-blue-fg" },
  green: { bg: "bg-pastel-green", fg: "text-pastel-green-fg" },
  violet: { bg: "bg-pastel-violet", fg: "text-pastel-violet-fg" },
};
