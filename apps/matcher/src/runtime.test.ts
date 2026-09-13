import { expect, it } from "vitest";
import { satisfiesRuntime } from "./runtime";

it.each([
  ["1.2.3", "1.2.3", true], ["1.2.4", "1.2.3", false],
  ["1.3.0", ">=1.2.0", true], ["1.1.9", ">=1.2.0", false],
  ["1.9.9", "^1.2.3", true], ["2.0.0", "^1.2.3", false],
  ["0.2.9", "^0.2.3", true], ["0.3.0", "^0.2.3", false],
  ["0.0.4", "^0.0.3", false], ["0.0.3", "^0.0.3", true],
  ["1.2.9", "~1.2.3", true], ["1.3.0", "~1.2.3", false],
  ["1.2.3-rc.2", ">=1.2.3-rc.1", true], ["1.2.4-rc.1", ">=1.2.3-rc.1", false],
  ["1.3.0-rc.1", ">=1.2.0", false], ["1.2.3", ">=1.2.3-rc.1", true],
])("runtime %s satisfies %s: %s", (version, range, expected) => {
  expect(satisfiesRuntime(version, range)).toBe(expected);
});
