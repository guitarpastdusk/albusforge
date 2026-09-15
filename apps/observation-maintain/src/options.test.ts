import type { Pool } from "pg";
import { MemoryObservationStorage } from "@albusforge/storage/testing";
import { expect, it, vi } from "vitest";
import { maintainObservations } from "./maintain.js";
it.each([
  { maxDailyCount: 0 }, { maxDailyCount: 10001 }, { maxDailyCount: 1.5 }, { maxDailyCount: NaN },
  { maxDailyBytes: 0 }, { maxDailyBytes: 1073741825 }, { maxDailyBytes: 1.5 }, { maxDailyBytes: Infinity },
])("rejects invalid recovery quota before obtaining a database connection: %j", async options => {
  const connect = vi.fn();
  await expect(maintainObservations({ connect } as unknown as Pool, new MemoryObservationStorage(), options)).rejects.toThrow("Invalid daily");
  expect(connect).not.toHaveBeenCalled();
});
