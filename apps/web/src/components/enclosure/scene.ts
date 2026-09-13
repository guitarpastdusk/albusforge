import {
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  type Material,
  Mesh,
  type MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Spherical,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ModelLoadError, RendererUnavailableError, type EnclosureView } from "./modes";

/*
 * The three.js side of the viewer. Imported only by EnclosureCanvas, which is
 * loaded on demand — never by a page bundle (see bundle-isolation.test.ts).
 */

export interface EnclosureObjects {
  base: Object3D;
  lid: Object3D;
  parts: Object3D | null;
}

/** How far the lid rises in the exploded view, as a share of the enclosure's height. */
export const EXPLODE_GAP = 0.7;

export function findEnclosureObjects(root: Object3D): EnclosureObjects {
  const base = root.getObjectByName("base");
  const lid = root.getObjectByName("lid");
  if (!base || !lid) throw new Error("The enclosure model needs nodes named base and lid");
  return { base, lid, parts: root.getObjectByName("parts") ?? null };
}

/** Base: the base alone. Lid: the lid alone. Exploded: both, the lid lifted by `lift`. Parts show with the base. */
export function applyView({ base, lid, parts }: EnclosureObjects, view: EnclosureView, showParts: boolean, lidRestY: number, lift: number): void {
  base.visible = view !== "lid";
  lid.visible = view !== "base";
  lid.position.y = lidRestY + (view === "exploded" ? lift : 0);
  if (parts) parts.visible = showParts && view !== "lid";
}

interface OrbitCamera {
  position: Vector3;
  lookAt(target: Vector3): void;
}

const MIN_POLAR = 0.05;

/** Orbit the camera around `target` (arrow keys), keeping its distance; the polar angle stays off the poles. */
export function orbitBy(camera: OrbitCamera, target: Vector3, dTheta: number, dPhi: number): void {
  const offset = camera.position.clone().sub(target);
  const spherical = new Spherical().setFromVector3(offset);
  spherical.theta += dTheta;
  spherical.phi = Math.min(Math.PI - MIN_POLAR, Math.max(MIN_POLAR, spherical.phi + dPhi));
  offset.setFromSpherical(spherical);
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
}

/** Move the camera toward (factor < 1) or away from `target`, within [min, max]. */
export function dollyBy(camera: OrbitCamera, target: Vector3, factor: number, min: number, max: number): void {
  const offset = camera.position.clone().sub(target);
  offset.setLength(Math.min(max, Math.max(min, offset.length() * factor)));
  camera.position.copy(target).add(offset);
  camera.lookAt(target);
}

/**
 * Release what a loaded model owns: each geometry, material and texture once
 * (they are often shared), and the ImageBitmap or frame behind a texture.
 */
export function disposeObject(root: Object3D): void {
  const geometries = new Set<{ dispose(): void }>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of [object.material].flat() as Material[]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    }
  });
  for (const texture of textures) {
    const data = texture.source?.data as { close?: () => void } | null | undefined;
    texture.dispose();
    if (typeof data?.close === "function") data.close();
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

export interface EnclosureScene {
  setView(view: EnclosureView): void;
  setShowParts(show: boolean): void;
  resetView(): void;
  dispose(): void;
}

const KEY_STEP = Math.PI / 24;
const STAGE_COLOR = "#faf8f5";

/**
 * Start a renderer, load the GLB and mount in `host`.
 * Rejects with RendererUnavailableError when WebGL 2 can't start (before any
 * download), ModelLoadError when the model can't be fetched or parsed, or the
 * signal's reason when aborted. Nothing is left behind on any rejection.
 */
export async function createEnclosureScene(
  host: HTMLElement,
  url: string,
  { autoRotate = false, signal }: { autoRotate?: boolean; signal?: AbortSignal } = {},
): Promise<EnclosureScene> {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch (error) {
    throw new RendererUnavailableError(error);
  }
  const releaseRenderer = () => {
    // dispose() alone leaves the context to garbage collection; repeated opens then hit the browser's context limit.
    renderer.forceContextLoss();
    renderer.dispose();
  };

  let model: Object3D;
  let objects: EnclosureObjects;
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new ModelLoadError(`GET ${url} returned ${response.status}`);
    const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), "");
    model = gltf.scene;
    try {
      objects = findEnclosureObjects(model);
    } catch (error) {
      disposeObject(model);
      throw error;
    }
    if (signal?.aborted) {
      disposeObject(model);
      throw signal.reason;
    }
  } catch (error) {
    releaseRenderer();
    if (signal?.aborted || error instanceof ModelLoadError) throw error;
    throw new ModelLoadError(error instanceof Error ? error.message : String(error), { cause: error });
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(new Color(STAGE_COLOR), 1);
  const canvas = renderer.domElement;
  Object.assign(canvas.style, { display: "block", width: "100%", height: "100%" });
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);

  const scene = new Scene();
  scene.add(new HemisphereLight(0xffffff, 0xd9d2c8, 2));
  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(0.12, 0.2, 0.16);
  const fill = new DirectionalLight(0xffffff, 0.7);
  fill.position.set(-0.14, 0.06, -0.12);
  scene.add(key, fill, model);

  objects.parts?.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of [object.material].flat() as MeshStandardMaterial[]) {
      material.transparent = true;
      material.opacity = Math.min(material.opacity, 0.5);
      material.depthWrite = false;
    }
    object.renderOrder = 1;
  });

  const assembled = new Box3().setFromObject(model);
  const radius = assembled.getSize(new Vector3()).length() / 2;
  const lidRestY = objects.lid.position.y;
  const lift = assembled.getSize(new Vector3()).y * EXPLODE_GAP;

  const camera = new PerspectiveCamera(32, 1, radius / 100, radius * 40);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.autoRotate = autoRotate;
  controls.autoRotateSpeed = 1.2;
  controls.minDistance = radius * 1.2;
  controls.maxDistance = radius * 8;

  let view: EnclosureView = "base";
  let showParts = false;

  const visibleCenter = () => {
    const box = new Box3();
    for (const object of [objects.base, objects.lid, objects.parts]) if (object?.visible) box.expandByObject(object);
    return (box.isEmpty() ? assembled : box).getCenter(new Vector3());
  };
  const home = () => {
    const center = visibleCenter();
    controls.target.copy(center);
    camera.position.set(center.x + radius * 1.9, center.y + radius * 1.35, center.z + radius * 2.3);
    camera.lookAt(center);
    controls.update();
  };
  const recenter = () => {
    const delta = visibleCenter().sub(controls.target);
    controls.target.add(delta);
    camera.position.add(delta);
    controls.update();
  };

  applyView(objects, view, showParts, lidRestY, lift);
  home();

  const resize = () => {
    const width = host.clientWidth || 1;
    const height = host.clientHeight || 1;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  const onKeyDown = (event: KeyboardEvent) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [KEY_STEP, 0],
      ArrowRight: [-KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    };
    const move = moves[event.key];
    if (move) orbitBy(camera, controls.target, move[0], move[1]);
    else if (event.key === "+" || event.key === "=") dollyBy(camera, controls.target, 0.9, controls.minDistance, controls.maxDistance);
    else if (event.key === "-" || event.key === "_") dollyBy(camera, controls.target, 1.1, controls.minDistance, controls.maxDistance);
    else return;
    event.preventDefault();
    controls.update();
  };
  host.addEventListener("keydown", onKeyDown);

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    setView(next) {
      view = next;
      applyView(objects, view, showParts, lidRestY, lift);
      recenter();
    },
    setShowParts(next) {
      showParts = next;
      applyView(objects, view, showParts, lidRestY, lift);
    },
    resetView: home,
    dispose() {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      host.removeEventListener("keydown", onKeyDown);
      controls.dispose();
      disposeObject(model);
      releaseRenderer();
      canvas.remove();
    },
  };
}
