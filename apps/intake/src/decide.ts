import { CapabilityId, type OpenQuestion, Spec, type SpecPatch, type SpecTurn } from "@albusforge/schema";
import { NEEDS_MORE_REPLY, questionsReply, settledReply } from "./replies";

/**
 * Pure turn logic: merge the model's patch into the spec, validate it against
 * the registry's vocabulary, keep only questions that change the parts, cap
 * clarification at two rounds, and decide whether the spec settles.
 */

/**
 * The interim clarification test (ASK-TO-ENCLOSURE.md §3, "Before the matcher
 * exists"): a question survives only if it resolves one of these fields. M3's
 * sensitivity check replaces this list behind the same function.
 */
export const SOLVER_RELEVANT_FIELDS = ["sense.what", "act.what", "power.source", "connect.transport", "power.target_life_days", "environment.flags"] as const;
export type SolverRelevantField = (typeof SOLVER_RELEVANT_FIELDS)[number];

/**
 * One question per turn, so the person answers one thing at a time rather than
 * unpicking a bundle. That costs rounds: four of them buy the four questions
 * intake actually needs (power, environment, sensing, transport) where two
 * bundled rounds used to. Each answer is usually a tap, so the extra turns are
 * cheaper for the person than the bundle was.
 */
export const MAX_CLARIFICATION_ROUNDS = 4;
export const MAX_QUESTIONS_PER_ROUND = 1;
const MAX_ASSUMPTIONS = 20;

const FIELD_LABEL: Record<SolverRelevantField, string> = {
  "sense.what": "what it measures",
  "act.what": "what it does",
  "power.source": "how it's powered",
  "connect.transport": "how it connects",
  "power.target_life_days": "how long the battery should last",
  "environment.flags": "the conditions where it lives",
};

/** The registry vocabulary a spec is checked against, from the part catalogue. */
export interface Vocabulary {
  capabilities: ReadonlySet<string>;
  environmentFlags: ReadonlySet<string>;
}

export function emptySpec(): Spec {
  return {
    sense: { what: [] },
    environment: { location: "unspecified", flags: [] },
    connect: { transport: "wifi", experience: [] },
    power: { source: "unknown" },
    experience: {},
    capabilities: [],
    assumptions: [],
    open_questions: [],
    settled: false,
  };
}

const defined = <T extends object>(value: T | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(value ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

const unique = (values: readonly string[]) => [...new Set(values)];

/** Echo a model-supplied token back to the person only when it looks like vocabulary. */
const FLAG_SHAPE = /^[a-z0-9][a-z0-9:.-]{0,63}$/;
const describeDropped = (value: string, shape: (v: string) => boolean, kind: string) => (shape(value) ? value : `an unrecognised ${kind}`);

export interface MergeResult {
  spec: Spec;
  droppedCapabilities: string[];
  droppedFlags: string[];
}

/**
 * Applies a patch: sections merge field by field, arrays replace, and
 * capability ids and environment flags not in the vocabulary are dropped. The
 * patch's `open_questions` is ignored (code decides questions) and
 * `assumptions` accumulate. `settled` is carried from the base.
 */
export function mergePatch(base: Spec, patch: SpecPatch, vocabulary: Vocabulary): MergeResult {
  const spec: Spec = structuredClone(base);
  spec.sense = { ...spec.sense, ...defined(patch.sense) };
  if (patch.act !== undefined) spec.act = { what: [], ...spec.act, ...defined(patch.act) };
  spec.environment = { ...spec.environment, ...defined(patch.environment) };
  spec.connect = { ...spec.connect, ...defined(patch.connect) };
  spec.power = { ...spec.power, ...defined(patch.power) };
  spec.experience = { ...spec.experience, ...defined(patch.experience) };
  if (spec.act && spec.act.what.length === 0) delete spec.act;

  const droppedFlags: string[] = [];
  spec.environment.flags = unique(spec.environment.flags).filter((flag) => vocabulary.environmentFlags.has(flag) || (droppedFlags.push(flag), false));

  const droppedCapabilities: string[] = [];
  if (patch.capabilities !== undefined) {
    spec.capabilities = unique(patch.capabilities.map((c) => c.trim())).filter(
      (id) => (CapabilityId.safeParse(id).success && vocabulary.capabilities.has(id)) || (droppedCapabilities.push(id), false),
    );
  }

  spec.assumptions = unique([...spec.assumptions, ...(patch.assumptions ?? [])]).slice(-MAX_ASSUMPTIONS);
  return { spec, droppedCapabilities, droppedFlags };
}

export interface QuestionFilter {
  kept: OpenQuestion[];
  /** Relevant questions the round cap removed. */
  cappedOut: OpenQuestion[];
  /** Questions about fields that don't change the parts. */
  irrelevant: OpenQuestion[];
}

export function filterQuestions(candidates: readonly OpenQuestion[], roundsUsed: number): QuestionFilter {
  const relevant = new Set<string>(SOLVER_RELEVANT_FIELDS);
  const seen = new Set<string>();
  const kept: OpenQuestion[] = [];
  const cappedOut: OpenQuestion[] = [];
  const irrelevant: OpenQuestion[] = [];
  const capReached = roundsUsed >= MAX_CLARIFICATION_ROUNDS;
  for (const candidate of candidates) {
    const field = candidate.field.trim();
    if (!relevant.has(field)) {
      irrelevant.push(candidate);
      continue;
    }
    if (seen.has(field)) continue;
    seen.add(field);
    // Options come through as the model wrote them: trimmed and de-duplicated.
    // One surviving option is kept — the chat offers "Continue chatting" beside
    // them — but an empty list is dropped rather than drawn as an empty row.
    const options = candidate.options?.map((option) => option.trim()).filter((option) => option.length > 0);
    const distinct = options === undefined ? undefined : [...new Set(options)];
    const question: OpenQuestion = {
      field,
      question: candidate.question.trim(),
      ...(distinct !== undefined && distinct.length > 0 ? { options: distinct.slice(0, 4) } : {}),
    };
    if (capReached || kept.length >= MAX_QUESTIONS_PER_ROUND) cappedOut.push(question);
    else kept.push(question);
  }
  return { kept, cappedOut, irrelevant };
}

export type TurnStatus = "asking" | "planning";

export interface Decision {
  spec: Spec;
  reply: string;
  status: TurnStatus;
  /** Whether to write a new spec version. Asking always does, so rounds can be counted from specs. */
  newVersion: boolean;
  /** Stored as specs.confidence. */
  confidence: number;
  droppedCapabilities: string[];
  droppedFlags: string[];
}

export interface DecideInput {
  previous: Spec | null;
  turn: SpecTurn;
  vocabulary: Vocabulary;
  /** Spec versions so far that asked questions. */
  roundsUsed: number;
}

export function decide({ previous, turn, vocabulary, roundsUsed }: DecideInput): Decision {
  const base = previous ?? emptySpec();
  const merged = mergePatch(base, turn.spec_patch, vocabulary);
  const spec = merged.spec;

  const notes = [
    ...merged.droppedCapabilities.map((c) => `Left out, not in the parts catalogue: ${describeDropped(c, (v) => CapabilityId.safeParse(v).success, "capability")}`),
    ...merged.droppedFlags.map((f) => `Left out, not a known environment condition: ${describeDropped(f, (v) => FLAG_SHAPE.test(v), "condition")}`),
  ];

  // A settled spec stays settled: later messages are edits, not new rounds of questions.
  const rounds = base.settled ? MAX_CLARIFICATION_ROUNDS : roundsUsed;
  const questions = filterQuestions(turn.candidate_questions, rounds);
  const capped = questions.cappedOut.filter((q) => !questions.kept.some((k) => k.field === q.field));
  const settled = spec.capabilities.length > 0 && questions.kept.length === 0;

  const defaultsTaken = settled
    ? unique(capped.map((q) => q.field)).map(
        (field) => `No answer on ${FIELD_LABEL[field as SolverRelevantField] ?? field}; the spec uses a default for it`,
      )
    : [];
  spec.assumptions = unique([...spec.assumptions, ...turn.assumptions, ...notes, ...defaultsTaken]).slice(-MAX_ASSUMPTIONS);
  spec.open_questions = questions.kept;
  spec.settled = settled;

  // The model's reply is used as written only when every question it asked survived;
  // otherwise it may ask something code dropped, so code writes the reply.
  const allSurvived = questions.cappedOut.length === 0 && questions.irrelevant.length === 0;
  let reply: string;
  if (allSurvived) reply = turn.reply;
  else if (questions.kept.length > 0) reply = questionsReply(questions.kept);
  else if (settled) reply = settledReply(spec.assumptions);
  else reply = NEEDS_MORE_REPLY;

  const parsed = Spec.parse(spec);
  const changed = previous === null || JSON.stringify(previous) !== JSON.stringify(parsed);
  return {
    spec: parsed,
    reply,
    status: settled ? "planning" : "asking",
    newVersion: changed || questions.kept.length > 0,
    confidence: settled ? 1 : Math.max(0, 1 - questions.kept.length / SOLVER_RELEVANT_FIELDS.length),
    droppedCapabilities: merged.droppedCapabilities,
    droppedFlags: merged.droppedFlags,
  };
}
