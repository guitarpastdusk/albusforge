import { describe, expect, it } from "vitest";
import { latestPerId } from "./parts";

describe("latestPerId", () => {
  it("keeps the highest SemVer version of each id, sorted by id", () => {
    const rows = [
      { id: "P-002", version: "1.0.0" },
      { id: "P-001", version: "1.9.0" },
      { id: "P-001", version: "1.10.0" },
      { id: "P-001", version: "1.10.0-rc.1" },
      { id: "C-001", version: "0.1.0" },
    ];
    expect(latestPerId(rows)).toEqual([
      { id: "C-001", version: "0.1.0" },
      // 1.10.0 beats 1.9.0 (numeric, not string order) and its own pre-release.
      { id: "P-001", version: "1.10.0" },
      { id: "P-002", version: "1.0.0" },
    ]);
  });

  it("picks a pre-release over an older release", () => {
    expect(latestPerId([{ id: "E-005", version: "1.0.0" }, { id: "E-005", version: "1.0.1-rc.1" }])).toEqual([
      { id: "E-005", version: "1.0.1-rc.1" },
    ]);
  });

  it("returns nothing for no rows", () => {
    expect(latestPerId([])).toEqual([]);
  });
});
