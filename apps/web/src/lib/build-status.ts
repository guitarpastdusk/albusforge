import type { Accent, DisplayStatus } from "@albusforge/schema";

/** How each display status looks on a project card, and where its action goes. */
export const buildStatus: Record<DisplayStatus, { label: string; accent: Accent; action: string }> = {
  live: { label: "Live", accent: "green", action: "Open dashboard" },
  kit_shipped: { label: "Kit shipped", accent: "blue", action: "Track kit" },
  designing: { label: "Designing", accent: "peach", action: "Resume chat" },
  parts_picked: { label: "Parts picked", accent: "violet", action: "Review parts" },
};

/** Where a project card's action goes: live builds to the fleet, designs back to their chat. */
export function buildHref(build: { id: string; display_status: DisplayStatus }): string {
  const id = encodeURIComponent(build.id);
  if (build.display_status === "live") return "/live";
  if (build.display_status === "designing") return `/build/${id}`;
  return `/projects/${id}`;
}
