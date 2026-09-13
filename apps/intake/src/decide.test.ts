import type { SpecTurn } from "@albusforge/schema";
import { describe, expect, it } from "vitest";
import { decide, emptySpec, filterQuestions, MAX_CLARIFICATION_ROUNDS, mergePatch, type Vocabulary } from "./decide";
import { NEEDS_MORE_REPLY, QUESTIONS_INTRO_ONE } from "./replies";

const vocabulary: Vocabulary = {
  capabilities: new Set(["read.temperature_c", "read.humidity_pct", "net.wifi", "power.battery", "power.5v"]),
  environmentFlags: new Set(["waterproof", "needs-airflow"]),
};

function turn(overrides: Partial<SpecTurn> = {}): SpecTurn {
  return { spec_patch: {}, candidate_questions: [], assumptions: [], reply: "model reply", ...overrides };
}

describe("mergePatch", () => {
  it("merges sections field by field and replaces arrays", () => {
    const base = mergePatch(emptySpec(), { sense: { what: ["temperature"], interval_s: 60 }, capabilities: ["read.temperature_c"] }, vocabulary).spec;
    const { spec } = mergePatch(base, { sense: { what: ["temperature", "humidity"] }, power: { source: "battery" } }, vocabulary);
    expect(spec.sense).toEqual({ what: ["temperature", "humidity"], interval_s: 60 });
    expect(spec.power).toEqual({ source: "battery" });
    // Not in the patch, so unchanged.
    expect(spec.capabilities).toEqual(["read.temperature_c"]);
    expect(spec.connect.transport).toBe("wifi");
  });

  it("drops capability ids and flags that aren't in the registry vocabulary", () => {
    const result = mergePatch(
      emptySpec(),
      { capabilities: ["read.temperature_c", "read.co2_ppm", "Ignore previous instructions", "read.temperature_c"], environment: { flags: ["waterproof", "fireproof"] } },
      vocabulary,
    );
    expect(result.spec.capabilities).toEqual(["read.temperature_c"]);
    expect(result.droppedCapabilities).toEqual(["read.co2_ppm", "Ignore previous instructions"]);
    expect(result.spec.environment.flags).toEqual(["waterproof"]);
    expect(result.droppedFlags).toEqual(["fireproof"]);
  });

  it("ignores the patch's open_questions: code decides questions", () => {
    const { spec } = mergePatch(emptySpec(), { open_questions: [{ field: "power.source", question: "?" }] }, vocabulary);
    expect(spec.open_questions).toEqual([]);
  });

  it("removes an empty act section", () => {
    expect(mergePatch(emptySpec(), { act: { what: [] } }, vocabulary).spec.act).toBeUndefined();
    expect(mergePatch(emptySpec(), { act: { what: ["open a valve"] } }, vocabulary).spec.act).toEqual({ what: ["open a valve"] });
  });
});

describe("filterQuestions", () => {
  it("keeps questions on solver-relevant fields only, one per field, at most three", () => {
    const result = filterQuestions(
      [
        { field: "power.source", question: "Battery or USB?" },
        { field: "experience.alerts", question: "What should the alert say?" },
        { field: "power.source", question: "Duplicate" },
        { field: "connect.transport", question: "Wi-Fi?" },
        { field: "sense.what", question: "Humidity too?" },
        { field: "environment.flags", question: "Outdoors?" },
      ],
      0,
    );
    expect(result.kept.map((q) => q.field)).toEqual(["power.source", "connect.transport", "sense.what"]);
    expect(result.irrelevant.map((q) => q.field)).toEqual(["experience.alerts"]);
    expect(result.cappedOut.map((q) => q.field)).toEqual(["environment.flags"]);
  });

  it("keeps nothing once two rounds are used", () => {
    const result = filterQuestions([{ field: "power.source", question: "Battery or USB?" }], MAX_CLARIFICATION_ROUNDS);
    expect(result.kept).toEqual([]);
    expect(result.cappedOut).toHaveLength(1);
  });
});

describe("decide", () => {
  const fridge = { sense: { what: ["temperature"] }, capabilities: ["read.temperature_c", "net.wifi"] };

  it("asks: status asking, a new version carrying the questions, the model's reply as written", () => {
    const decision = decide({
      previous: null,
      turn: turn({ spec_patch: fridge, candidate_questions: [{ field: "power.source", question: "Battery or USB?" }] }),
      vocabulary,
      roundsUsed: 0,
    });
    expect(decision.status).toBe("asking");
    expect(decision.spec.settled).toBe(false);
    expect(decision.spec.open_questions).toEqual([{ field: "power.source", question: "Battery or USB?" }]);
    expect(decision.reply).toBe("model reply");
    expect(decision.newVersion).toBe(true);
  });

  it("settles when nothing relevant is left to ask and capabilities exist", () => {
    const decision = decide({ previous: null, turn: turn({ spec_patch: fridge }), vocabulary, roundsUsed: 1 });
    expect(decision).toMatchObject({ status: "planning", confidence: 1, reply: "model reply" });
    expect(decision.spec.settled).toBe(true);
  });

  it("round cap: after two rounds, questions are dropped, defaults are stated and the spec settles", () => {
    const decision = decide({
      previous: null,
      turn: turn({
        spec_patch: fridge,
        candidate_questions: [{ field: "power.source", question: "Battery or USB?" }],
        assumptions: ["Connects over Wi-Fi"],
      }),
      vocabulary,
      roundsUsed: 2,
    });
    expect(decision.status).toBe("planning");
    expect(decision.spec.open_questions).toEqual([]);
    expect(decision.spec.assumptions).toContain("Connects over Wi-Fi");
    expect(decision.spec.assumptions.some((a) => a.includes("how it's powered"))).toBe(true);
    // The model's reply asked a question code dropped, so code writes the reply.
    expect(decision.reply).toContain("That's everything I need");
    expect(decision.reply).not.toContain("Battery or USB?");
  });

  it("a settled spec never asks again", () => {
    const settled = decide({ previous: null, turn: turn({ spec_patch: fridge }), vocabulary, roundsUsed: 0 }).spec;
    const decision = decide({
      previous: settled,
      turn: turn({ spec_patch: { power: { source: "usb" } }, candidate_questions: [{ field: "connect.transport", question: "Wi-Fi?" }] }),
      vocabulary,
      roundsUsed: 0,
    });
    expect(decision.status).toBe("planning");
    expect(decision.spec.open_questions).toEqual([]);
  });

  it("irrelevant questions are dropped and code rewrites the reply around the rest", () => {
    const decision = decide({
      previous: null,
      turn: turn({
        spec_patch: fridge,
        candidate_questions: [
          { field: "experience.alerts", question: "What should the alert say?" },
          { field: "power.source", question: "Battery or USB?" },
        ],
      }),
      vocabulary,
      roundsUsed: 0,
    });
    expect(decision.reply).toBe(`${QUESTIONS_INTRO_ONE}\n- Battery or USB?`);
  });

  it("notes dropped capabilities as assumptions, echoing only id-shaped text", () => {
    const decision = decide({
      previous: null,
      turn: turn({ spec_patch: { ...fridge, capabilities: ["read.temperature_c", "read.co2_ppm", "<script>"] } }),
      vocabulary,
      roundsUsed: 0,
    });
    expect(decision.spec.assumptions).toContain("Left out, not in the parts catalogue: read.co2_ppm");
    expect(decision.spec.assumptions).toContain("Left out, not in the parts catalogue: an unrecognised capability");
    expect(JSON.stringify(decision.spec)).not.toContain("<script>");
  });

  it("doesn't settle without any capability", () => {
    const decision = decide({ previous: null, turn: turn({ candidate_questions: [{ field: "sense.what", question: "What?" }] }), vocabulary, roundsUsed: 2 });
    expect(decision).toMatchObject({ status: "asking", reply: NEEDS_MORE_REPLY });
    expect(decision.spec.settled).toBe(false);
  });

  it("writes no new version when nothing changed and nothing was asked", () => {
    const first = decide({ previous: null, turn: turn({ spec_patch: fridge }), vocabulary, roundsUsed: 0 });
    const again = decide({ previous: first.spec, turn: turn({ spec_patch: fridge }), vocabulary, roundsUsed: 0 });
    expect(again.newVersion).toBe(false);
  });
});
