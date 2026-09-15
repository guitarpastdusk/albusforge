import { describe, expect, it } from "vitest";
import { GOLDEN_BUILDS } from "../scripts/golden-builds";
import { loadRegistry } from "../scripts/lib/load";
import { formatIssues, type RegistryInput, validateRegistry } from "../scripts/lib/rules";
import { goodInput, type Json, partData, promoteProbe } from "./fixtures";

const issuesOf = (input: RegistryInput) => validateRegistry(input).issues;
const rulesOf = (input: RegistryInput) => issuesOf(input).map((i) => i.rule);
/** Schema issue paths ("software.driver_pkg") reported for one part. */
const schemaPathsOf = (input: RegistryInput, id: string) =>
  issuesOf(input)
    .filter((i) => i.rule === "schema" && i.file === `parts/${id}/part.json`)
    .map((i) => i.message.split(":")[0]);

/** A copy of the good fixture with one change applied. */
function broken(change: (input: RegistryInput) => void): RegistryInput {
  const input = goodInput();
  change(input);
  return input;
}

describe("validateRegistry", () => {
  it("passes the good fixture", () => {
    expect(issuesOf(goodInput())).toEqual([]);
  });

  it("passes the committed registry", () => {
    const result = validateRegistry({ ...loadRegistry(), goldenBuilds: GOLDEN_BUILDS });
    expect(formatIssues(result.issues)).toBe("");
    expect(result.parts.map((p) => `${p.part.id}@${p.part.version}`)).toEqual([
      "C-001@1.0.0", "C-002@1.0.0", "E-001@1.0.0", "E-004@1.0.0", "E-005@1.0.0", "E-005@1.1.0", "L-003@1.0.0",
      "M-001@1.0.0", "M-001@1.1.0", "P-001@1.0.0", "P-001@1.1.0", "P-002@1.0.0", "P-004@1.0.0", "P-005@1.0.0",
      "P-006@1.0.0", "V-004@1.0.0", "V-005@1.0.0", "V-005@1.1.0",
    ]);
    // The parts the demo build pins are active; the rest wait on the fit spike.
    // The 1.0.0 drafts stay on disk unchanged because they are already loaded
    // into registry.parts, where a version is immutable (scripts/load.ts).
    const active = result.parts.filter((p) => p.part.status === "active").map((p) => `${p.part.id}@${p.part.version}`);
    expect(active).toEqual(["C-002@1.0.0", "E-005@1.1.0", "M-001@1.1.0", "P-001@1.1.0", "P-006@1.0.0", "V-005@1.1.0"]);
    expect(new Set(result.parts.map((p) => p.part.status))).toEqual(new Set(["draft", "active"]));
  });

  describe("json and schema", () => {
    it("reports a file that isn't JSON", () => {
      const input = broken((i) => {
        // P-002: nothing else depends on it, so no knock-on issues.
        i.parts[3] = { ...i.parts[3]!, data: undefined, parseError: "Unexpected token" };
      });
      expect(rulesOf(input)).toEqual(["json"]);
    });

    it.each<[string, (part: Json) => void, string]>([
      ["voltage_range min > max", (p) => (p.electrical.voltage_range = [5, 3]), "electrical.voltage_range"],
      ["non-positive dimension", (p) => (p.mechanical.bounding_mm = [20, 0, 5]), "mechanical.bounding_mm.1"],
      ["I2C address out of range", (p) => (p.electrical.i2c_address = "0x78"), "electrical.i2c_address"],
      ["upper-case I2C address", (p) => (p.electrical.i2c_address = "0x7A"), "electrical.i2c_address"],
      ["deprecated without successor", (p) => (p.status = "deprecated"), "successor"],
      ["id letter doesn't match category", (p) => (p.category = "visual"), "id"],
      ["active with no supplier", (p) => (p.commerce.suppliers = []), "commerce.suppliers"],
      ["active with no bounding box", (p) => (p.mechanical.bounding_mm = null), "mechanical.bounding_mm"],
      ["idle current above active", (p) => (p.electrical.current_draw_ma = { idle: 2, active: 1 }), "electrical.current_draw_ma"],
      ["bad semver", (p) => (p.version = "1.0"), "version"],
      ["numeric pre-release with a leading zero", (p) => (p.version = "1.0.0-rc.01"), "version"],
      ["empty pre-release identifier", (p) => (p.version = "1.0.0-rc..1"), "version"],
      ["empty pre-release", (p) => (p.version = "1.0.0-"), "version"],
      ["leading zero in the core", (p) => (p.version = "01.0.0"), "version"],
      ["leading zero in driver_version", (p) => (p.software.driver_version = "0.01.0"), "software.driver_version"],
      ["unknown key", (p) => (p.electrical.voltage = 3.3), "electrical"],
      ["unknown environment flag", (p) => (p.mechanical.environment_flags = ["fridge"]), "mechanical.environment_flags.0"],
      ["i2c part without an address", (p) => (p.electrical.i2c_address = null), "electrical.i2c_address"],
      ["logic_v min > max", (p) => (p.electrical.logic_v = [5, 3]), "electrical.logic_v"],
      ["active signal part without logic_v", (p) => (p.electrical.logic_v = null), "electrical.logic_v"],
      ["widgets without a telemetry schema", (p) => (p.cloud.telemetry_schema = null), "cloud.telemetry_schema"],
      ["low_battery on a part with no battery", (p) => (p.cloud.alert_templates = ["low_battery"]), "cloud.alert_templates"],
      ["out_of_range with only a boolean reading", (p) => (p.software.capabilities = ["read.motion_bool"]), "cloud.alert_templates"],
      ["active sensor without a default widget", (p) => (p.cloud.default_widgets = []), "cloud.default_widgets"],
    ])("rejects %s", (_, change, path) => {
      const input = broken((i) => change(partData(i, "P-001")));
      expect(schemaPathsOf(input, "P-001")).toContain(path);
    });

    it("rejects an energy part without supply", () => {
      const input = broken((i) => delete partData(i, "E-001").electrical.supply);
      expect(issuesOf(input)).toContainEqual(expect.objectContaining({ rule: "schema", message: expect.stringContaining("energy parts declare supply") }));
    });

    it("rejects a connector with pins out of order", () => {
      const input = broken((i) => {
        (i.connectors[0]!.data as Json).pins[1].n = 3;
      });
      expect(rulesOf(input)).toContain("schema");
    });

    describe("drivers and telemetry past draft", () => {
      it("accepts the probe once it has a driver, SDK module, channel and logic level", () => {
        expect(issuesOf(broken(promoteProbe))).toEqual([]);
      });

      it("rejects an active sensor with no driver, SDK module or telemetry", () => {
        const input = broken((i) => {
          const probe = promoteProbe(i);
          probe.software = { ...probe.software, driver_pkg: null, driver_version: null, sdk_module: null };
          probe.cloud = { telemetry_schema: null, default_widgets: [], alert_templates: [] };
        });
        expect(schemaPathsOf(input, "P-002")).toEqual(
          expect.arrayContaining(["software.driver_pkg", "software.sdk_module", "cloud.telemetry_schema", "cloud.default_widgets"]),
        );
      });

      it("rejects an active actuator with no driver", () => {
        const input = broken((i) => {
          const probe = promoteProbe(i);
          probe.software = { ...probe.software, capabilities: ["read.temperature_c", "act.position_deg"], driver_pkg: null, driver_version: null };
        });
        expect(schemaPathsOf(input, "P-002")).toContain("software.driver_pkg");
      });

      it("lets a draft sensor leave them null", () => {
        expect(partData(goodInput(), "P-002").software.driver_pkg).toBeNull();
        expect(issuesOf(goodInput())).toEqual([]);
      });

      it("lets active host and power parts leave them null", () => {
        const input = goodInput();
        expect(partData(input, "C-001")).toMatchObject({ status: "active", software: { driver_pkg: null }, cloud: { telemetry_schema: null } });
        expect(partData(input, "E-001")).toMatchObject({ status: "active", software: { driver_pkg: null }, cloud: { telemetry_schema: null } });
        expect(issuesOf(input)).toEqual([]);
      });

      it("still requires a channel when a power part reads a value", () => {
        const input = broken((i) => partData(i, "E-001").software.capabilities.push("read.voltage_v"));
        expect(schemaPathsOf(input, "E-001")).toEqual(expect.arrayContaining(["software.driver_pkg", "cloud.telemetry_schema"]));
      });
    });

    describe("electrical shape by interface", () => {
      it("rejects a host with an IO voltage range instead of one voltage", () => {
        const input = broken((i) => (partData(i, "C-001").electrical.logic_v = [3.0, 3.6]));
        expect(schemaPathsOf(input, "C-001")).toContain("electrical.logic_v");
      });

      it("rejects a power part with a logic level", () => {
        const input = broken((i) => (partData(i, "E-001").electrical.logic_v = [3.0, 5.0]));
        expect(schemaPathsOf(input, "E-001")).toContain("electrical.logic_v");
      });

      it("rejects duplicate or reserved alt_inputs names", () => {
        const dup = broken((i) => partData(i, "C-001").electrical.alt_inputs.push({ name: "5v-pin", voltage_range: [4, 5] }));
        expect(schemaPathsOf(dup, "C-001")).toContain("electrical.alt_inputs");
        const reserved = broken((i) => (partData(i, "C-001").electrical.alt_inputs[0].name = "primary"));
        expect(schemaPathsOf(reserved, "C-001")).toContain("electrical.alt_inputs.0.name");
      });
    });
  });

  it("folder-id: folder name must equal the id", () => {
    const input = broken((i) => {
      i.parts[0] = { ...i.parts[0]!, name: "C-009", path: "parts/C-009/part.json" };
    });
    expect(rulesOf(input)).toEqual(["folder-id"]);
  });

  it("connector-name: file name must equal the id", () => {
    const input = broken((i) => {
      i.connectors.push({ ...i.connectors[0]!, name: "hsx-3pin-v2", path: "connectors/hsx-3pin-v2.json" });
    });
    expect(rulesOf(input)).toEqual(["connector-name"]);
  });

  it("duplicate-version: one (id, version) per registry", () => {
    const input = broken((i) => {
      i.parts.push({ ...i.parts[0]!, data: structuredClone(i.parts[0]!.data) });
    });
    expect(rulesOf(input)).toEqual(["duplicate-version"]);
  });

  describe("footprint", () => {
    it("requires the footprint file for active parts, not drafts", () => {
      const input = broken((i) => {
        i.footprintExists = () => false;
      });
      const issues = issuesOf(input);
      expect(issues.map((i) => i.rule)).toEqual(["footprint", "footprint", "footprint"]);
      expect(issues.map((i) => i.file)).toEqual(["parts/C-001/part.json", "parts/E-001/part.json", "parts/P-001/part.json"]);
    });

    it("requires it for deprecated parts too", () => {
      const input = broken((i) => {
        i.footprintExists = (dir) => dir !== "P-002";
        Object.assign(promoteProbe(i), { status: "deprecated", successor: "P-001" });
      });
      expect(rulesOf(input)).toEqual(["footprint"]);
    });
  });

  it("connector-unknown: the connector must have a file", () => {
    const input = broken((i) => (partData(i, "P-001").electrical.connector = "grove-4pin-v1"));
    expect(rulesOf(input)).toEqual(["connector-unknown"]);
  });

  it("connector-interface: the connector must carry the part's interface", () => {
    const input = broken((i) => (partData(i, "P-001").electrical.connector = "hsx-3pin-v1"));
    expect(rulesOf(input)).toEqual(["connector-interface"]);
  });

  it("successor-unknown: successor must be a known part", () => {
    const input = broken((i) => Object.assign(partData(i, "P-001"), { status: "retired", successor: "P-099" }));
    expect(rulesOf(input)).toEqual(["successor-unknown"]);
  });

  it("conflict-unknown: conflicts must name known parts", () => {
    const input = broken((i) => (partData(i, "P-001").electrical.conflicts = ["P-099"]));
    expect(rulesOf(input)).toEqual(["conflict-unknown"]);
  });

  describe("requires-unprovided", () => {
    it("flags a requirement nothing provides", () => {
      const input = broken((i) => (partData(i, "P-001").electrical.requires = ["bus.i2c", "bus.spi"]));
      expect(issuesOf(input)).toEqual([expect.objectContaining({ rule: "requires-unprovided", message: expect.stringContaining("bus.spi") })]);
    });

    it("doesn't count a retired provider", () => {
      const input = broken((i) => (partData(i, "C-001").status = "retired"));
      expect(rulesOf(input)).toContain("requires-unprovided");
    });
  });

  it("capability-unit: read.* capabilities need a unit suffix", () => {
    const input = broken((i) => (partData(i, "P-001").software.capabilities = ["read.temperature_c", "read.temperature"]));
    expect(rulesOf(input)).toEqual(["capability-unit"]);
  });

  describe("i2c-clash", () => {
    const addClash = (i: RegistryInput) => {
      const copy = structuredClone(i.parts.find((p) => p.name === "P-001")!);
      copy.name = "P-003";
      copy.path = "parts/P-003/part.json";
      (copy.data as Json).id = "P-003";
      i.parts.push(copy);
    };

    it("flags two parts on the same default address", () => {
      const issues = issuesOf(broken(addClash));
      expect(issues).toEqual([expect.objectContaining({ rule: "i2c-clash", message: expect.stringContaining("P-001, P-003") })]);
    });

    it("accepts a clash that is noted", () => {
      const input = broken((i) => {
        addClash(i);
        i.i2cShared.data = [{ address: "0x77", parts: ["P-001", "P-003"], note: "P-003 ships with its jumper cut to 0x76" }];
      });
      expect(issuesOf(input)).toEqual([]);
    });

    it("flags a note that no longer matches", () => {
      const input = broken((i) => {
        i.i2cShared.data = [{ address: "0x68", parts: ["P-001", "P-003"], note: "stale" }];
      });
      expect(rulesOf(input)).toEqual(["i2c-clash"]);
    });
  });

  describe("logic-level", () => {
    const fiveVoltSensor = (i: RegistryInput) => (partData(i, "P-001").electrical.logic_v = [5.0, 5.0]);

    it("flags a peripheral that can't work at the host's IO voltage", () => {
      const issues = issuesOf(broken(fiveVoltSensor));
      expect(issues).toEqual([
        expect.objectContaining({ rule: "logic-level", file: "parts/P-001/part.json", message: expect.stringContaining("C-001 drives 3.3 V IO") }),
      ]);
    });

    it("accepts a mismatch recorded in known-issues.json", () => {
      const input = broken((i) => {
        fiveVoltSensor(i);
        i.knownIssues.data = [{ rule: "logic-level", parts: ["P-001", "C-001"], note: "divide the echo down" }];
      });
      expect(issuesOf(input)).toEqual([]);
    });

    it("flags a known issue that no longer matches", () => {
      const input = broken((i) => {
        i.knownIssues.data = [{ rule: "logic-level", parts: ["P-001", "C-001"], note: "stale" }];
      });
      expect(issuesOf(input)).toEqual([expect.objectContaining({ rule: "logic-level", file: "known-issues.json" })]);
    });

    it("skips a draft whose logic level isn't known yet", () => {
      expect(partData(goodInput(), "P-002").electrical.logic_v).toBeNull();
      expect(issuesOf(goodInput())).toEqual([]);
    });
  });

  it("golden-build: every golden-build capability must be provided", () => {
    const input = broken((i) => {
      i.goldenBuilds = [
        { id: "x", name: "Presence alert", requires: ["read.motion_bool"], optional: [], power: { supply: "power.battery", brain_input: "5v-pin" } },
      ];
    });
    expect(issuesOf(input)).toEqual([expect.objectContaining({ rule: "golden-build", message: expect.stringContaining("read.motion_bool") })]);
  });

  describe("power-path", () => {
    it("flags a supply that would overvolt the brain input it's wired to", () => {
      const input = broken((i) => (i.goldenBuilds[0]!.power = { supply: "power.battery", brain_input: "3v3-pin" }));
      expect(issuesOf(input)).toEqual([
        expect.objectContaining({ rule: "power-path", message: expect.stringContaining("E-001 (2.5–4.2 V) can't feed C-001 3v3-pin (3–3.6 V)") }),
      ]);
    });

    it("flags a peripheral outside the brain's rail", () => {
      // Both temperature parts, or the draft probe would still fit the rail.
      const input = broken((i) => {
        partData(i, "P-001").electrical.voltage_range = [4.5, 5.5];
        partData(i, "P-002").electrical.voltage_range = [4.5, 5.5];
      });
      expect(issuesOf(input)).toEqual([
        expect.objectContaining({ rule: "power-path", message: expect.stringContaining("no part providing read.temperature_c runs from") }),
      ]);
    });

    it("flags an input the brain doesn't have", () => {
      const input = broken((i) => (i.goldenBuilds[0]!.power.brain_input = "vbat-pin"));
      expect(issuesOf(input)).toEqual([expect.objectContaining({ rule: "power-path", message: expect.stringContaining('no "vbat-pin" input') })]);
    });
  });

  it("formats issues with file and rule", () => {
    const input = broken((i) => (partData(i, "P-001").electrical.connector = "grove-4pin-v1"));
    expect(formatIssues(issuesOf(input))).toBe(
      '  parts/P-001/part.json\n    [connector-unknown] connector "grove-4pin-v1" has no file in connectors/',
    );
  });
});
