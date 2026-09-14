import { AssemblyProfile, ConnectorDefinition, SemVer } from "@albusforge/schema";
import { z } from "zod";
import profiles from "../../../registry/assembly-profiles.json";
import threePin from "../../../registry/connectors/hsx-3pin-v1.json";
import gpio from "../../../registry/connectors/hsx-4pin-gpio-v1.json";
import i2c from "../../../registry/connectors/hsx-i2c-4pin-v1.json";
import power from "../../../registry/connectors/hsx-power-2pin-v1.json";
import usbC from "../../../registry/connectors/usb-c-v1.json";
import usbMicro from "../../../registry/connectors/usb-micro-b-v1.json";

/** Source-controlled approval boundary. Empty until reviewed physical profiles/runtime exist. */
export const ReviewedPlanCatalogue = z.strictObject({
  schema_version: z.literal(1), runtime: SemVer.nullable(), profiles: z.array(AssemblyProfile).max(32),
  connectors: z.array(ConnectorDefinition).max(64),
});
export type ReviewedPlanCatalogue = z.infer<typeof ReviewedPlanCatalogue>;
export const productionPlanCatalogue = ReviewedPlanCatalogue.parse({ ...profiles, connectors: [threePin, gpio, i2c, power, usbC, usbMicro] });
