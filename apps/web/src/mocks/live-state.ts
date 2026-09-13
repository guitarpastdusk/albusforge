import type { ReadingEvent } from "@albusforge/schema";

// Shared across Next's route/page module graphs. Local synthetic state only;
// writers are restricted to the three fixture walkers, so this stays bounded.
const shared = globalThis as typeof globalThis & { __albusforgeLiveReadings?: Map<string, ReadingEvent> };
export const liveReadings = shared.__albusforgeLiveReadings ??= new Map<string, ReadingEvent>();
