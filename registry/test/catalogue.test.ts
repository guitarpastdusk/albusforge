import type { PartDefinition } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { buildCatalogue, renderCatalogue } from "../scripts/catalogue";
import { loadParts } from "../scripts/lib/load";

const parts = loadParts();
const withDrafts = { statuses: ["active", "draft"] as const };

/** P-002 at another version and status, for version-selection tests. */
function probe(version: string, status: PartDefinition["status"] = "active"): PartDefinition {
  return { ...structuredClone(parts.find((p) => p.id === "P-002")!), version, status, successor: null };
}

const versionsIn = (catalogue: ReturnType<typeof buildCatalogue>) => catalogue.parts.map((p) => `${p.id}@${p.version}`);

/** Every rotation of a list, plus its reverse: a fixed set of orders, so a failure reproduces. */
function orderings<T>(xs: readonly T[]): T[][] {
  const rotations = xs.map((_, shift) => [...xs.slice(shift), ...xs.slice(0, shift)]);
  return [...rotations, [...xs].reverse()];
}

describe("buildCatalogue", () => {
  it("matches the snapshot for the committed registry", async () => {
    // Every MVP part is a draft today, so include drafts to snapshot real content.
    const catalogue = buildCatalogue(parts, withDrafts);
    await expect(renderCatalogue(catalogue)).toMatchFileSnapshot("__snapshots__/catalogue.txt");
    await expect(`${JSON.stringify(catalogue, null, 2)}\n`).toMatchFileSnapshot("__snapshots__/catalogue.json");
  });

  it("is byte-identical whatever order the parts arrive in", () => {
    const reference = renderCatalogue(buildCatalogue(parts, withDrafts));
    for (const order of orderings(parts)) {
      expect(renderCatalogue(buildCatalogue(order, withDrafts))).toBe(reference);
    }
  });

  it("offers active parts only by default", () => {
    expect(buildCatalogue(parts).parts).toEqual([]);
  });

  it("lists only energy parts as power options, not the host's regulated rail", () => {
    const options = buildCatalogue(parts, withDrafts).power_options.map((o) => o.id);
    expect(options).toEqual(["E-001", "E-004", "E-005"]);
  });

  it("uses the newest included version and leaves deprecated parts out", () => {
    const deprecated = { ...structuredClone(parts.find((p) => p.id === "P-001")!), status: "deprecated" as const, successor: "P-002" };
    const catalogue = buildCatalogue([probe("1.10.0"), probe("2.0.0", "draft"), probe("1.9.0"), deprecated]);
    expect(versionsIn(catalogue)).toEqual(["P-002@1.10.0"]);
    expect(catalogue.capabilities).toEqual([{ capability: "read.temperature_c", unit: "°C", parts: ["P-002"] }]);
  });

  describe("pre-release versions (SemVer §11)", () => {
    it("picks 1.0.0-rc.10 over 1.0.0-rc.2", () => {
      const [rc2, rc10] = [probe("1.0.0-rc.2"), probe("1.0.0-rc.10")];
      expect(versionsIn(buildCatalogue([rc2, rc10]))).toEqual(["P-002@1.0.0-rc.10"]);
      expect(versionsIn(buildCatalogue([rc10, rc2]))).toEqual(["P-002@1.0.0-rc.10"]);
    });

    it("orders 1.0.0-alpha-a and 1.0.0-alpha-b the same way whatever the input order", () => {
      const [a, b] = [probe("1.0.0-alpha-a"), probe("1.0.0-alpha-b")];
      expect(versionsIn(buildCatalogue([a, b]))).toEqual(["P-002@1.0.0-alpha-b"]);
      expect(versionsIn(buildCatalogue([b, a]))).toEqual(["P-002@1.0.0-alpha-b"]);
    });

    it("prefers the release over any of its pre-releases", () => {
      const candidates = [probe("1.0.0-rc.10"), probe("1.0.0"), probe("1.0.0-alpha-b")];
      for (const order of orderings(candidates)) {
        expect(versionsIn(buildCatalogue(order))).toEqual(["P-002@1.0.0"]);
      }
    });

    it("renders the same catalogue whatever order mixed versions arrive in", () => {
      const others = parts.filter((p) => p.id !== "P-002").map((p) => ({ ...p, status: "active" as const }));
      const mixed = [probe("1.0.0-rc.2"), probe("1.0.0-alpha-a"), ...others, probe("1.0.0-rc.10"), probe("1.0.0-alpha-b")];
      const reference = renderCatalogue(buildCatalogue(mixed));
      expect(reference).toContain("- P-002@1.0.0-rc.10 ");
      for (const order of orderings(mixed)) {
        expect(renderCatalogue(buildCatalogue(order))).toBe(reference);
      }
    });
  });
});
