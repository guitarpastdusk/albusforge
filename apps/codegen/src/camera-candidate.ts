/** Compilation candidate only. This is deliberately outside the accepted-plan
 * worker allowlist until native physical acceptance and registry evidence land. */
export const CAMERA_CANDIDATE = "freenove-esp32s3-n16r8-gc0308-usb-v1";
export const CAMERA_RUNTIME = "0.2.0";
export const CAMERA_CAPABILITIES = [{ id: "camera", kind: "image" as const, schema: "jpeg.v1" as const,
  profile_id: CAMERA_CANDIDATE, profile_version: 1, enabled: true, required: true,
  interval_s: 900, max_bytes: 1048576, max_width: 320, max_height: 240 }];
export function renderCameraApp(interval: number): string {
  if (interval !== 900) throw new Error("The reviewed camera capture interval is 900 seconds");
  return 'extern "C" void hsx_camera_run(void);\nextern "C" void app_main(void) { hsx_camera_run(); }\n';
}
