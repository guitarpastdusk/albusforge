import { BoxGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Texture, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import { applyView, disposeObject, dollyBy, findEnclosureObjects, orbitBy } from "./scene";

const objects = () => {
  const root = new Group();
  const base = Object.assign(new Group(), { name: "base" });
  const lid = Object.assign(new Group(), { name: "lid" });
  const parts = Object.assign(new Group(), { name: "parts" });
  root.add(base, lid, parts);
  return { root, found: findEnclosureObjects(root) };
};

describe("applyView", () => {
  const REST = 0;
  const LIFT = 0.0245;

  it("Base shows the base alone; parts only when asked", () => {
    const { found } = objects();
    applyView(found, "base", false, REST, LIFT);
    expect([found.base.visible, found.lid.visible, found.parts!.visible]).toEqual([true, false, false]);
    applyView(found, "base", true, REST, LIFT);
    expect(found.parts!.visible).toBe(true);
  });

  it("Lid shows the lid alone, at rest, never the parts", () => {
    const { found } = objects();
    applyView(found, "lid", true, REST, LIFT);
    expect([found.base.visible, found.lid.visible, found.parts!.visible]).toEqual([false, true, false]);
    expect(found.lid.position.y).toBe(REST);
  });

  it("Exploded shows both, the lid lifted by the gap, and returns to rest when leaving", () => {
    const { found } = objects();
    applyView(found, "exploded", true, REST, LIFT);
    expect([found.base.visible, found.lid.visible, found.parts!.visible]).toEqual([true, true, true]);
    expect(found.lid.position.y).toBeCloseTo(LIFT);
    applyView(found, "base", false, REST, LIFT);
    expect(found.lid.position.y).toBe(REST);
  });

  it("a model without base or lid is rejected; parts are optional", () => {
    const root = new Group().add(Object.assign(new Group(), { name: "base" }));
    expect(() => findEnclosureObjects(root)).toThrow(/base and lid/);
    const ok = new Group().add(Object.assign(new Group(), { name: "base" }), Object.assign(new Group(), { name: "lid" }));
    expect(findEnclosureObjects(ok).parts).toBeNull();
  });
});

describe("keyboard orbit and zoom", () => {
  it("orbitBy rotates around the target at the same distance", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(0.2, 0.1, 0.2);
    const target = new Vector3(0, 0.02, 0);
    const before = camera.position.clone();
    const distance = before.distanceTo(target);
    orbitBy(camera, target, Math.PI / 24, 0);
    expect(camera.position.distanceTo(target)).toBeCloseTo(distance, 10);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0.01);
    expect(camera.position.y).toBeCloseTo(before.y, 10);
  });

  it("orbitBy keeps the camera off the poles", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 0.3);
    orbitBy(camera, new Vector3(), 0, -10);
    const offset = camera.position.clone();
    expect(offset.y).toBeLessThan(0.3);
    expect(Math.hypot(offset.x, offset.z)).toBeGreaterThan(0);
  });

  it("dollyBy zooms within the limits", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(0, 0, 1);
    const target = new Vector3();
    dollyBy(camera, target, 0.5, 0.8, 2);
    expect(camera.position.length()).toBeCloseTo(0.8);
    dollyBy(camera, target, 10, 0.8, 2);
    expect(camera.position.length()).toBeCloseTo(2);
  });
});

describe("disposeObject", () => {
  it("disposes each shared geometry, material and texture once, and closes the bitmap behind a texture", () => {
    const bitmap = { close: vi.fn() };
    const texture = new Texture(bitmap as never);
    const normal = new Texture();
    const geometry = new BoxGeometry();
    const shared = new MeshStandardMaterial({ map: texture, normalMap: normal });
    const other = new MeshStandardMaterial({ map: texture });
    const root = new Group().add(new Mesh(geometry, shared), new Mesh(geometry, [shared, other]));

    const spies = {
      geometry: vi.spyOn(geometry, "dispose"),
      shared: vi.spyOn(shared, "dispose"),
      other: vi.spyOn(other, "dispose"),
      texture: vi.spyOn(texture, "dispose"),
      normal: vi.spyOn(normal, "dispose"),
    };
    disposeObject(root);

    for (const spy of Object.values(spies)) expect(spy).toHaveBeenCalledTimes(1);
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
});
