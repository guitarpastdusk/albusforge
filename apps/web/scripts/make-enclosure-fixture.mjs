#!/usr/bin/env node
/*
 * Generates the enclosure viewer's fixture model: public/enclosure/fixture.glb.
 *
 *   cd apps/web && node scripts/make-enclosure-fixture.mjs [--out <file>]
 *
 * A rounded sensor enclosure, 90 × 60 × 35 mm with 1.6 mm walls, in metres
 * (glTF units). Nodes, as the viewer expects (docs/ASK-TO-ENCLOSURE.md §6):
 *   base   floor with a cable hole, and the walls
 *   lid    top plate with five vent slots, and a locating lip
 *   parts  ghost boxes: board, battery, probe_connector
 * Geometry comes from three.js; @gltf-transform/core writes the GLB. The
 * output is deterministic, so regenerating it produces the same bytes.
 */
import { Document, NodeIO } from "@gltf-transform/core";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(APP, "public/enclosure/fixture.glb");

// Millimetres.
const W = 90;
const D = 60;
const H = 35;
const WALL = 1.6;
const R = 6;
const FLOOR = 1.6;
const LID = 1.6;
const LIP_HEIGHT = 3;
const LIP_WALL = 1.2;
const CLEARANCE = 0.4;
const BASE_HEIGHT = H - LID;
const MM = 0.001;
const CURVE_SEGMENTS = 4;

/** A rounded rectangle centred on (cx, cy), added to a Shape or Path. */
function roundedRect(target, cx, cy, w, d, r) {
  const x = cx - w / 2;
  const y = cy - d / 2;
  target.moveTo(x + r, y);
  target.lineTo(x + w - r, y);
  target.absarc(x + w - r, y + r, r, -Math.PI / 2, 0, false);
  target.lineTo(x + w, y + d - r);
  target.absarc(x + w - r, y + d - r, r, 0, Math.PI / 2, false);
  target.lineTo(x + r, y + d);
  target.absarc(x + r, y + d - r, r, Math.PI / 2, Math.PI, false);
  target.lineTo(x, y + r);
  target.absarc(x + r, y + r, r, Math.PI, Math.PI * 1.5, false);
  return target;
}

/** Extrude a shape upward (+Y) from `bottom` by `height`. Shape x → x, shape y → −z. */
function extrudeUp(shape, height, bottom) {
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: CURVE_SEGMENTS });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, bottom, 0);
  return geometry;
}

/** Position and normal only, welded and scaled to metres. */
function finish(...geometries) {
  const cleaned = geometries.map((g) => {
    const copy = new THREE.BufferGeometry();
    copy.setAttribute("position", g.getAttribute("position"));
    copy.setAttribute("normal", g.getAttribute("normal"));
    return g.index ? copy.setIndex(g.index) : copy;
  });
  const merged = mergeVertices(mergeGeometries(cleaned.map((g) => (g.index ? g.toNonIndexed() : g))), 1e-4);
  merged.scale(MM, MM, MM);
  return merged;
}

function baseGeometry() {
  const floor = roundedRect(new THREE.Shape(), 0, 0, W, D, R);
  // Cable hole under the probe connector (shape y −16 → z +16).
  floor.holes.push(new THREE.Path().absarc(30, -16, 3.5, 0, Math.PI * 2, true));
  const walls = roundedRect(new THREE.Shape(), 0, 0, W, D, R);
  walls.holes.push(roundedRect(new THREE.Path(), 0, 0, W - 2 * WALL, D - 2 * WALL, R - WALL));
  return finish(extrudeUp(floor, FLOOR, 0), extrudeUp(walls, BASE_HEIGHT - FLOOR, FLOOR));
}

function lidGeometry() {
  const plate = roundedRect(new THREE.Shape(), 0, 0, W, D, R);
  for (const cy of [-12, -6, 0, 6, 12]) plate.holes.push(roundedRect(new THREE.Path(), 14, cy, 30, 2.4, 1.2));
  const lipW = W - 2 * WALL - 2 * CLEARANCE;
  const lipD = D - 2 * WALL - 2 * CLEARANCE;
  const lipR = R - WALL - CLEARANCE;
  const lip = roundedRect(new THREE.Shape(), 0, 0, lipW, lipD, lipR);
  lip.holes.push(roundedRect(new THREE.Path(), 0, 0, lipW - 2 * LIP_WALL, lipD - 2 * LIP_WALL, lipR - LIP_WALL));
  return finish(extrudeUp(plate, LID, BASE_HEIGHT), extrudeUp(lip, LIP_HEIGHT, BASE_HEIGHT - LIP_HEIGHT));
}

/** A ghost box: size and centre in millimetres (x, y, z). */
function box([sx, sy, sz], [cx, cy, cz]) {
  const geometry = new THREE.BoxGeometry(sx, sy, sz);
  geometry.translate(cx, cy, cz);
  return finish(geometry);
}

const PARTS = [
  { name: "board", size: [48, 12, 28], center: [-17, FLOOR + 4 + 6, 0], color: [0.91, 0.47, 0.29, 0.45] },
  { name: "battery", size: [30, 9, 22], center: [27, FLOOR + 4.5, -12], color: [0.36, 0.55, 0.82, 0.45] },
  { name: "probe_connector", size: [12, 8, 10], center: [30, FLOOR + 4, 16], color: [0.91, 0.47, 0.29, 0.45] },
];

const doc = new Document();
const buffer = doc.createBuffer();

function material(name, [r, g, b, a], translucent = false) {
  const m = doc.createMaterial(name).setBaseColorFactor([r, g, b, a]).setRoughnessFactor(0.72).setMetallicFactor(0);
  return translucent ? m.setAlphaMode("BLEND").setDoubleSided(true) : m;
}

function meshNode(name, geometry, mat) {
  const position = doc.createAccessor().setType("VEC3").setArray(new Float32Array(geometry.getAttribute("position").array)).setBuffer(buffer);
  const normal = doc.createAccessor().setType("VEC3").setArray(new Float32Array(geometry.getAttribute("normal").array)).setBuffer(buffer);
  const indexArray = geometry.index.array;
  const indices = doc
    .createAccessor()
    .setType("SCALAR")
    .setArray(indexArray.length > 0 && Math.max(...indexArray) < 65536 ? new Uint16Array(indexArray) : new Uint32Array(indexArray))
    .setBuffer(buffer);
  const primitive = doc.createPrimitive().setAttribute("POSITION", position).setAttribute("NORMAL", normal).setIndices(indices).setMaterial(mat);
  return doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(primitive));
}

const base = meshNode("base", baseGeometry(), material("pla-base", [0.86, 0.83, 0.79, 1]));
const lid = meshNode("lid", lidGeometry(), material("pla-lid", [0.95, 0.78, 0.68, 1]));
const parts = doc.createNode("parts");
for (const part of PARTS) parts.addChild(meshNode(part.name, box(part.size, part.center), material(`ghost-${part.name}`, part.color, true)));

doc.createScene("enclosure").addChild(base).addChild(lid).addChild(parts);
doc.getRoot().setDefaultScene(doc.getRoot().listScenes()[0]);
doc.getRoot().getAsset().generator = "albusforge make-enclosure-fixture";

const glb = await new NodeIO().writeBinary(doc);
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, glb);
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${(glb.byteLength / 1024).toFixed(1)} KB)`);
