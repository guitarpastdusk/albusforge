import { ImageObservationPage, type TelemetryDeviceDetail } from "@albusforge/schema";
import Link from "next/link";
import { PrivateObservationImage } from "./PrivateObservationImage";
import { apiGet } from "@/lib/api/server";
import { ApiRequestError, isNotImplemented } from "@/lib/api/core";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import type { Search } from "@/lib/telemetry-monitor";

export async function ObservationGallery({ deviceId, capabilities, search }: {
  deviceId: string; capabilities: NonNullable<z.infer<typeof TelemetryDeviceDetail>["capabilities"]>; search: Search;
}) {
  const cameras = capabilities.filter(c => c.kind === "image");
  if (!cameras.length) return null;
  const selected = cameras.find(c => c.id === search.camera) ?? cameras[0]!;
  const cursor = typeof search.image_cursor === "string" && search.camera === selected.id ? search.image_cursor : undefined;
  const query = new URLSearchParams({ limit: "24", ...(cursor ? { cursor } : {}) });
  let page: z.infer<typeof ImageObservationPage> | undefined;
  let error: string | undefined;
  /** Gateway's 501: observation reads aren't switched on in this environment yet. Not a fault. */
  let notEnabled = false;
  try { page = await apiGet(`/v1/devices/${deviceId}/capabilities/${encodeURIComponent(selected.id)}/images?${query}`, ImageObservationPage); }
  catch (failure) {
    unstable_rethrow(failure);
    if (isNotImplemented(failure)) notEnabled = true;
    else if (failure instanceof ApiRequestError && [401,403].includes(failure.status)) error = "Your workspace access changed. Refresh this page to sign in again.";
    else if (failure instanceof ApiRequestError && failure.status === 400) error = "This history link is no longer valid. Select the camera to return to its latest pictures.";
    else error = "Pictures are temporarily unavailable. Refresh to try again.";
  }
  return <section className="mt-8" aria-labelledby="camera-title">
    <h2 id="camera-title" className="text-xl font-semibold">Camera pictures</h2>
    <nav className="my-4 flex flex-wrap gap-3" aria-label="Cameras">{cameras.map(camera => <Link key={camera.id} href={`/live/${deviceId}?camera=${encodeURIComponent(camera.id)}`}
      aria-current={camera.id === selected.id ? "page" : undefined} className="rounded-full border px-4 py-2">
      {camera.id} · {camera.status.replaceAll("_", " ")}
    </Link>)}</nav>
    <p className="text-sm text-muted">Capture interval: {selected.interval_s / 60} minutes. Last received: {selected.last_received_at ?? "Waiting for the first picture"}.</p>
    <p className="mt-2 text-sm text-muted">Pictures are kept for 30 days from capture. Refresh to see new uploads.</p>
    {notEnabled && <p className="mt-4 text-muted">Picture history isn&apos;t switched on for this workspace yet. The camera keeps capturing on its interval, and pictures appear here once it is.</p>}
    {error && <p role="alert" className="mt-4">{error}</p>}
    {page && page.images.length === 0 && <p className="mt-5">No retained pictures yet. Check power, Wi-Fi, the SD card, and device setup.</p>}
    <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">{page?.images.map(image => <figure key={image.observation_id} className="overflow-hidden rounded-2xl border border-current/10 p-3">
      <PrivateObservationImage src={`/v1/devices/${deviceId}/capabilities/${encodeURIComponent(selected.id)}/images/${image.observation_id}/content`} alt={`${selected.id} capture at ${image.captured_at}`}
        width={image.width} height={image.height} />
      <figcaption className="mt-3 break-words text-xs text-muted">Captured {image.captured_at}<br />Received {image.received_at}</figcaption>
    </figure>)}</div>
    {page?.next_cursor && <Link className="mt-5 inline-block underline" href={`/live/${deviceId}?camera=${encodeURIComponent(selected.id)}&image_cursor=${encodeURIComponent(page.next_cursor)}`}>Older pictures →</Link>}
  </section>;
}
