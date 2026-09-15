import {
  TelemetryMetadata,
  type TelemetryMetadataRequest,
} from "@albusforge/schema";
import type { Pool } from "pg";
import type { z } from "zod";
import { HttpError } from "./http";
import { withAuthorizedWrite } from "./authorized-write";

/** Presentation updates serialize with session revocation and role changes, never with raw history layouts. */
export async function updateDeviceMetadata(
  pool: Pool,
  cookie: string | undefined,
  host: string,
  id: string,
  body: z.infer<typeof TelemetryMetadataRequest>,
) {
  return withAuthorizedWrite(
    pool,
    cookie,
    host,
    undefined,
    async (client, { tenantId, recheckExpiry: checkExpiry }) => {
      // A version mismatch never overwrites another person's concurrent edit.
      const updated = (
        await client.query<{
          device_id: string;
          display_name: string | null;
          version: number;
        }>(
          `UPDATE telemetry.devices SET display_name=$3,metadata_version=metadata_version+1
      WHERE tenant_id=$1 AND id=$2 AND metadata_version=$4
      RETURNING id AS device_id,display_name,metadata_version AS version`,
          [tenantId, id, body.display_name, body.expected_version],
        )
      ).rows[0];
      // Recheck statement time after a possible concurrent device lock wait.
      await checkExpiry();
      if (!updated) {
        const exists = await client.query(
          "SELECT 1 FROM telemetry.devices WHERE tenant_id=$1 AND id=$2",
          [tenantId, id],
        );
        if (!exists.rowCount)
          throw new HttpError(404, "NOT_FOUND", "Device not found");
        throw new HttpError(
          409,
          "METADATA_CONFLICT",
          "Device name changed; refresh before editing again",
        );
      }
      return TelemetryMetadata.parse(updated);
    },
  );
}
