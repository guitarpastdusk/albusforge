import { getBounds, NodeIO } from "@gltf-transform/core";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENCLOSURE_FIXTURE } from "./fixture";

const APP = path.resolve(import.meta.dirname, "../../..");
const SCRIPT = path.join(APP, "scripts/make-enclosure-fixture.mjs");
const COMMITTED = path.join(APP, "public", ENCLOSURE_FIXTURE.glbUrl);

async function summarize(file: string) {
  const document = await new NodeIO().read(file);
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0]!;
  const nodes = scene.listChildren();
  const named = (name: string) => nodes.find((node) => node.getName() === name);
  const { min, max } = getBounds(scene);
  return {
    top: nodes.map((node) => node.getName()),
    baseHasMesh: Boolean(named("base")?.getMesh()),
    lidHasMesh: Boolean(named("lid")?.getMesh()),
    parts: named("parts")?.listChildren().map((node) => [node.getName(), Boolean(node.getMesh())]),
    sizeMm: [0, 1, 2].map((axis) => Math.round((max[axis]! - min[axis]!) * 1000 * 10) / 10),
  };
}

describe("enclosure fixture GLB", () => {
  it("has meshes named base and lid, ghost parts under parts, and is about 90 × 35 × 60 mm", async () => {
    const summary = await summarize(COMMITTED);
    expect(summary.top).toEqual(["base", "lid", "parts"]);
    expect(summary.baseHasMesh).toBe(true);
    expect(summary.lidHasMesh).toBe(true);
    expect(summary.parts).toEqual([
      ["board", true],
      ["battery", true],
      ["probe_connector", true],
    ]);
    // x, y (height), z
    expect(summary.sizeMm).toEqual([90, 35, 60]);
  });

  it("stays small", () => {
    expect(statSync(COMMITTED).size).toBeLessThan(200_000);
  });

  it("is reproducible: the checked-in script regenerates the same bytes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "enclosure-fixture-"));
    try {
      const out = path.join(dir, "fixture.glb");
      execFileSync(process.execPath, [SCRIPT, "--out", out], { cwd: APP, stdio: "pipe" });
      expect(readFileSync(out).equals(readFileSync(COMMITTED))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
