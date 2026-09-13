import { readFileSync } from "node:fs";
import path from "node:path";
import type { LlmResponse } from "@albusforge/llm";

const dir = path.join(import.meta.dirname, "fixtures");

export const GOLDEN_ASKS = {
  "fridge-monitor": {
    ask: "I want to keep an eye on my fridge: tell me if it gets too warm or too humid.",
    answer: "Battery please, and it should last a few months.",
  },
  "presence-alert": {
    ask: "Send me a notification when someone walks into my hallway.",
    answer: "It can plug into USB.",
  },
  "plant-waterer": {
    ask: "Water my houseplant automatically when the soil gets dry.",
    answer: "There's a USB charger right next to it.",
  },
} as const;

export type GoldenBuildId = keyof typeof GOLDEN_ASKS;

/** A golden turn's response (test/fixtures/golden/<build>/turn-<n>.json). */
export function goldenTurn(build: GoldenBuildId, turn: 1 | 2): LlmResponse {
  return JSON.parse(readFileSync(path.join(dir, "golden", build, `turn-${turn}.json`), "utf8")) as LlmResponse;
}
