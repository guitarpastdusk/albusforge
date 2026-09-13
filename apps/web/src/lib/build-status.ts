import type { Accent, DisplayStatus } from "@albusforge/schema";

/** How each display status looks on a project card, and where its action goes. */
export const buildStatus: Record<DisplayStatus, { label: string; accent: Accent; action: string }> = {
  live: { label: "Live", accent: "green", action: "Open dashboard" },
  kit_shipped: { label: "Kit shipped", accent: "blue", action: "Track kit" },
  designing: { label: "Designing", accent: "peach", action: "Resume chat" },
  parts_picked: { label: "Parts picked", accent: "violet", action: "Review parts" },
};
