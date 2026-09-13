/*
 * The viewer's choices that don't need three.js, so the page bundle can make
 * them before (or instead of) loading the 3D chunk.
 */

export const ENCLOSURE_VIEWS = [
  { id: "base", label: "Base" },
  { id: "lid", label: "Lid" },
  { id: "exploded", label: "Exploded" },
] as const;

export type EnclosureView = (typeof ENCLOSURE_VIEWS)[number]["id"];

const webglSupport = new WeakMap<Document, boolean>();

/** Whether the browser can create a WebGL context. Checked once per document; the probe context is released. */
export function supportsWebGL(doc: Document = document): boolean {
  const known = webglSupport.get(doc);
  if (known !== undefined) return known;
  let supported = false;
  try {
    const canvas = doc.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ?? canvas.getContext("webgl")) as WebGLRenderingContext | null;
    supported = Boolean(gl);
    gl?.getExtension?.("WEBGL_lose_context")?.loseContext();
  } catch {
    supported = false;
  }
  webglSupport.set(doc, supported);
  return supported;
}

/** Tests only: forget the cached answer. */
export function resetWebGLSupportCache(doc: Document = document): void {
  webglSupport.delete(doc);
}

export type PreviewMode = "interactive" | "static";

/**
 * The static image replaces the 3D view without WebGL, and when auto-rotate is
 * requested but the visitor prefers reduced motion. Auto-rotate is off unless
 * asked for, so reduced motion alone keeps the interactive view.
 */
export function previewMode({ webgl, reducedMotion, autoRotate }: { webgl: boolean; reducedMotion: boolean; autoRotate: boolean }): PreviewMode {
  if (!webgl) return "static";
  if (autoRotate && reducedMotion) return "static";
  return "interactive";
}
