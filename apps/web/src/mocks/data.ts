import type { UsageSummary } from "@albusforge/schema";
import { liveReadings } from "./live-state";
import { readRule } from "./rules";
import type {
  ActionProposal,
  AskResponse,
  Channel,
  BuildDetail,
  BuildList,
  BuildSummary,
  ChatMessage,
  CreatedBuild,
  CandidatePart,
  BuildStatus,
  DeviceAction,
  DeviceDashboard,
  DeviceReadyCard,
  Fleet,
  Me,
  MessageList,
  Usage,
} from "@albusforge/schema";
import { summarizePart } from "@albusforge/schema";
import { EXAMPLE_PARTS } from "@/lib/example-builds";

/*
 * The design prototype's data, shaped to the contract. Timestamps are relative
 * to the call, so "40s ago" stays 40s ago. Hardware names are the design's
 * copy, not the MVP registry (which is ESP32-S3 only).
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

/** The build an anonymous visitor gets from the landing chat. */
export const ANONYMOUS_BUILD_ID = "mock-build";

// --- session ------------------------------------------------------------------

export function me(): Me {
  const tenant = { id: "ten_fern", name: "Fern & Co", slug: "fern", role: "admin" } as const;
  return {
    user: { id: "usr_maya", email: "maya@fern.co", display_name: "Maya J" },
    tenant,
    tenants: [tenant],
  };
}

// --- builds -------------------------------------------------------------------

/** POST /v1/auth/verify in mock mode: any 6 digits sign in as the demo user, under the given email. */
export function verifiedSession(email: string): Me {
  const session = me();
  return { ...session, user: { ...session.user, email, display_name: null } };
}

const SUMMARIES: Array<Omit<BuildSummary, "updated_at"> & { updated_ago: number }> = [
  {
    id: "greenhouse-soil",
    name: "Greenhouse soil monitor",
    description: "4 soil probes, solar powered, alerts below 22% VWC.",
    display_status: "live",
    device_count: 4,
    updated_ago: 2 * MINUTE,
  },
  {
    id: "fridge-door",
    name: "Fridge door sentinel",
    description: "Hall-effect door sensor + temp probe, texts after 90s open.",
    display_status: "kit_shipped",
    device_count: 1,
    updated_ago: 26 * HOUR,
  },
  {
    id: "compressor-vibration",
    name: "Compressor vibration watch",
    description: "Accelerometer + FFT on-device, anomaly alerts to phone.",
    display_status: "designing",
    device_count: 2,
    updated_ago: 3 * DAY,
  },
  {
    id: "orchid-light",
    name: "Orchid light + humidity",
    description: "Lux + RH logging, weekly care summary via email.",
    display_status: "parts_picked",
    device_count: 1,
    updated_ago: 8 * DAY,
  },
];

export function buildList(): BuildList {
  return { builds: SUMMARIES.map(({ updated_ago, ...build }) => ({ ...build, updated_at: ago(updated_ago) })) };
}

export function buildDetail(id: string): BuildDetail | null {
  const conversation = conversations.get(id);
  if (conversation) return conversationDetail(id, conversation);

  if (id === ANONYMOUS_BUILD_ID) {
    return {
      id,
      name: "New build",
      description: "Anonymous build — not saved to a workspace yet.",
      display_status: "designing",
      device_count: 0,
      updated_at: ago(0),
      ready: null,
    };
  }

  const build = buildList().builds.find((b) => b.id === id);
  if (!build) return null;

  return {
    ...build,
    ready: id === "greenhouse-soil" ? DESIGN_READY : null,
  };
}

const GREENHOUSE_CONVERSATION: Array<[ChatMessage["role"], string]> = [
  ["user", "I want a sensor that tells me when my greenhouse soil is dry"],
  // One question a turn, as intake now asks them (decide.ts MAX_QUESTIONS_PER_ROUND).
  ["assistant", "Good brief. Will it be plugged in to USB power, or does it need to run on a battery?"],
  ["user", "Battery"],
  [
    "assistant",
    "Got it. Here's my plan:\n· ESP32-S3 brain (Wi-Fi on board)\n· 4× capacitive soil probes, one per bed\n· 18650 cell with a TP4056 charger, so there's no mains wiring\n· Readings every 10 min → your cloud dashboard\n\nSound right?",
  ],
  ["user", "go"],
  [
    "assistant",
    "Done — design finalized below. Firmware includes power-on self-test and free lifetime security patches.",
  ],
];

export function messages(buildId: string): MessageList | null {
  const conversation = conversations.get(buildId);
  if (conversation) return { messages: [...conversation.messages] };
  if (!buildDetail(buildId)) return null;
  if (buildId !== "greenhouse-soil") return { messages: [] };

  const count = GREENHOUSE_CONVERSATION.length;
  return {
    messages: GREENHOUSE_CONVERSATION.map(([role, text], i) => ({
      id: `msg_${i + 1}`,
      role,
      text,
      created_at: ago((count - i) * MINUTE),
    })),
  };
}

// --- landing carousel ---------------------------------------------------------

// --- build conversations (the landing chat) ------------------------------------

const DESIGN_READY: DeviceReadyCard = {
  name: "Greenhouse soil monitor",
  est_price_usd: 34,
  fulfillment_note: "ships in kit form",
  // Real registry ids, so the circuit diagram can be drawn from the parts rather
  // than mocked: the chips name what C-001/P-005/E-001/E-004 actually are.
  parts: [
    { part_id: "C-001", label: "ESP32-S3 brain", accent: "peach" },
    { part_id: "P-005", label: "Capacitive soil probe ×4", accent: "blue" },
    { part_id: "E-001", label: "18650 cell", accent: "green" },
    { part_id: "E-004", label: "TP4056 charger", accent: "violet" },
  ],
};

interface Conversation {
  messages: ChatMessage[];
  replies: number;
  updatedAt: number;
}

/**
 * Mock-only process state. Next compiles actions/RSC and route handlers into
 * separate module graphs: a module-local Map makes the SSE route return 404
 * for builds created by an action. Share the store (and ID sequence) across
 * those graphs. It remains bounded and is lost when this dev process exits.
 */
const mockProcess = globalThis as typeof globalThis & {
  __albusforgeMockBuilds?: { conversations: Map<string, Conversation>; sequence: number };
};
const buildStore = (mockProcess.__albusforgeMockBuilds ??= { conversations: new Map<string, Conversation>(), sequence: 0 });
const { conversations } = buildStore;
const MAX_CONVERSATIONS = 500;

/** How long the scripted reply takes, so typing dots and the event stream show. Immediate under vitest. */
const REPLY_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 1_500;

/** The prototype's three scripted replies, in order; the last repeats. */
const scriptedReplies = () =>
  GREENHOUSE_CONVERSATION.filter(([role]) => role === "assistant").map(([, text]) => text);

function appendMessage(conversation: Conversation, role: ChatMessage["role"], text: string, clientMessageId: string | null = null): ChatMessage {
  const message: ChatMessage = {
    id: `msg_${conversation.messages.length + 1}`,
    role,
    text,
    created_at: new Date().toISOString(),
    client_message_id: role === "user" ? clientMessageId : null,
  };
  conversation.messages.push(message);
  conversation.updatedAt = Date.now();
  return message;
}

function appendReply(conversation: Conversation): void {
  const replies = scriptedReplies();
  appendMessage(conversation, "assistant", replies[Math.min(conversation.replies, replies.length - 1)]!);
  conversation.replies += 1;
}

function scheduleReply(conversation: Conversation): void {
  if (REPLY_DELAY_MS === 0) appendReply(conversation);
  else setTimeout(() => appendReply(conversation), REPLY_DELAY_MS);
}

/**
 * POST /v1/builds: the ask becomes the first message, and the first scripted
 * reply follows. The same client_message_id again returns that build (replayed).
 */
export function createBuild(askText: string, clientMessageId: string | null = null): { build: CreatedBuild; replayed: boolean } {
  if (clientMessageId) {
    for (const [id, conversation] of conversations) {
      if (conversation.messages[0]?.client_message_id === clientMessageId) {
        return { build: { ...conversationDetail(id, conversation), build_id: id, status: statusOf(conversation) }, replayed: true };
      }
    }
  }
  if (conversations.size >= MAX_CONVERSATIONS) {
    const [oldest] = [...conversations.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    if (oldest) conversations.delete(oldest[0]);
  }
  buildStore.sequence += 1;
  const id = `bld_${Date.now().toString(36)}${buildStore.sequence}`;
  const conversation: Conversation = { messages: [], replies: 0, updatedAt: Date.now() };
  appendMessage(conversation, "user", askText, clientMessageId);
  conversations.set(id, conversation);
  const build = { ...conversationDetail(id, conversation), build_id: id, status: statusOf(conversation) };
  scheduleReply(conversation);
  return { build, replayed: false };
}

/** POST /v1/builds/:id/messages. Null for an unknown build; the same client_message_id again returns the stored message. */
export function postBuildMessage(buildId: string, text: string, clientMessageId: string): { message: ChatMessage; replayed: boolean } | null {
  const conversation = conversations.get(buildId);
  if (!conversation) return null;
  const existing = conversation.messages.find((message) => message.role === "user" && message.client_message_id === clientMessageId);
  if (existing) return { message: existing, replayed: true };
  const message = appendMessage(conversation, "user", text, clientMessageId);
  scheduleReply(conversation);
  return { message, replayed: false };
}

/** Gateway's status machine, as the prototype script walks it: specifying while a reply is due, asking, then planning. */
function statusOf(conversation: Conversation): BuildStatus {
  if (conversation.messages.at(-1)?.role === "user") return "specifying";
  return conversation.replies >= 3 ? "planning" : "asking";
}

/** Registry parts (the example builds' bundle) providing any of the capabilities, like gateway's capability match. */
function candidatesFor(capabilities: readonly string[]): CandidatePart[] {
  return [...EXAMPLE_PARTS.values()]
    .flatMap((part) => {
      const matched = part.software.capabilities.filter((capability) => capabilities.includes(capability)).sort();
      return matched.length ? [{ ...summarizePart(part), matched_capabilities: matched }] : [];
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The spec intake would have written after each scripted reply (mock only; shape as spec.ts drafts it). */
function specAfter(replies: number): Record<string, unknown> | null {
  if (replies === 0) return null;
  const capabilities = replies === 1 ? ["read.soil_moisture_pct"] : ["read.soil_moisture_pct", "net.wifi", "power.battery"];
  return {
    sense: { what: ["soil moisture"], interval_s: 600 },
    environment: { location: "greenhouse", flags: ["humid"] },
    connect: { transport: replies === 1 ? "none" : "wifi", experience: ["phone alerts"] },
    power: { source: replies === 1 ? "unknown" : "battery" },
    experience: { alerts: ["soil too dry"], dashboard: true },
    capabilities,
    assumptions: replies === 1 ? [] : ["Wi-Fi reaches the north wall", "One probe per bed"],
    // One question at a time, as intake now asks them, with one-tap answers where
    // the answer is a small closed set (decide.ts MAX_QUESTIONS_PER_ROUND).
    open_questions:
      replies === 1
        ? [{ field: "power.source", question: "Will it be plugged in to USB power, or does it need to run on a battery?", options: ["USB power", "Battery"] }]
        : replies === 2
          ? [{ field: "settled", question: "Sound right?", options: ["Go"] }]
          : [],
    settled: replies >= 3,
  };
}

/** Ready after the third exchange, as in the prototype. */
function conversationDetail(id: string, conversation: Conversation): BuildDetail {
  const ready = conversation.replies >= 3;
  const spec = specAfter(conversation.replies);
  return {
    id,
    name: ready ? DESIGN_READY.name : "New build",
    description: conversation.messages[0]?.text ?? "",
    display_status: "designing",
    device_count: 0,
    updated_at: new Date(conversation.updatedAt).toISOString(),
    ready: ready ? DESIGN_READY : null,
    status: statusOf(conversation),
    spec_version: conversation.replies > 0 ? conversation.replies : null,
    spec,
    candidate_parts: spec ? candidatesFor(spec.capabilities as string[]) : [],
  };
}

// --- fleet --------------------------------------------------------------------

const SOIL: Channel = { key: "soil_vwc", label: "Soil moisture", unit: "% VWC", kind: "number", precision: 1, valid_range: [0, 60] };
const FRIDGE_TEMP: Channel = { key: "temperature_c", label: "Temperature", unit: "°C", kind: "number", precision: 1, valid_range: [-30, 40] };

export function fleet(): Fleet {
  const result: Fleet = {
    stats: { device_count: 8, readings_per_day: 2400, online_ratio: 1 },
    systems: [
      {
        build_id: "greenhouse-soil",
        name: "Greenhouse soil monitor",
        location: "Home · 44.05°N 123.09°W",
        devices: [
          { id: "bed-a", name: "Bed A — soil probe", accent: "green", status: "online", value: "31.2", unit: "% VWC", metric: "Soil moisture", last_reading_at: ago(40), channel: SOIL },
          { id: "bed-b", name: "Bed B — soil probe", accent: "green", status: "online", value: "28.7", unit: "% VWC", metric: "Soil moisture", last_reading_at: ago(MINUTE), channel: SOIL },
          { id: "canopy", name: "Canopy — air sensor", accent: "blue", status: "online", value: "24.1", unit: "°C · 61% RH", metric: "Air temp + humidity", last_reading_at: ago(35) },
          { id: "north-gateway", name: "North wall — gateway", accent: "peach", status: "online", value: "2.4k", unit: "msgs/day", metric: "LoRa gateway", last_reading_at: ago(0) },
          // Provisioned, never powered on: the dashboard exists before the first reading.
          { id: "bed-c", name: "Bed C — soil probe", accent: "green", status: "never_seen", value: null, unit: null, metric: "Soil moisture", last_reading_at: null, channel: SOIL },
        ],
      },
      {
        build_id: "fridge-door",
        name: "Fridge door sentinel",
        location: "Home · kitchen",
        devices: [
          { id: "fridge", name: "Fridge — door + temp", accent: "blue", status: "online", value: "3.8", unit: "°C", metric: "Door closed · temp", last_reading_at: ago(12) },
          { id: "freezer", name: "Freezer — temp probe", accent: "violet", status: "online", value: "−18.2", unit: "°C", metric: "Temperature", last_reading_at: ago(30), channel: FRIDGE_TEMP },
          { id: "pantry-leak", name: "Pantry — leak sensor", accent: "green", status: "online", value: "DRY", unit: null, metric: "Water presence", last_reading_at: ago(2 * MINUTE) },
        ],
      },
    ],
  };
  for (const tile of result.systems.flatMap((system) => system.devices)) {
    const reading = liveReadings.get(tile.id);
    if (!reading || tile.channel?.key !== reading.channel || typeof reading.v !== "number") continue;
    tile.value = reading.v.toFixed(tile.channel.precision);
    tile.value_at = reading.t;
    tile.last_reading_at = reading.t;
    tile.status_at = reading.t;
  }
  return result;
}

// --- device dashboard ---------------------------------------------------------

const SOIL_24H = [
  42, 41, 40.5, 39, 38.6, 38, 37.2, 36.8, 36, 35.1, 34.8, 34, 33.5, 33.2, 32.8, 32.4, 32, 31.8, 31.5, 31.4, 31.3, 31.2,
];

/**
 * Every device gets Bed A's dashboard under its own name until per-part mocks
 * exist. A never-seen device gets the same derived widgets with `latest: {}`
 * and `series: []`.
 */
export function dashboard(deviceId: string): DeviceDashboard | null {
  const found = fleet()
    .systems.flatMap((system) => system.devices.map((device) => ({ device, buildId: system.build_id })))
    .find(({ device }) => device.id === deviceId);
  if (!found) return null;

  const { device, buildId } = found;
  const primary = device.channel ?? SOIL;
  const currentValue = device.value === null ? 31.2 : Number(device.value.replace("−", "-"));
  const primaryValue = Number.isFinite(currentValue) ? currentValue : 31.2;
  const last = SOIL_24H.length - 1;
  const reported = device.status !== "never_seen" && device.last_reading_at !== null;

  return {
    device: {
      id: device.id,
      build_id: buildId,
      name: device.name,
      status: device.status,
      last_reading_at: device.last_reading_at,
      status_at: device.status_at,
      chips: [
        { label: "Greenhouse — north wall", accent: "peach" },
        { label: `${primary.label} · ${primary.unit}`, accent: "blue" },
        { label: "fw 1.4.2 · ESP32", accent: "violet" },
      ],
    },
    channels: [
      primary,
      { key: "battery", label: "Battery", unit: "%", kind: "number", precision: 0, valid_range: [0, 100] },
      { key: "rssi", label: "Signal", unit: "dBm", kind: "number", precision: 0, valid_range: [-120, 0] },
      { key: "uptime", label: "Uptime", unit: "s", kind: "duration", precision: 0, valid_range: null },
      { key: "selftest", label: "Self-test", unit: "", kind: "status", precision: 0, valid_range: null },
    ],
    widgets: [
      { id: "w-soil", type: "line_chart", channel: primary.key, window: "24h", threshold: primary.key === SOIL.key ? { value: 22, label: "dry threshold · 22%" } : null },
      { id: "w-battery", type: "stat", channel: "battery", caption: "solar charging", caption_tone: "success" },
      { id: "w-rssi", type: "stat", channel: "rssi", caption: "Wi-Fi · strong" },
      { id: "w-uptime", type: "stat", channel: "uptime", caption: "since last patch" },
      { id: "w-selftest", type: "stat", channel: "selftest", caption: "all 6 checks", value_tone: "success" },
    ],
    latest: reported
      ? {
          [primary.key]: { v: primaryValue, t: device.value_at ?? device.last_reading_at! },
          battery: { v: 87, t: ago(40) },
          rssi: { v: -61, t: ago(40) },
          uptime: { v: 34 * DAY, t: ago(40) },
          selftest: { v: "PASS", t: ago(6 * HOUR) },
        }
      : {},
    series: reported
      ? [
          {
            channel: primary.key,
            bucket: "1h",
            points: SOIL_24H.map((v, i) => ({ t: ago(Math.round(((last - i) * DAY) / last)), v: primary.key === SOIL.key ? v : primaryValue })),
          },
        ]
      : [],
    greeting: !reported
      ? `Hi — I'm ${device.name}. I haven't sent a first reading yet — once I'm powered on, ask me anything.`
      : device.id === "bed-a"
        ? BED_A_GREETING
        : `Hi — I'm ${device.name}. Ask me anything about my readings.`,
      permissions: { edit_actions: true },
    ...actionsBlock(device.id),
  };
}

// --- closed-loop actions ------------------------------------------------------

/**
 * Mock mode's rule store: bed-a starts with the prototype's three rules,
 * every other device with none. Lives for the process, like the chat
 * transcripts, so a toggle survives a refresh.
 */
const actionStore = new Map<string, DeviceAction[]>();
const proposals = new Map<string, { deviceId: string; proposal: ActionProposal }>();
/** Confirmed proposals, kept so a retried confirmation returns the rule it already created (ADR 0010). */
const consumed = new Map<string, { deviceId: string; actionId: string; until: number }>();
const PROPOSAL_TTL_MS = 10 * MINUTE * 1000;

function actionsOf(deviceId: string): DeviceAction[] {
  let actions = actionStore.get(deviceId);
  if (!actions) {
    actions = deviceId === "bed-a" ? BED_A_ACTIONS.map((a) => ({ ...a, version: 1 })) : [];
    actionStore.set(deviceId, actions);
  }
  return actions;
}

function actionsBlock(deviceId: string): Pick<DeviceDashboard, "actions" | "last_action"> {
  const actions = actionsOf(deviceId);
  if (actions.length === 0) return {};
  return {
    actions: actions.map((a) => ({ ...a })),
    ...(deviceId === "bed-a" ? { last_action: { summary: "valve opened", at: yesterdayAt(6, 12) } } : {}),
  };
}

/** PATCH /v1/devices/:id/actions/:actionId. Null when the device or the rule is unknown. */
export function setActionEnabled(deviceId: string, actionId: string, enabled: boolean): DeviceAction | null {
  if (!dashboardExists(deviceId)) return null;
  const action = actionsOf(deviceId).find((a) => a.id === actionId);
  if (!action) return null;
  action.enabled = enabled;
  // The device picks the change up on its next check-in (CLOUD-PLATFORM.md §3.4); it acks this version.
  action.sync = "pending";
  action.version = (action.version ?? 0) + 1;
  return { ...action };
}

/** POST /v1/devices/:id/actions/proposals. Reads the words against the device's channels; writes nothing. */
export function proposeAction(deviceId: string, text: string): ActionProposal | null {
  const dash = dashboard(deviceId);
  if (!dash) return null;
  const reading = readRule(text, dash.channels);
  const proposal: ActionProposal = {
    id: `prop_${Date.now().toString(36)}_${proposals.size}`,
    ...reading,
    expires_at: new Date(Date.now() + PROPOSAL_TTL_MS).toISOString(),
  };
  proposals.set(proposal.id, { deviceId, proposal });
  return proposal;
}

export type ConfirmOutcome =
  | { ok: true; action: DeviceAction; created: boolean }
  | { ok: false; reason: "not_found" | "unresolved"; issues?: string[] };

/**
 * POST /v1/devices/:id/actions. A proposal is confirmed for the device it was
 * made for, before it expires. Confirming it again returns the rule it
 * created (`created: false`), so a retry after a lost response is safe.
 */
export function confirmAction(deviceId: string, proposalId: string): ConfirmOutcome {
  const done = consumed.get(proposalId);
  if (done && done.deviceId === deviceId && done.until > Date.now()) {
    const action = actionsOf(deviceId).find((a) => a.id === done.actionId);
    if (action) return { ok: true, action: { ...action }, created: false };
  }
  const held = proposals.get(proposalId);
  if (!held || held.deviceId !== deviceId || Date.parse(held.proposal.expires_at) < Date.now()) return { ok: false, reason: "not_found" };
  if (held.proposal.issues.length > 0) return { ok: false, reason: "unresolved", issues: held.proposal.issues };
  proposals.delete(proposalId);
  const { kind, rule, via } = held.proposal;
  const action: DeviceAction = { id: `act_${Date.now().toString(36)}_${actionsOf(deviceId).length}`, kind, rule, via, enabled: true, sync: "pending", version: 1 };
  actionsOf(deviceId).push(action);
  consumed.set(proposalId, { deviceId, actionId: action.id, until: Date.now() + PROPOSAL_TTL_MS });
  return { ok: true, action: { ...action }, created: true };
}

/** Tests only: the device acknowledged its rules, as cloudlink will record from an ingest (ADR 0010). */
export function ackActions(deviceId: string): void {
  for (const action of actionsOf(deviceId)) action.sync = "synced";
}

const dashboardExists = (deviceId: string) => fleet().systems.some((s) => s.devices.some((d) => d.id === deviceId));

/** Tests only: forget toggles, rules and proposals. */
export function resetActions(): void {
  actionStore.clear();
  proposals.clear();
  consumed.clear();
}

// --- marketplace --------------------------------------------------------------

const BED_A_GREETING =
  "Hi — I'm Bed A's soil probe. Moisture is 31.2% VWC, comfortably above your 22% dry threshold. Ask me anything.";

const BED_A_ACTIONS: DeviceAction[] = [
  { id: "act-irrigate", kind: "SERVO", rule: "Soil < 22% → open irrigation valve, 5 min", via: "micro-servo on GPIO 14 · max 3 cycles/day", enabled: true },
  { id: "act-exhaust", kind: "API", rule: "Canopy > 30°C → start exhaust fan", via: "via smart plug API (Home Assistant)", enabled: true },
  { id: "act-guardrail", kind: "ALERT", rule: "Still dry after 2 cycles → text me, pause watering", via: "guardrail — human takes over", enabled: false },
];

/** Yesterday at hh:mm, in the server's time zone (which also formats it). */
function yesterdayAt(hours: number, minutes: number): string {
  const at = new Date();
  at.setDate(at.getDate() - 1);
  at.setHours(hours, minutes, 0, 0);
  return at.toISOString();
}

export const DEVICE_REPLY =
  "Over the last 24h moisture dropped 4.1 points — normal evaporation for this heat. At the current rate you'll cross the 22% threshold in ~2 days. Want me to alert you at 24%?";

/** POST /v1/devices/:id/ask: the prototype's scripted answer, with the query it would have run. */
export function askDevice(deviceId: string): AskResponse | null {
  if (!dashboard(deviceId)) return null;
  return {
    message: { id: `ask_${Date.now().toString(36)}`, role: "assistant", text: DEVICE_REPLY, created_at: new Date().toISOString() },
    queries: [{ tool: "compare_to_baseline", input: { device_id: deviceId, channel: "soil_vwc", window: "24h" } }],
  };
}

// --- usage --------------------------------------------------------------------

export function usage(): Usage & UsageSummary {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    period: { start: start.toISOString(), end: end.toISOString() },
    as_of: now.toISOString(),
    model: {
      total: { calls: "12", input_tokens: "12000", output_tokens: "2400", cache_read_tokens: "3000", cache_creation_tokens: "1000", cost_usd: "0.123456" },
      stages: [{ stage: "intake", calls: "12", input_tokens: "12000", output_tokens: "2400", cache_read_tokens: "3000", cache_creation_tokens: "1000", cost_usd: "0.123456" }],
    },
    telemetry: { readings_in: "31200", payload_bytes: "48300000" },
    images: { accepted_count: "2880", accepted_bytes: "40573440" },
    tiers: {
      tier2: { model_calls: 1_840, tokens_in: 1_212_000, tokens_out: 96_400 },
      tier3: { model_calls: 37, tokens_in: 412_500, tokens_out: 28_900 },
    },
    readings_in: 31_200,
    bytes_stored: 48_300_000,
  };
}
