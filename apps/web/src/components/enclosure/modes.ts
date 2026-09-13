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

/**
 * Whether the browser can create a WebGL 2 context — what three.js's
 * WebGLRenderer requires (WebGL 1 support ended at r163). A WebGL-1-only
 * browser gets the static image. Checked once per document; the probe
 * context is released.
 */
export function supportsWebGL2(doc: Document = document): boolean {
  const known = webglSupport.get(doc);
  if (known !== undefined) return known;
  let supported = false;
  try {
    const gl = doc.createElement("canvas").getContext("webgl2") as WebGL2RenderingContext | null;
    supported = Boolean(gl);
    gl?.getExtension?.("WEBGL_lose_context")?.loseContext();
  } catch {
    supported = false;
  }
  webglSupport.set(doc, supported);
  return supported;
}

/** The renderer couldn't start (no usable WebGL 2 context). Not retryable: the viewer shows the static image. */
export class RendererUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("WebGL 2 renderer unavailable", { cause });
    this.name = "RendererUnavailableError";
  }
}

/** The model couldn't be downloaded or parsed. Retryable: the viewer shows the error with Try again. */
export class ModelLoadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ModelLoadError";
  }
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
