import type { PartDefinition } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { buildCatalogue, renderCatalogue } from "../scripts/catalogue";
import { loadParts } from "../scripts/lib/load";

const parts = loadParts();

describe("buildCatalogue", () => {
  it("matches the snapshot for the committed registry", async () => {
    // Every MVP part is a draft today, so include drafts to snapshot real content.
    const catalogue = buildCatalogue(parts, { statuses: ["active", "draft"] });
    await expect(renderCatalogue(catalogue)).toMatchFileSnapshot("__snapshots__/catalogue.txt");
    await expect(`${JSON.stringify(catalogue, null, 2)}\n`).toMatchFileSnapshot("__snapshots__/catalogue.json");
  });

  it("is byte-identical whatever order the parts arrive in", () => {
    const statuses = ["active", "draft"] as const;
    const reference = renderCatalogue(buildCatalogue(parts, { statuses }));
    const shuffled = [...parts].sort(() => Math.random() - 0.5);
    expect(renderCatalogue(buildCatalogue([...parts].reverse(), { statuses }))).toBe(reference);
    expect(renderCatalogue(buildCatalogue(shuffled, { statuses }))).toBe(reference);
  });

  it("offers active parts only by default", () => {
    expect(buildCatalogue(parts).parts).toEqual([]);
  });

  it("uses the newest included version and leaves deprecated parts out", () => {
    const base = parts.find((p) => p.id === "P-002")!;
    const version = (v: string, status: PartDefinition["status"], successor: string | null = null): PartDefinition => ({
      ...structuredClone(base),
      version: v,
      status,
      successor,
    });
    const other = { ...structuredClone(parts.find((p) => p.id === "P-001")!), status: "deprecated" as const, successor: "P-002" };

    const catalogue = buildCatalogue([version("1.10.0", "active"), version("2.0.0", "draft"), version("1.9.0", "active"), other]);
    expect(catalogue.parts.map((p) => `${p.id}@${p.version}`)).toEqual(["P-002@1.10.0"]);
    expect(catalogue.capabilities).toEqual([{ capability: "read.temperature_c", unit: "°C", parts: ["P-002"] }]);
  });
});
