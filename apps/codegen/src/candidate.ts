import { BuildPlanMetadata, BuildPlanV1, type Spec } from "@albusforge/schema";
export const CANDIDATE = "esp32s3-bh1750-usb-v1";
export const CHANNELS = { illuminance: { unit: "lux", min: 0, max: 65535 } };
export const COMPILER_IMAGE =
  "espressif/idf@sha256:8ccd4d2ce413889c6c2bba57e986c670302094efb91c913c6091152e317a7805";
const pins = (values: readonly { id: string; version: string }[]) =>
  values
    .map((p) => `${p.id}@${p.version}`)
    .sort()
    .join("|");
/** Only the precise implemented runtime/driver/wiring tuple may reach the compiler. */
export function candidateInterval(
  planInput: unknown,
  metadataInput: unknown,
  spec: Spec,
): number {
  const plan = BuildPlanV1.parse(planInput),
    metadata = BuildPlanMetadata.parse(metadataInput);
  const expected = "C-001@1.0.0|E-005@1.0.0|V-005@1.0.0";
  const peripheral = plan.wiring_graph.peripherals[0];
  const interval = spec.sense?.interval_s;
  if (
    plan.runtime !== "0.1.0" ||
    metadata.runtime !== plan.runtime ||
    plan.profile.id !== CANDIDATE ||
    plan.profile.version !== "1.0.0" ||
    metadata.profile.id !== plan.profile.id ||
    metadata.profile.version !== plan.profile.version ||
    metadata.evidence.profile.id !== plan.profile.id ||
    metadata.evidence.profile.version !== plan.profile.version ||
    pins(plan.part_versions) !== expected ||
    pins(metadata.evidence.parts) !== expected ||
    metadata.evidence.parts.some((p) => p.status !== "active") ||
    plan.wiring_graph.brain.id !== "C-001" ||
    plan.wiring_graph.brain.version !== "1.0.0" ||
    plan.wiring_graph.source.id !== "E-005" ||
    plan.wiring_graph.source.version !== "1.0.0" ||
    plan.wiring_graph.peripherals.length !== 1 ||
    peripheral?.part.id !== "V-005" ||
    peripheral.part.version !== "1.0.0" ||
    metadata.evidence.profile.brain.id !== "C-001" ||
    metadata.evidence.profile.brain.version !== "1.0.0" ||
    metadata.evidence.profile.source.id !== "E-005" ||
    metadata.evidence.profile.source.version !== "1.0.0" ||
    !metadata.evidence.profile.ports.some(
      (port) =>
        port.id === peripheral.port &&
        port.interface === "i2c" &&
        port.rail === "brain" &&
        port.resources.join(",") === "GPIO8,GPIO9" &&
        port.connector === peripheral.connector,
    ) ||
    peripheral.resources.join(",") !== "GPIO8,GPIO9" ||
    peripheral.rail !== "brain" ||
    !metadata.evidence.compat.some(
      (c) =>
        c.brain_id === "C-001" &&
        c.driver_pkg === "hsx-driver-bh1750" &&
        c.driver_ver === "0.1.0" &&
        c.runtime_ver === "0.1.0" &&
        c.status === "passed",
    ) ||
    spec.connect?.transport !== "wifi" ||
    spec.power?.source !== "usb" ||
    !Number.isInteger(interval) ||
    interval! < 10 ||
    interval! > 86400
  )
    throw new Error(
      "This accepted plan has no supported firmware compiler profile",
    );
  return interval!;
}
/** Bounded editable app layer. No arbitrary source, headers, paths or shell fragments. */
export function renderApp(interval: number): string {
  if (!Number.isInteger(interval) || interval < 10 || interval > 86400)
    throw new Error("Unsupported sample interval");
  return `#include "hsx-sdk.h"\nextern "C" void app_main(void) { hsx_run(${interval}); }\n`;
}
export function editInterval(instruction: string): number {
  const match =
    /^set (?:sample |upload )?interval to ([0-9]{1,5}) seconds$/i.exec(
      instruction.trim(),
    );
  if (!match)
    throw new Error(
      "Supported edit: Set interval to 60 seconds (10–86400 seconds)",
    );
  const value = Number(match[1]);
  renderApp(value);
  return value;
}
