/** Compilation candidate only. This is deliberately outside the accepted-plan
 * worker allowlist until native physical acceptance and registry evidence land. */
export const CAMERA_CANDIDATE = "freenove-esp32s3-n16r8-gc0308-usb-v1";
export const CAMERA_RUNTIME = "0.3.0";
export const CAMERA_CHANNELS = {
  ambient_light_lux: { unit: "lux", min: 0, max: 65535 },
  air_temperature_c: { unit: "C", min: -40, max: 85 },
  air_pressure_hpa: { unit: "hPa", min: 300, max: 1100 },
  air_humidity_pct: { unit: "%", min: 0, max: 100 },
} as const;
export const CAMERA_CAPABILITIES = [{ id: "camera", kind: "image" as const, schema: "jpeg.v1" as const,
  profile_id: CAMERA_CANDIDATE, profile_version: 1, enabled: true, required: true,
  interval_s: 900, max_bytes: 1048576, max_width: 320, max_height: 240 }, {
  id: "environment", kind: "measurement" as const, schema: "readings.v1" as const,
  profile_id: CAMERA_CANDIDATE, profile_version: 1, enabled: true, required: true,
  interval_s: 900, channels: CAMERA_CHANNELS }];
export function renderCameraApp(interval: number): string {
  if (interval !== 900) throw new Error("The reviewed camera capture interval is 900 seconds");
  return 'extern "C" void hsx_camera_run(void);\nextern "C" void app_main(void) { hsx_camera_run(); }\n';
}
