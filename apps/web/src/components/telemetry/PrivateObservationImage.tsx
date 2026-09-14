"use client";
import { useState } from "react";

/** The browser sends its session cookie to the authorized content route. Never
 * route private pictures through Next's shared image optimization cache. */
export function PrivateObservationImage({ src, alt, width, height }: { src: string; alt: string; width: number; height: number }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (failedSource === src) return <p role="status" className="rounded-lg bg-porcelain p-5 text-sm">Picture expired or unavailable. Refresh this page to check for retained pictures.</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={width} height={height} loading="lazy" className="h-auto w-full rounded-lg" onError={() => setFailedSource(src)} />;
}
