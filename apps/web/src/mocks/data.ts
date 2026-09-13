import type {
  AskResponse,
  BuildDetail,
  BuildList,
  BuildSummary,
  ChatMessage,
  CreateBuildResponse,
  DeviceAction,
  DeviceDashboard,
  DeviceReadyCard,
  Fleet,
  Listing,
  ListingList,
  Me,
  MessageList,
  Showcase,
  Usage,
} from "@albusforge/schema";

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
  [
    "assistant",
    "Good brief. Two quick questions:\n· How large is the area — one bed or the whole greenhouse?\n· Do you have Wi-Fi coverage out there, or should I plan for LoRa?",
  ],
  ["user", "The whole greenhouse — four beds. Wi-Fi reaches the north wall."],
  [
    "assistant",
    "Got it. Here's my plan:\n· ESP32-WROOM brain (pre-certified radio)\n· 4× capacitive soil probes, one per bed\n· Solar + LiPo so there's no wiring\n· Readings every 10 min → your cloud dashboard\n\nSound right? Say \"go\" and I'll finalize the design.",
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
  parts: [
    { part_id: "esp32-wroom", label: "ESP32-WROOM", accent: "peach" },
    { part_id: "soil-capacitive", label: "Capacitive soil probe ×4", accent: "blue" },
    { part_id: "solar-lipo", label: "Solar + LiPo", accent: "green" },
    { part_id: "enclosure-ip65", label: "IP65 printed enclosure", accent: "violet" },
  ],
};

interface Conversation {
  messages: ChatMessage[];
  replies: number;
  updatedAt: number;
}

/** In-process, mock mode only. Bounded so a long-running dev server can't grow it forever. */
const conversations = new Map<string, Conversation>();
const MAX_CONVERSATIONS = 500;
let conversationSeq = 0;

/** The prototype's three scripted replies, in order; the last repeats. */
const scriptedReplies = () =>
  GREENHOUSE_CONVERSATION.filter(([role]) => role === "assistant").map(([, text]) => text);

function appendMessage(conversation: Conversation, role: ChatMessage["role"], text: string): void {
  conversation.messages.push({
    id: `msg_${conversation.messages.length + 1}`,
    role,
    text,
    created_at: new Date().toISOString(),
  });
  conversation.updatedAt = Date.now();
}

function appendReply(conversation: Conversation): void {
  const replies = scriptedReplies();
  appendMessage(conversation, "assistant", replies[Math.min(conversation.replies, replies.length - 1)]!);
  conversation.replies += 1;
}

/** POST /v1/builds: the ask becomes the first message, and the first scripted reply follows. */
export function createBuild(askText: string): CreateBuildResponse {
  if (conversations.size >= MAX_CONVERSATIONS) {
    const [oldest] = [...conversations.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    if (oldest) conversations.delete(oldest[0]);
  }
  conversationSeq += 1;
  const id = `bld_${Date.now().toString(36)}${conversationSeq}`;
  const conversation: Conversation = { messages: [], replies: 0, updatedAt: Date.now() };
  appendMessage(conversation, "user", askText);
  appendReply(conversation);
  conversations.set(id, conversation);
  return { build_id: id, status: "designing" };
}

/** POST /v1/builds/:id/messages. False for an unknown build. */
export function postBuildMessage(buildId: string, text: string): boolean {
  const conversation = conversations.get(buildId);
  if (!conversation) return false;
  appendMessage(conversation, "user", text);
  appendReply(conversation);
  return true;
}

/** Ready after the third exchange, as in the prototype. */
function conversationDetail(id: string, conversation: Conversation): BuildDetail {
  const ready = conversation.replies >= 3;
  return {
    id,
    name: ready ? DESIGN_READY.name : "New build",
    description: conversation.messages[0]?.text ?? "",
    display_status: "designing",
    device_count: 0,
    updated_at: new Date(conversation.updatedAt).toISOString(),
    ready: ready ? DESIGN_READY : null,
  };
}

export function showcase(): Showcase {
  return {
    cards: [
      {
        id: "sc-greenhouse",
        name: "Greenhouse soil monitor",
        accent: "green",
        reading: "31.2% VWC",
        chain: ["soil probe ×4", "ESP32", "cloud"],
        caption: "Soil moisture · solar powered",
        last_reading_at: ago(40),
      },
      {
        id: "sc-fridge",
        name: "Fridge door sentinel",
        accent: "blue",
        reading: "3.8°C",
        chain: ["hall sensor", "ESP32-C3", "SMS"],
        caption: "Door + temperature",
        last_reading_at: ago(12),
      },
      {
        id: "sc-compressor",
        name: "Compressor vibration watch",
        accent: "peach",
        reading: "0.9 mm/s",
        chain: ["accel", "FFT on-device", "alert"],
        caption: "Bearing-wear anomaly",
        last_reading_at: ago(5),
      },
      {
        id: "sc-beehive",
        name: "Beehive scale + temp",
        accent: "violet",
        reading: "41.6 kg",
        chain: ["load cells", "nRF52840", "LoRa"],
        caption: "Hive weight + brood temp",
        last_reading_at: ago(2 * MINUTE),
      },
      {
        id: "sc-sump",
        name: "Sump pump failover",
        accent: "blue",
        reading: "DRY",
        chain: ["level probe", "current clamp", "siren"],
        caption: "Water level + pump draw",
        last_reading_at: ago(30),
      },
      {
        id: "sc-cold-room",
        name: "Cold-room logger",
        accent: "peach",
        reading: "−18.2°C",
        chain: ["PT100", "ESP32", "signed log"],
        caption: "Audit-grade temperature",
        last_reading_at: ago(15),
      },
    ],
  };
}

// --- fleet --------------------------------------------------------------------

export function fleet(): Fleet {
  return {
    stats: { device_count: 8, readings_per_day: 2400, online_ratio: 1 },
    systems: [
      {
        build_id: "greenhouse-soil",
        name: "Greenhouse soil monitor",
        location: "Home · 44.05°N 123.09°W",
        devices: [
          { id: "bed-a", name: "Bed A — soil probe", accent: "green", status: "online", value: "31.2", unit: "% VWC", metric: "Soil moisture", last_reading_at: ago(40) },
          { id: "bed-b", name: "Bed B — soil probe", accent: "green", status: "online", value: "28.7", unit: "% VWC", metric: "Soil moisture", last_reading_at: ago(MINUTE) },
          { id: "canopy", name: "Canopy — air sensor", accent: "blue", status: "online", value: "24.1", unit: "°C · 61% RH", metric: "Air temp + humidity", last_reading_at: ago(35) },
          { id: "north-gateway", name: "North wall — gateway", accent: "peach", status: "online", value: "2.4k", unit: "msgs/day", metric: "LoRa gateway", last_reading_at: ago(0) },
          // Provisioned, never powered on: the dashboard exists before the first reading.
          { id: "bed-c", name: "Bed C — soil probe", accent: "green", status: "never_seen", value: null, unit: null, metric: "Soil moisture", last_reading_at: null },
        ],
      },
      {
        build_id: "fridge-door",
        name: "Fridge door sentinel",
        location: "Home · kitchen",
        devices: [
          { id: "fridge", name: "Fridge — door + temp", accent: "blue", status: "online", value: "3.8", unit: "°C", metric: "Door closed · temp", last_reading_at: ago(12) },
          { id: "freezer", name: "Freezer — temp probe", accent: "violet", status: "online", value: "−18.2", unit: "°C", metric: "Temperature", last_reading_at: ago(30) },
          { id: "pantry-leak", name: "Pantry — leak sensor", accent: "green", status: "online", value: "DRY", unit: null, metric: "Water presence", last_reading_at: ago(2 * MINUTE) },
        ],
      },
    ],
  };
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
  const last = SOIL_24H.length - 1;
  const reported = device.status !== "never_seen" && device.last_reading_at !== null;

  return {
    device: {
      id: device.id,
      build_id: buildId,
      name: device.name,
      status: device.status,
      last_reading_at: device.last_reading_at,
      chips: [
        { label: "Greenhouse — north wall", accent: "peach" },
        { label: "Soil moisture · VWC %", accent: "blue" },
        { label: "fw 1.4.2 · ESP32", accent: "violet" },
      ],
    },
    channels: [
      { key: "soil_vwc", label: "Soil moisture", unit: "% VWC", kind: "number", precision: 1, valid_range: [0, 60] },
      { key: "battery", label: "Battery", unit: "%", kind: "number", precision: 0, valid_range: [0, 100] },
      { key: "rssi", label: "Signal", unit: "dBm", kind: "number", precision: 0, valid_range: [-120, 0] },
      { key: "uptime", label: "Uptime", unit: "s", kind: "duration", precision: 0, valid_range: null },
      { key: "selftest", label: "Self-test", unit: "", kind: "status", precision: 0, valid_range: null },
    ],
    widgets: [
      { id: "w-soil", type: "line_chart", channel: "soil_vwc", window: "24h", threshold: { value: 22, label: "dry threshold · 22%" } },
      { id: "w-battery", type: "stat", channel: "battery", caption: "solar charging", caption_tone: "success" },
      { id: "w-rssi", type: "stat", channel: "rssi", caption: "Wi-Fi · strong" },
      { id: "w-uptime", type: "stat", channel: "uptime", caption: "since last patch" },
      { id: "w-selftest", type: "stat", channel: "selftest", caption: "all 6 checks", value_tone: "success" },
    ],
    latest: reported
      ? {
          soil_vwc: { v: 31.2, t: ago(40) },
          battery: { v: 87, t: ago(40) },
          rssi: { v: -61, t: ago(40) },
          uptime: { v: 34 * DAY, t: ago(40) },
          selftest: { v: "PASS", t: ago(6 * HOUR) },
        }
      : {},
    series: reported
      ? [
          {
            channel: "soil_vwc",
            bucket: "1h",
            points: SOIL_24H.map((v, i) => ({ t: ago(Math.round(((last - i) * DAY) / last)), v })),
          },
        ]
      : [],
    greeting: !reported
      ? `Hi — I'm ${device.name}. I haven't sent a first reading yet — once I'm powered on, ask me anything.`
      : device.id === "bed-a"
        ? BED_A_GREETING
        : `Hi — I'm ${device.name}. Ask me anything about my readings.`,
    ...(device.id === "bed-a" ? { actions: BED_A_ACTIONS, last_action: { summary: "valve opened", at: yesterdayAt(6, 12) } } : {}),
  };
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

// --- marketplace listings -------------------------------------------------------

const LISTINGS: Listing[] = [
  { id: "greenhouse-soil-monitor", name: "Greenhouse soil monitor", category: "garden", accent: "green", description: "Solar 4-probe moisture rig with dry-threshold alerts. The build this site was born from.", author: { handle: "maya" }, remix_count: 412 },
  { id: "fridge-door-sentinel", name: "Fridge door sentinel", category: "home", accent: "blue", description: "Texts you when the door is open 90+ seconds. Saves a fridge of groceries once a year.", author: { handle: "tomek" }, remix_count: 388 },
  { id: "compressor-vibration-watch", name: "Compressor vibration watch", category: "workshop", accent: "peach", description: "On-device FFT catches bearing wear weeks early. Runs fully local, cloud optional.", author: { handle: "ines" }, remix_count: 201 },
  { id: "beehive-scale-temp", name: "Beehive scale + temp", category: "garden", accent: "violet", description: "Weight trend spots swarms and honey flow; brood temp guards winter clusters.", author: { handle: "arvid" }, remix_count: 176 },
  { id: "sump-pump-failover", name: "Sump pump failover alarm", category: "home", accent: "blue", description: "Water level + current draw; screams before the basement floods, not after.", author: { handle: "june" }, remix_count: 154 },
  { id: "cold-room-logger", name: "Cold-room compliance logger", category: "industrial", accent: "peach", description: "Audit-grade temperature log with signed records and monthly PDF export.", author: { handle: "osei" }, remix_count: 97 },
  { id: "the-vibration-prophet", name: "The Vibration Prophet", category: "industrial", accent: "violet", description: "ADXL355 + ESP32 learns each motor's signature and flags drift early. ~$51/machine.", author: { handle: "priya" }, remix_count: 88 },
  { id: "the-thermal-watchman", name: "The Thermal Watchman", category: "industrial", accent: "peach", description: "MLX90640 heat map finds breaker-panel hot spots weeks before the fire. ~$90/panel.", author: { handle: "marco" }, remix_count: 76 },
  { id: "the-cold-chain-witness", name: "The Cold Chain Witness", category: "industrial", accent: "blue", description: "SHT31 + GPS + LTE-M signed 2–8°C custody log, dock to dock. ~$84/pallet.", author: { handle: "lena" }, remix_count: 71 },
  { id: "the-tank-teller", name: "The Tank Teller", category: "industrial", accent: "green", description: "Off-grid ultrasonic level over cellular; refill orders fire at threshold. ~$97/tank.", author: { handle: "sam" }, remix_count: 64 },
  { id: "the-blind-corner-beacon", name: "The Blind Corner Beacon", category: "industrial", accent: "peach", description: "mmWave radar lights the floor before the forklift arrives. ~$46/corner.", author: { handle: "kai" }, remix_count: 59 },
  { id: "the-air-marshal", name: "The Air Marshal", category: "industrial", accent: "green", description: "PMS5003 + SCD40 traffic-light air quality the whole shop can see. ~$68/zone.", author: { handle: "ines" }, remix_count: 52 },
];

const LISTING_PAGE = 12;

/** GET /v1/listings?tags=&cursor=&limit= — filtered before paging, so a category's matches are never lost to the page size. */
export function listingList(tags: string | null, cursor: string | null = null, limit: string | null = null): ListingList {
  const wanted = tags?.split(",").filter(Boolean) ?? [];
  const matching = wanted.length ? LISTINGS.filter((l) => wanted.includes(l.category)) : LISTINGS;
  const offset = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
  const size = limit && /^\d+$/.test(limit) ? Math.min(Math.max(Number(limit), 1), 50) : LISTING_PAGE;
  const end = offset + size;
  return { listings: matching.slice(offset, end), next_cursor: end < matching.length ? String(end) : null };
}

export function listing(id: string): Listing | null {
  return LISTINGS.find((l) => l.id === id) ?? null;
}

// --- usage --------------------------------------------------------------------

export function usage(): Usage {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    period: { start: start.toISOString(), end: end.toISOString() },
    tiers: {
      tier2: { model_calls: 1_840, tokens_in: 1_212_000, tokens_out: 96_400 },
      tier3: { model_calls: 37, tokens_in: 412_500, tokens_out: 28_900 },
    },
    readings_in: 31_200,
    bytes_stored: 48_300_000,
  };
}
