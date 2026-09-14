import Link from "next/link";
import { SampleReadingsTable } from "@/components/marketplace/SampleReadingsTable";
import { EXAMPLE_BUILDS } from "@/lib/example-builds";
import { exampleReadings } from "@/lib/example-readings";

/** The example build whose readings stand in: the first with a sample table. */
const SAMPLE_BUILD = EXAMPLE_BUILDS.find((build) => build.readings.channels.length > 0);

/**
 * The device page before its first packet: a device with no channels yet has
 * nothing to plot, so the readings, history and sensor chat sections stay
 * hidden. Instead of a header and nothing else, say what will appear, what
 * to check, and show the shape of it with an example build's sample readings,
 * labelled as such (docs/DEMO-ASSUMPTIONS.md).
 */
export function AwaitingReadings({ deviceId, revoked }: { deviceId: string; revoked: boolean }) {
  const sample = SAMPLE_BUILD ? exampleReadings(SAMPLE_BUILD) : null;
  return (
    <section className="mt-8" aria-labelledby="awaiting-title">
      <h2 id="awaiting-title" className="text-xl font-semibold">
        Waiting for the first reading
      </h2>
      <p className="mt-3 max-w-[640px] text-muted">
        {revoked
          ? "This device's credential is revoked, so nothing new arrives. Stored readings would show here if any had been recorded."
          : "Once this device uploads its first packet, its latest readings, a plottable history for every channel, and a chat that answers questions from the stored data appear here. Refresh after the device has been powered for a minute."}
      </p>
      {!revoked && (
        <ul className="mt-4 list-disc pl-5 text-muted">
          <li>Power and Wi-Fi: the device needs both to upload.</li>
          <li>
            Provisioning:{" "}
            <Link href={`/setup?device=${encodeURIComponent(deviceId)}`} className="text-coral-deep underline">
              check device setup
            </Link>{" "}
            to see whether it has been claimed and configured.
          </li>
          <li>Interval: the first packet arrives after one upload interval, not immediately on power-up.</li>
        </ul>
      )}
      {sample && SAMPLE_BUILD && (
        <div className="mt-8">
          <p className="font-mono text-[13px] uppercase tracking-[0.18em] text-coral-deep">Sample readings</p>
          <p className="mt-2 max-w-[640px] text-muted">
            What this page looks like with data, using the {SAMPLE_BUILD.name.toLowerCase()} example build&apos;s sample
            readings. These are not from this device.
          </p>
          <SampleReadingsTable readings={sample} />
        </div>
      )}
    </section>
  );
}
