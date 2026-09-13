"use client";

import { useEffect, useRef } from "react";
import type { EnclosureView } from "./modes";
import { createEnclosureScene, type EnclosureScene } from "./scene";

export interface EnclosureCanvasProps {
  glbUrl: string;
  view: EnclosureView;
  showParts: boolean;
  /** Incremented by Reset view. */
  resetToken: number;
  autoRotate: boolean;
  label: string;
  describedBy: string;
  onReady: () => void;
  onError: (error: unknown) => void;
}

/**
 * The 3D stage. The only component that imports three.js (through ./scene), so
 * it is loaded with next/dynamic from EnclosurePreview and never server-rendered.
 * Focusable: arrow keys orbit, + and − zoom; pointer and touch go to OrbitControls.
 */
export default function EnclosureCanvas({ glbUrl, view, showParts, resetToken, autoRotate, label, describedBy, onReady, onError }: EnclosureCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<EnclosureScene | null>(null);
  const latest = useRef({ view, showParts, onReady, onError });

  useEffect(() => {
    latest.current = { view, showParts, onReady, onError };
  });

  useEffect(() => {
    sceneRef.current?.setView(view);
  }, [view]);

  useEffect(() => {
    sceneRef.current?.setShowParts(showParts);
  }, [showParts]);

  useEffect(() => {
    if (resetToken > 0) sceneRef.current?.resetView();
  }, [resetToken]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let created: EnclosureScene | null = null;
    createEnclosureScene(host, glbUrl, { autoRotate }).then(
      (scene) => {
        if (disposed) return scene.dispose();
        created = scene;
        sceneRef.current = scene;
        scene.setView(latest.current.view);
        scene.setShowParts(latest.current.showParts);
        latest.current.onReady();
      },
      (error: unknown) => {
        if (!disposed) latest.current.onError(error);
      },
    );
    return () => {
      disposed = true;
      created?.dispose();
      sceneRef.current = null;
    };
  }, [glbUrl, autoRotate]);

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      role="application"
      aria-roledescription="3D viewer"
      aria-label={label}
      aria-describedby={describedBy}
      className="absolute inset-0 cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-coral focus-visible:ring-inset active:cursor-grabbing"
    />
  );
}
