import type { ActionProposal, Channel, DeviceActionKind } from "@albusforge/schema";

/*
 * Mock mode's reading of a plain-words rule ("water for 5 min when soil drops
 * below 22%"). It stands in for the proposal step gateway will run against the
 * device's channels (PORTAL.md §3, ADR 0010): deterministic, so the composer's
 * behaviour — a normalized rule, a summary to confirm, issues that block
 * confirmation — can be exercised and tested without a model.
 */

interface Reading {
  kind: DeviceActionKind;
  rule: string;
  via: string;
  summary: string;
  issues: string[];
}

const COMPARATORS: Array<[RegExp, "<" | ">"]> = [
  [/\b(below|under|less than|drops? below|falls? below|lower than|<)\s*/i, "<"],
  [/\b(above|over|more than|exceeds?|rises? above|climbs? above|higher than|>)\s*/i, ">"],
];

/** Words a person uses for a channel, matched against the device's channel keys and labels. */
const CHANNEL_WORDS: Record<string, RegExp> = {
  soil_vwc: /\b(soil|moisture|vwc|dry|wet)\b/i,
  battery: /\b(battery|charge)\b/i,
  rssi: /\b(signal|wi-?fi|rssi)\b/i,
  temperature_c: /\b(temp(erature)?|°c|degrees|hot|cold|warm|canopy)\b/i,
  humidity: /\b(humidity|rh)\b/i,
};

const ALERT_WORDS = /\b(text|sms|email|alert|notify|tell|ping|call|warn|message)\b/i;
const API_WORDS = /\b(api|webhook|plug|home assistant|fan|heater|light|switch on|turn on|turn off|start|stop)\b/i;
const ACTUATOR_WORDS = /\b(water|open|close|valve|pump|servo|irrigat\w*|spray|vent)\b/i;

const MAX_ACTION_LENGTH = 60;

function splitCondition(text: string): { condition: string; action: string } {
  const m = /^(.*?)\b(when|if|once|whenever)\b(.*)$/i.exec(text);
  if (m) {
    const [, before, , after] = m;
    // "water for 5 min when soil drops below 22%" or "when soil drops below 22%, water for 5 min"
    return before!.trim() ? { action: before!.trim(), condition: after!.trim() } : splitAfter(after!.trim());
  }
  const arrow = text.split(/\s*(?:→|->|then)\s*/i);
  return arrow.length > 1 ? { condition: arrow[0]!.trim(), action: arrow.slice(1).join(" ").trim() } : { condition: text.trim(), action: "" };
}

/** "soil drops below 22%, water for 5 min" — the action follows a comma or "then". */
function splitAfter(rest: string): { condition: string; action: string } {
  const m = /^(.*?)(?:,|\bthen\b|\band\b)\s*(.*)$/i.exec(rest);
  return m && m[2]!.trim() ? { condition: m[1]!.trim(), action: m[2]!.trim() } : { condition: rest, action: "" };
}

function kindOf(action: string): DeviceActionKind {
  if (ALERT_WORDS.test(action)) return "ALERT";
  if (ACTUATOR_WORDS.test(action)) return "SERVO";
  if (API_WORDS.test(action)) return "API";
  return "ALERT";
}

const VIA: Record<DeviceActionKind, string> = {
  SERVO: "micro-servo on GPIO 14 · confirmed rule, runs on-device",
  API: "via smart plug API (Home Assistant)",
  ALERT: "notification to the tenant's contacts — human takes over",
};

const capitalize = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** Read a plain-words rule against the device's channels. Pure; the caller adds ids and expiry. */
export function readRule(text: string, channels: readonly Channel[]): Reading {
  const issues: string[] = [];
  const { condition, action } = splitCondition(text.trim().replace(/\s+/g, " "));

  const channel = channels.find((c) => CHANNEL_WORDS[c.key]?.test(condition) || new RegExp(`\\b${escape(c.label)}\\b`, "i").test(condition));
  const mentioned = Object.entries(CHANNEL_WORDS).find(([, words]) => words.test(condition))?.[0];
  if (!channel) {
    issues.push(
      mentioned
        ? `This device doesn't measure ${mentioned.replace(/_c$/, "").replace("_", " ")}. It has: ${channels.map((c) => c.label.toLowerCase()).join(", ")}.`
        : `I couldn't tell which reading the rule is about. This device has: ${channels.map((c) => c.label.toLowerCase()).join(", ")}.`,
    );
  }

  const comparator = COMPARATORS.find(([words]) => words.test(condition))?.[1] ?? null;
  const number = /(-?\d+(?:\.\d+)?)/.exec(condition);
  const value = number ? Number(number[1]) : null;
  if (comparator === null || value === null) issues.push("I couldn't find a threshold, like “below 22%” or “above 30 °C”.");
  if (channel && value !== null && channel.valid_range && (value < channel.valid_range[0] || value > channel.valid_range[1])) {
    issues.push(`${value} is outside ${channel.label.toLowerCase()}'s range of ${channel.valid_range[0]}–${channel.valid_range[1]} ${channel.unit}.`.replace(/\s+\.$/, "."));
  }

  if (!action) issues.push("Say what should happen, like “water for 5 min” or “text me”.");
  else if (action.length > MAX_ACTION_LENGTH) issues.push("Keep the action to one short phrase.");

  const kind = kindOf(action);
  const unit = channel?.unit ?? "";
  const threshold = value !== null && comparator ? `${comparator} ${value}${unit === "%" || unit.startsWith("%") ? "%" : unit ? ` ${unit}` : ""}` : "?";
  const subject = channel?.label ?? capitalize(condition);
  const rule = `${subject} ${threshold} → ${action || "?"}`;
  const summary =
    issues.length === 0
      ? `When ${subject.toLowerCase()} is ${comparator === "<" ? "below" : "above"} ${value}${unit ? ` ${unit}` : ""}, ${action}. ${
          kind === "ALERT" ? "A person is notified; nothing moves." : kind === "SERVO" ? "The device runs this on its own, even offline." : "The integration is called from the cloud."
        }`
      : "I need a bit more before this can be confirmed.";

  return { kind, rule, via: VIA[kind], summary, issues };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export type ProposalReading = Omit<ActionProposal, "id" | "expires_at">;
