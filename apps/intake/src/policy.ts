/**
 * The scope filter (ARCHITECTURE.md §7.1): runs on every user message before
 * any model call. Rules here are deliberately narrow, matching phrasings that
 * are unambiguous; anything they miss still meets the extract prompt's
 * boundaries and the model's own refusals. Categories are shared with
 * marketplace's listing safety classes (§3), so don't rename them.
 */

export const SCOPE_CATEGORIES = ["weapons_harm", "mains_voltage", "medical_monitoring", "covert_tracking"] as const;
export type ScopeCategory = (typeof SCOPE_CATEGORIES)[number];

export type ScopeDecision = { outcome: "ALLOW" } | { outcome: "OUT_OF_SCOPE"; code: "OUT_OF_SCOPE"; category: ScopeCategory };

interface Rule {
  category: ScopeCategory;
  /** Every pattern must match. */
  all: RegExp[];
  /** Any match here clears the rule. */
  unless?: RegExp;
}

const PERSON =
  /\b(?:wife|husband|partner|girlfriend|boyfriend|spouse|ex|kids?|child(?:ren)?|son|daughter|teen(?:ager)?s?|employees?|staff|workers?|roommates?|flatmates?|neighbou?rs?|tenants?|someone|somebody|people|person|him|her|them)\b/;

const RULES: Rule[] = [
  {
    category: "weapons_harm",
    all: [/\b(?:weapons?|firearms?|guns?|rifles?|pistols?|tasers?|explosives?|bombs?|detonators?|detonate|grenades?|ammunition|ammo)\b/],
    unless:
      /\b(?:glue|heat|nail|spray|staple|caulk|grease|massage|water|nerf|temperature|temp|thermometer|radar|soldering|paint)[ -]?guns?\b|\b(?:bath|seed|photo)[ -]?bombs?\b/,
  },
  {
    category: "weapons_harm",
    all: [
      /\b(?:hurt|harm|injure|shock|electrocute|zap|poison|attack|kill|maim)\b/,
      /\b(?:intruders?|burglars?|thie(?:f|ves)|trespassers?|people|person|someone|somebody|anyone|him|her|them|neighbou?rs?|cats?|dogs?|animals?|birds?|squirrels?)\b/,
    ],
  },
  {
    category: "mains_voltage",
    all: [
      /\bmains\b|\b(?:100|110|115|120|127|220|230|240)\s?-?\s?v(?:olts?|ac)?\b|\b(?:line|high)[ -]voltage\b|\bac (?:mains|line|voltage)\b|\b(?:light switch|breaker|fuse box|consumer unit)\b|\bwired? (?:in)?to (?:an? |the |my )?(?:wall )?(?:outlet|socket)\b|\bhard-?wired?\b/,
    ],
  },
  {
    category: "medical_monitoring",
    all: [
      /\b(?:medical|diagnos(?:e|es|is|ing|tic)|patients?|blood (?:pressure|sugar|glucose|oxygen)|glucose|insulin|heart ?rate|heartbeat|ecg|ekg|pulse ?ox(?:imeter)?|oximeter|spo2|seizures?|arrhythmias?|apnoea|apnea|vital signs|fall detection)\b/,
    ],
  },
  { category: "covert_tracking", all: [/\b(?:spy(?:ing)? on|stalk(?:ing|er)?)\b/] },
  {
    category: "covert_tracking",
    all: [
      /\b(?:secret(?:ly)?|covert(?:ly)?|hidden|hide|without (?:\w+ )?(?:knowing|noticing|consent|permission|knowledge)|won'?t (?:know|notice)|doesn'?t know|don'?t know)\b/,
      /\b(?:track|trace|follow|locate|location|gps|record|listen|eavesdrop|watch|film|camera|microphone|mic)\w*\b/,
      PERSON,
    ],
  },
];

/** Lowercased, NFKC-normalized, single-spaced: so fullwidth or odd spacing can't dodge a rule. */
export function normalize(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
}

export function screen(text: string): ScopeDecision {
  const normalized = normalize(text);
  for (const rule of RULES) {
    if (rule.all.every((pattern) => pattern.test(normalized)) && !(rule.unless?.test(normalized) ?? false)) {
      return { outcome: "OUT_OF_SCOPE", code: "OUT_OF_SCOPE", category: rule.category };
    }
  }
  return { outcome: "ALLOW" };
}
