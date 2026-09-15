import { z } from "zod";
import { proxyGatewayStream } from "@/lib/api/gateway-stream.server";
const Params = z.strictObject({
  buildId: z.uuid(),
  version: z.coerce.number().int().positive().max(2147483647),
  file: z.enum([
    "manifest.json",
    "bootloader.bin",
    "partition-table.bin",
    "albusforge.bin",
    "app.cpp",
    "firmware.zip",
  ]),
});
/** Local same-origin download proxy; production LB routes this path directly to gateway. */
export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ buildId: string; version: string; file: string }> },
): Promise<Response> {
  const parsed = Params.safeParse(await params);
  if (!parsed.success)
    return new Response("Not found", {
      status: 404,
      headers: { "cache-control": "no-store" },
    });
  const { buildId, version, file } = parsed.data;
  const response = await proxyGatewayStream(
    `/v1/builds/${buildId}/code/${version}/files/${file}`,
    request,
    "application/octet-stream",
  );
  if (response.ok)
    response.headers.set(
      "content-disposition",
      `attachment; filename="${file}"`,
    );
  return response;
}
