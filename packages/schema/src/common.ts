import { z } from "zod";

export const Id = z.string().min(1);

/** ISO 8601 with an offset. Every timestamp on the wire is one of these. */
export const Timestamp = z.iso.datetime({ offset: true });

/** Error shape for every non-2xx response (ARCHITECTURE.md §6). */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/**
 * The four pastel surfaces in the design. Assigned once — at publish for a
 * listing, at provisioning for a device — and stored, like a cover colour, so
 * the same thing is the same colour on every screen.
 */
export const Accent = z.enum(["peach", "blue", "green", "violet"]);
export type Accent = z.infer<typeof Accent>;
