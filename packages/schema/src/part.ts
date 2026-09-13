import { z } from "zod";

/**
 * The Part Definition (ARCHITECTURE.md §4): the one object every service reads
 * (§1.1). Each block has exactly one consumer — electrical → matcher,
 * mechanical → bodygen, software → codegen, cloud → cloudlink, commerce →
 * fulfillment. registry/scripts/validate.ts checks every
 * registry/parts/<ID>/part.json against this, and
 * registry/schemas/part.schema.json is generated from it.
 *
 * Cross-part rules (connectors exist, `requires` is provided, footprints exist
 * for active parts, I²C clashes, logic levels, golden-build power paths) need
 * the whole registry and live in the validator, not here.
 */

const SEMVER_CORE = String.raw`(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[0-9A-Za-z.-]+)?`;

/** `1.0.0`. SemVer at every boundary (§7.5). */
export const SemVer = z.string().regex(new RegExp(`^${SEMVER_CORE}$`), "expected a semver like 1.0.0");
export type SemVer = z.infer<typeof SemVer>;

/** `>=0.1.0`, `^1.2.0`, `~1.0.0` or an exact version. */
export const SemVerRange = z
  .string()
  .regex(new RegExp(`^(>=|\\^|~)?${SEMVER_CORE}$`), "expected a semver range like >=0.1.0");

export const PartCategory = z.enum(["visual", "physical", "location", "communication", "motion", "energy"]);
export type PartCategory = z.infer<typeof PartCategory>;

/** The id's letter is the category's; `P-002` is physical. */
export const PART_CATEGORY_PREFIX = {
  visual: "V",
  physical: "P",
  location: "L",
  communication: "C",
  motion: "M",
  energy: "E",
} as const satisfies Record<PartCategory, string>;

export const PartId = z.string().regex(/^[VPLCME]-\d{3}$/, "expected an id like P-002");
export type PartId = z.infer<typeof PartId>;

/** `deprecated` + `successor` stops matcher selection (§7.5); `retired` parts only rebuild old snapshots. */
export const PartStatus = z.enum(["draft", "active", "deprecated", "retired"]);
export type PartStatus = z.infer<typeof PartStatus>;

/**
 * §4 lists the seven signal interfaces. Two more cover parts that have no
 * signal bus: `power` for batteries, chargers and supplies, and `host` for the
 * brain, which provides buses rather than consuming one.
 */
export const PartInterface = z.enum(["i2c", "spi", "uart", "1-wire", "pwm", "adc", "gpio", "power", "host"]);
export type PartInterface = z.infer<typeof PartInterface>;

export const Exposure = z.enum(["none", "vent", "window", "probe-external"]);
export type Exposure = z.infer<typeof Exposure>;

/**
 * `<namespace>.<name>`. Sensors provide `read.*` and actuators `act.*`, each
 * ending in a unit suffix (`read.temperature_c`); the brain and power parts
 * provide `bus.*`, `gpio.*`, `net.*` and `power.*`, which other parts
 * `require`.
 */
export const Capability = z
  .string()
  .regex(/^[a-z][a-z0-9]*(\.[a-z0-9_]+)+$/, "expected a capability like read.temperature_c");
export type Capability = z.infer<typeof Capability>;

/** `hsx-3pin-v1`: a file in registry/connectors/. */
export const ConnectorId = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*-v\d+$/, "expected a connector id like hsx-3pin-v1");

/** 7-bit, outside the reserved ranges: 0x08–0x77, lower-case hex. */
export const I2cAddress = z
  .string()
  .regex(/^0x(0[89a-f]|[1-6][0-9a-f]|7[0-7])$/, "expected a 7-bit I2C address 0x08–0x77, lower-case hex");

/** A positive number, for lengths, voltages and capacities. */
const Positive = z.number().positive();

/** [min, max] volts. */
const VoltageRange = z
  .tuple([Positive, Positive])
  .refine(([min, max]) => min <= max, "range min must be ≤ max");

/** A named rail a part can be powered from instead of its connector. */
export const PowerInput = z.strictObject({
  /** `5v-pin`, `3v3-pin`. `primary` is reserved: it names the connector input. */
  name: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "expected an input name like 5v-pin")
    .refine((name) => name !== "primary", "primary is reserved for the connector input"),
  voltage_range: VoltageRange,
});
export type PowerInput = z.infer<typeof PowerInput>;

export const PartElectrical = z.strictObject({
  interface: PartInterface,
  connector: ConnectorId,
  /**
   * Supply voltage the part accepts at `connector`, including whatever the
   * board puts in front of the chip (a protection diode, a regulator). For an
   * energy part, the voltage it delivers.
   */
  voltage_range: VoltageRange,
  /**
   * Other inputs the part can be powered from, each an alternative to
   * `connector` (a dev board's 5V and 3V3 header pins). Not in §4; the §7.2
   * voltage window needs to know which input a supply is wired to.
   */
  alt_inputs: z.array(PowerInput).optional(),
  /** Drawn from the assembly's rails. Energy parts that feed the rails draw 0. */
  current_draw_ma: z
    .strictObject({ idle: z.number().nonnegative(), active: z.number().nonnegative() })
    .refine((c) => c.idle <= c.active, "current_draw_ma idle must be ≤ active"),
  requires: z.array(Capability),
  conflicts: z.array(PartId),
  i2c_address: I2cAddress.nullable(),
  /**
   * IO voltages the part's signal lines work with, [min, max] V. For the host,
   * the one IO voltage it drives ([3.3, 3.3]). Null for power parts, and for a
   * draft whose logic level isn't verified yet.
   */
  logic_v: VoltageRange.nullable(),
  /**
   * What the part supplies to the assembly: an energy part's output, or the
   * host's regulated rail for its peripherals. Not in §4's example; the power
   * constraint (§7.2) needs it. Required for energy parts.
   */
  supply: z
    .strictObject({
      output_v: VoltageRange,
      max_output_ma: Positive,
      /** Battery capacity; null for anything that isn't a store of charge. */
      capacity_mah: Positive.nullable(),
    })
    .optional(),
});
export type PartElectrical = z.infer<typeof PartElectrical>;

const HoleXY = z.tuple([z.number().nonnegative(), z.number().nonnegative()]);

/** How bodygen fixes the part in the enclosure. */
export const Mount = z.discriminatedUnion("type", [
  /** Probe on a cable through the wall; the gland is sized from d_mm (§7.4). */
  z.strictObject({ type: z.literal("cable-gland"), d_mm: Positive }),
  /** A board on standoffs; hole centres from the board's corner, in mm. */
  z.strictObject({ type: z.literal("standoffs"), hole_d_mm: Positive, holes_mm: z.array(HoleXY).min(1) }),
  /** Two ear tabs, as on a hobby servo. */
  z.strictObject({ type: z.literal("tabs"), hole_d_mm: Positive, hole_spacing_mm: Positive }),
  /** A cylindrical cell or pack held in a moulded cradle. */
  z.strictObject({ type: z.literal("cradle") }),
  /** Lives outside the enclosure, like a wall supply. */
  z.strictObject({ type: z.literal("external") }),
  /** Not yet measured. Allowed only while the part is a draft. */
  z.strictObject({ type: z.literal("unspecified") }),
]);
export type Mount = z.infer<typeof Mount>;

/** Flags a part states about itself. Temperature is `temp:<min>..<max>C`. */
export const KNOWN_ENVIRONMENT_FLAGS = [
  "waterproof",
  "needs-airflow",
  "needs-light",
  "needs-line-of-sight",
  "moving-parts",
  "rf-radiator",
  "li-ion",
] as const;

const TEMP_FLAG = /^temp:(-?\d+)\.\.(-?\d+)C$/;

export const EnvironmentFlag = z.union([
  z.enum(KNOWN_ENVIRONMENT_FLAGS),
  z
    .string()
    .regex(TEMP_FLAG, "expected a known flag or temp:<min>..<max>C")
    .refine((flag) => {
      const [, min, max] = TEMP_FLAG.exec(flag) ?? [];
      return Number(min) < Number(max);
    }, "temp flag min must be < max"),
]);
export type EnvironmentFlag = z.infer<typeof EnvironmentFlag>;

export const PartMechanical = z.strictObject({
  /** Relative to the part's folder. Must exist before the part can be active. */
  footprint_file: z
    .string()
    .regex(/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*\.(step|stp)$/, "expected a relative .step path inside the part folder"),
  /** Bounding box of the part as bought, [x, y, z]. Null only while a draft is unmeasured. */
  bounding_mm: z.tuple([Positive, Positive, Positive]).nullable(),
  mount: Mount,
  exposure: Exposure,
  environment_flags: z.array(EnvironmentFlag),
});
export type PartMechanical = z.infer<typeof PartMechanical>;

export const PartSoftware = z
  .strictObject({
    /**
     * Null only for the host and passive power parts, or while a draft has no
     * driver yet. See the checks in PartDefinition.
     */
    driver_pkg: z
      .string()
      .regex(/^hsx-driver-[a-z0-9-]+$/, "expected hsx-driver-<name>")
      .nullable(),
    driver_version: SemVer.nullable(),
    sdk_module: z
      .string()
      .regex(/^[a-z]+(\/[a-z_]+)+$/, "expected an SDK module like sensors/temperature")
      .nullable(),
    capabilities: z.array(Capability).min(1),
    min_runtime: SemVerRange,
  })
  .refine(
    (s) => (s.driver_pkg === null) === (s.driver_version === null),
    "driver_pkg and driver_version are both set or both null",
  );
export type PartSoftware = z.infer<typeof PartSoftware>;

/** cloudlink derives channels, widgets and alert rules from these (CLOUD-PLATFORM.md §6.1). */
export const PartWidget = z.enum(["line-chart", "stat", "gauge", "event-timeline"]);
export const PartAlertTemplate = z.enum(["out_of_range", "on_event", "low_battery"]);

export const PartCloud = z.strictObject({
  /** Null only for parts that produce no telemetry channel; then there are no widgets or alerts either. */
  telemetry_schema: z
    .string()
    .regex(/^[a-z][a-z0-9_]*\.v\d+$/, "expected a schema id like temperature.v1")
    .nullable(),
  default_widgets: z.array(PartWidget),
  alert_templates: z.array(PartAlertTemplate),
});
export type PartCloud = z.infer<typeof PartCloud>;

export const Vendor = z.enum(["adafruit", "sparkfun", "digikey", "mouser"]);
export type Vendor = z.infer<typeof Vendor>;

export const Supplier = z.strictObject({
  vendor: Vendor,
  sku: z.string().min(1),
  url: z.url({ protocol: /^https$/ }),
});
export type Supplier = z.infer<typeof Supplier>;

export const PartCommerce = z.strictObject({
  /** Only listings someone has checked. May be empty while the part is a draft. */
  suppliers: z.array(Supplier),
  /** Null only while a draft has no checked price. */
  unit_cost_usd: Positive.nullable(),
});
export type PartCommerce = z.infer<typeof PartCommerce>;

/** Capabilities that carry a value (a reading or a command) and so need a driver and a channel. */
const isValueCapability = (capability: string) => capability.startsWith("read.") || capability.startsWith("act.");

export const PartDefinition = z
  .strictObject({
    /** Editor hint pointing at registry/schemas/part.schema.json; ignored by services. */
    $schema: z.string().optional(),
    id: PartId,
    version: SemVer,
    name: z.string().min(1),
    category: PartCategory,
    status: PartStatus,
    successor: PartId.nullable(),
    electrical: PartElectrical,
    mechanical: PartMechanical,
    software: PartSoftware,
    cloud: PartCloud,
    commerce: PartCommerce,
  })
  .superRefine((part, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const { electrical, software, cloud } = part;

    const prefix = PART_CATEGORY_PREFIX[part.category];
    if (!part.id.startsWith(`${prefix}-`)) issue(["id"], `${part.category} part ids start with ${prefix}-`);
    if (part.status === "deprecated" && part.successor === null) issue(["successor"], "a deprecated part needs a successor");
    if ((part.status === "draft" || part.status === "active") && part.successor !== null) {
      issue(["successor"], `a ${part.status} part has no successor`);
    }
    if (part.successor === part.id) issue(["successor"], "a part can't succeed itself");
    if (part.category === "energy" && electrical.supply === undefined) issue(["electrical", "supply"], "energy parts declare supply");
    if ((electrical.interface === "i2c") !== (electrical.i2c_address !== null)) {
      issue(["electrical", "i2c_address"], "i2c parts have an i2c_address; other parts have null");
    }

    // Electrical shape by interface.
    const passive = electrical.interface === "power" || electrical.interface === "host";
    if (electrical.interface === "host" && (electrical.logic_v === null || electrical.logic_v[0] !== electrical.logic_v[1])) {
      issue(["electrical", "logic_v"], "the host declares the one IO voltage it drives, as logic_v [v, v]");
    }
    if (electrical.interface === "power" && electrical.logic_v !== null) {
      issue(["electrical", "logic_v"], "power parts have no signal lines; logic_v is null");
    }
    const inputNames = (electrical.alt_inputs ?? []).map((input) => input.name);
    if (new Set(inputNames).size !== inputNames.length) issue(["electrical", "alt_inputs"], "alt_inputs names are unique");

    // Cloud consistency, at every status: a widget or alert needs a channel to read.
    const valueCaps = software.capabilities.filter(isValueCapability);
    if (cloud.telemetry_schema === null && (cloud.default_widgets.length > 0 || cloud.alert_templates.length > 0)) {
      issue(["cloud", "telemetry_schema"], "default_widgets and alert_templates need a telemetry_schema");
    }
    if (cloud.alert_templates.includes("low_battery") && !software.capabilities.includes("power.battery")) {
      issue(["cloud", "alert_templates"], "low_battery needs the power.battery capability");
    }
    if (cloud.alert_templates.includes("out_of_range") && !valueCaps.some((c) => c.startsWith("read.") && !c.endsWith("_bool"))) {
      issue(["cloud", "alert_templates"], "out_of_range needs a numeric read.* capability");
    }

    // A draft may be missing what can't be sourced yet; nothing past draft may.
    if (part.status === "draft") return;
    const where = `a ${part.status} part`;
    if (part.mechanical.mount.type === "unspecified") issue(["mechanical", "mount"], "only draft parts may leave mount unspecified");
    if (part.mechanical.bounding_mm === null) issue(["mechanical", "bounding_mm"], "only draft parts may leave bounding_mm null");
    if (part.commerce.suppliers.length === 0) issue(["commerce", "suppliers"], "only draft parts may have no supplier");
    if (part.commerce.unit_cost_usd === null) issue(["commerce", "unit_cost_usd"], "only draft parts may leave unit_cost_usd null");
    // The host and passive power parts may have nothing to drive. Anything on a
    // signal bus, or anything that reads or commands a value, may not.
    if (!passive || valueCaps.length > 0) {
      if (software.driver_pkg === null) issue(["software", "driver_pkg"], `${where} with ${electrical.interface} or read/act capabilities needs a driver`);
      if (software.sdk_module === null) issue(["software", "sdk_module"], `${where} with ${electrical.interface} or read/act capabilities needs an sdk_module`);
    }
    if (valueCaps.length > 0) {
      if (cloud.telemetry_schema === null) issue(["cloud", "telemetry_schema"], `${where} with ${valueCaps.join(", ")} needs a telemetry_schema`);
      if (cloud.default_widgets.length === 0) issue(["cloud", "default_widgets"], `${where} with ${valueCaps.join(", ")} needs a default widget`);
    }
    if (!passive && electrical.logic_v === null) issue(["electrical", "logic_v"], `${where} on a signal bus declares logic_v`);
  });
export type PartDefinition = z.infer<typeof PartDefinition>;
