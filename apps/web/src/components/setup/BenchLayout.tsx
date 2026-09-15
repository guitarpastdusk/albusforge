import { BuildCircuitDiagram } from "@/components/marketplace/BuildCircuitDiagram";
import { BENCH_BOARD, BENCH_BUS, BENCH_FIRMWARE, BENCH_SENSORS, benchWiring } from "@/lib/bench-device";

/**
 * The bench device's layout: the board, what is on its I2C chain and in what
 * state, and the firmware running it.
 *
 * Fixed content for the demo (lib/bench-device.ts), because the running device
 * reports none of it — DeviceSetupStatus carries channels and receipt times,
 * not a board revision, a camera PID or a driver's absence. Labelled as the
 * bench reference so nobody reads it as a description of their own hardware.
 */
export function BenchLayout() {
  const wiring = benchWiring();
  return (
    <div className="rounded-[24px] border border-hairline bg-white p-6">
      <h2 className="font-display text-[26px]">How this device is put together</h2>
      <p className="mt-3 max-w-[760px] rounded-[12px] border border-dashed border-coral-deep/40 bg-porcelain px-4 py-3 text-sm text-coral-deep">
        <span className="font-mono text-[12px] uppercase tracking-[0.16em]">Bench reference</span>
        <br />
        The layout of the device this demo was built on, recorded from its bring-up. It is not read from the device in front
        of you: the setup status reports channels and receipt times, not a board revision or a missing driver.
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <section aria-label="Host board" className="min-w-0">
          <h3 className="text-[16px] font-semibold text-ink">{BENCH_BOARD.name}</h3>
          <p className="mt-1 font-mono text-[13px] text-muted">
            {BENCH_BOARD.partId} · {BENCH_BOARD.supplier}
          </p>
          <dl className="mt-4 space-y-3">
            {BENCH_BOARD.facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-[13px] text-muted">{fact.label}</dt>
                <dd className="text-[15px] text-ink">{fact.value}</dd>
                {fact.note ? <dd className="mt-1 text-[13px] font-light leading-[1.45] text-coral-deep">{fact.note}</dd> : null}
              </div>
            ))}
          </dl>
        </section>

        <section aria-label="I2C chain" className="min-w-0">
          <h3 className="text-[16px] font-semibold text-ink">
            STEMMA QT I²C chain · <span className="font-mono text-[14px]">{BENCH_BUS.sda} SDA / {BENCH_BUS.scl} SCL</span>
          </h3>
          <p className="mt-1 text-[13px] font-light leading-[1.45] text-coral-deep">{BENCH_BUS.note}</p>
          <ul className="mt-4 divide-y divide-hairline border-y border-hairline">
            {BENCH_SENSORS.map((sensor) => (
              <li key={sensor.address} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3">
                <span className="font-mono text-[14px] text-ink">{sensor.address}</span>
                <span className="min-w-0 flex-1 text-[15px] text-ink">{sensor.name}</span>
                <span className="font-mono text-[12px] text-faint">
                  {sensor.partId}
                  {sensor.version ? ` v${sensor.version}` : ""}
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-[12px] ${
                    sensor.state === "uploading" ? "bg-positive text-success" : "border border-dashed border-coral-deep/50 text-coral-deep"
                  }`}
                >
                  {sensor.detail}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {wiring ? <div className="mt-6">{<BuildCircuitDiagram wiring={wiring} buildName="Bench device" />}</div> : null}

      <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 border-t border-hairline pt-5">
        {BENCH_FIRMWARE.facts.map((fact) => (
          <div key={fact.label}>
            <dt className="text-[13px] text-muted">{fact.label}</dt>
            <dd className="font-mono text-[13px] text-ink">{fact.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
