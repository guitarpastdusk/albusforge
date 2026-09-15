import type { CandidatePart, ChatMessage, DeviceReadyCard } from "@albusforge/schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { mergeMessages, type BuildTranscript } from "@/lib/build-transcript";
import { CONNECTION_MESSAGE } from "@/lib/safe-action";
import { AnswerChoices } from "./AnswerChoices";
import { CandidateParts } from "./CandidateParts";
import { ChatBubble, TypingDots } from "./ChatBubble";
import {
  clientMessageIdFor,
  conversationReducer,
  initConversation,
  isTyping,
  OVERDUE_MESSAGE,
  runSend,
  type ConversationActions,
  type ConversationEvent,
  type ConversationState,
} from "./conversation";
import { DesignReadyCard } from "./DesignReadyCard";
import { assumptionsFor, cadence, cloudWorkspace, composerVisible, readyWiring } from "./ready-artifacts";
import { SpecPanel } from "./SpecPanel";

const AT = "2026-09-13T12:00:00Z";
const LATER = "2026-09-13T12:00:30Z";
const ID_1 = "11111111-1111-4111-8111-111111111111";
const ID_2 = "22222222-2222-4222-8222-222222222222";

const msg = (id: string, role: ChatMessage["role"], text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({ id, role, text, created_at: AT, ...extra });

const READY: DeviceReadyCard = {
  name: "Greenhouse soil monitor",
  est_price_usd: 34,
  fulfillment_note: "ships in kit form",
  parts: [
    { part_id: "esp32-wroom", label: "ESP32-WROOM", accent: "peach" },
    { part_id: "solar-lipo", label: "Solar + LiPo", accent: "green" },
  ],
};

const transcript = (messages: ChatMessage[], extra: Partial<BuildTranscript> = {}): BuildTranscript => ({
  buildId: "bld_1",
  messages,
  ready: null,
  status: "asking",
  specVersion: null,
  spec: null,
  candidateParts: [],
  ...extra,
});

/** Drive the reducer the way the provider does. */
function harness(initial?: Parameters<typeof initConversation>[0]) {
  let state: ConversationState = initConversation(initial);
  const dispatch = (event: ConversationEvent) => {
    state = conversationReducer(state, event);
  };
  return { dispatch, get state() { return state; } };
}

const actions = (overrides: Partial<ConversationActions>): ConversationActions => ({
  startBuild: vi.fn(),
  sendBuildMessage: vi.fn(),
  refreshBuild: vi.fn(),
  ...overrides,
});

describe("mergeMessages", () => {
  it("is unique by id, so a replayed transcript or event adds nothing", () => {
    const current = [msg("m1", "user", "hi"), msg("m2", "assistant", "hello", { created_at: LATER })];
    expect(mergeMessages(current, current)).toEqual(current);
  });

  it("replaces the optimistic copy with gateway's message carrying the same client_message_id", () => {
    const local = msg(`local-${ID_1}`, "user", "one bed", { client_message_id: ID_1, created_at: LATER });
    const merged = mergeMessages([msg("m1", "user", "hi"), local], [msg("m3", "user", "one bed", { client_message_id: ID_1, created_at: LATER })]);
    expect(merged.map((m) => m.id)).toEqual(["m1", "m3"]);
  });

  it("orders confirmed messages by time and keeps unconfirmed ones last", () => {
    const local = msg(`local-${ID_2}`, "user", "pending", { client_message_id: ID_2 });
    const merged = mergeMessages([local], [msg("m2", "assistant", "later", { created_at: LATER }), msg("m1", "user", "first")]);
    expect(merged.map((m) => m.id)).toEqual(["m1", "m2", `local-${ID_2}`]);
  });
});

describe("conversationReducer", () => {
  it("a send shows the message at once, clears the draft and starts typing", () => {
    const h = harness();
    h.dispatch({ type: "draft", text: "A soil sensor" });
    h.dispatch({ type: "sent", text: "A soil sensor", at: AT, clientMessageId: ID_1 });
    expect(h.state).toMatchObject({ draft: "", sending: true, error: null });
    expect(h.state.messages).toEqual([{ id: `local-${ID_1}`, role: "user", text: "A soil sensor", created_at: AT, client_message_id: ID_1 }]);
    expect(isTyping(h.state)).toBe(true);
  });

  it("the created build replaces the optimistic ask and brings its status, spec and candidates", () => {
    const h = harness();
    h.dispatch({ type: "sent", text: "A soil sensor", at: AT, clientMessageId: ID_1 });
    const spec = { settled: false };
    h.dispatch({ type: "created", transcript: transcript([msg("m1", "user", "A soil sensor", { client_message_id: ID_1 })], { spec, specVersion: 1 }) });
    expect(h.state).toMatchObject({ buildId: "bld_1", sending: false, status: "asking", spec, specVersion: 1 });
    expect(h.state.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(isTyping(h.state)).toBe(true);
  });

  it("the reply arrives on the stream: typing ends; replaying it changes nothing", () => {
    const h = harness({ buildId: "bld_1", messages: [msg("m1", "user", "hi")] });
    const reply = msg("m2", "assistant", "Good brief.", { created_at: LATER });
    h.dispatch({ type: "messageCreated", message: reply });
    h.dispatch({ type: "messageCreated", message: reply });
    expect(h.state.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(isTyping(h.state)).toBe(false);
  });

  it("an accepted send replaces its bubble even if the stream delivered it first", () => {
    const h = harness({ buildId: "bld_1", messages: [msg("m1", "user", "hi"), msg("m2", "assistant", "hello")] });
    h.dispatch({ type: "sent", text: "one bed", at: LATER, clientMessageId: ID_2 });
    const confirmed = msg("m3", "user", "one bed", { client_message_id: ID_2, created_at: LATER });
    h.dispatch({ type: "messageCreated", message: confirmed });
    h.dispatch({ type: "accepted", message: confirmed });
    expect(h.state.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(h.state.sending).toBe(false);
  });

  it("a failed send drops the bubble, gives the text back, and remembers its id for a retry of the same text", () => {
    const h = harness({ buildId: "bld_1", messages: [msg("m1", "user", "hi"), msg("m2", "assistant", "hello")] });
    h.dispatch({ type: "sent", text: "one bed", at: LATER, clientMessageId: ID_2 });
    h.dispatch({ type: "failed", message: "offline", text: "one bed", clientMessageId: ID_2 });
    expect(h.state).toMatchObject({ sending: false, error: "offline", draft: "one bed", unsent: { text: "one bed", clientMessageId: ID_2 } });
    expect(h.state.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(clientMessageIdFor(h.state.unsent, "one bed", () => ID_1)).toBe(ID_2);
    expect(clientMessageIdFor(h.state.unsent, "two beds", () => ID_1)).toBe(ID_1);
  });

  it("keeps a newer draft typed while the send was pending", () => {
    const h = harness();
    h.dispatch({ type: "sent", text: "first", at: AT, clientMessageId: ID_1 });
    h.dispatch({ type: "draft", text: "second thought" });
    h.dispatch({ type: "failed", message: "x", text: "first", clientMessageId: ID_1 });
    expect(h.state.draft).toBe("second thought");
  });

  it("overdue stops the dots and offers to check; a reply clears it; checking starts waiting again", () => {
    const h = harness({ buildId: "bld_1", messages: [msg("m1", "user", "hi")] });
    h.dispatch({ type: "overdue", message: OVERDUE_MESSAGE });
    expect(h.state).toMatchObject({ overdue: true, error: OVERDUE_MESSAGE });
    expect(isTyping(h.state)).toBe(false);

    h.dispatch({ type: "checking" });
    expect(h.state).toMatchObject({ overdue: false, error: null });
    expect(isTyping(h.state)).toBe(true);

    h.dispatch({ type: "overdue", message: OVERDUE_MESSAGE });
    h.dispatch({ type: "refreshed", transcript: transcript([msg("m1", "user", "hi"), msg("m2", "assistant", "hello", { created_at: LATER })]) });
    expect(h.state).toMatchObject({ overdue: false, error: null });
  });

  it("overdue is ignored when nothing is awaiting a reply; a failed check keeps the offer", () => {
    const answered = harness({ buildId: "bld_1", messages: [msg("m1", "user", "hi"), msg("m2", "assistant", "hello")] });
    answered.dispatch({ type: "overdue", message: OVERDUE_MESSAGE });
    expect(answered.state.overdue).toBe(false);

    const h = harness({ buildId: "bld_1", messages: [msg("m1", "user", "hi")] });
    h.dispatch({ type: "checking" });
    h.dispatch({ type: "refreshFailed", message: "We couldn’t load the latest reply." });
    expect(h.state).toMatchObject({ overdue: true, refreshError: "We couldn’t load the latest reply." });
  });

  it("build.updated records the observed version without claiming the details were hydrated", () => {
    const h = harness({ buildId: "bld_1" });
    h.dispatch({ type: "buildUpdated", status: "specifying", specVersion: 3 });
    expect(h.state).toMatchObject({ status: "specifying", observedSpecVersion: 3, specVersion: null, detailsStale: true });
  });
});

describe("runSend", () => {
  it("the first message creates the build and returns its transcript", async () => {
    const created = transcript([msg("m1", "user", "hi", { client_message_id: ID_1 })]);
    const h = harness();
    h.dispatch({ type: "sent", text: "hi", at: AT, clientMessageId: ID_1 });
    const start = vi.fn().mockResolvedValue({ ok: true, data: created });
    await expect(runSend(null, "hi", ID_1, actions({ startBuild: start }), h.dispatch)).resolves.toEqual(created);
    expect(start).toHaveBeenCalledWith("hi", ID_1);
    expect(h.state).toMatchObject({ buildId: "bld_1", sending: false });
  });

  it("a rejected call (network failure, aborted dispatch) restores the draft and shows a retryable message", async () => {
    const h = harness();
    h.dispatch({ type: "sent", text: "A soil sensor", at: AT, clientMessageId: ID_1 });
    await expect(runSend(null, "A soil sensor", ID_1, actions({ startBuild: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) }), h.dispatch)).resolves.toBeNull();
    expect(h.state).toMatchObject({ sending: false, error: CONNECTION_MESSAGE, draft: "A soil sensor", messages: [] });
  });

  it("a later message is accepted with gateway's copy; an { ok: false } result restores the draft", async () => {
    const h = harness({ buildId: "bld_1", messages: [msg("m1", "user", "hi"), msg("m2", "assistant", "hello")] });
    h.dispatch({ type: "sent", text: "one bed", at: LATER, clientMessageId: ID_2 });
    const confirmed = msg("m3", "user", "one bed", { client_message_id: ID_2, created_at: LATER });
    const send = vi.fn().mockResolvedValue({ ok: true, data: { message: confirmed } });
    await runSend("bld_1", "one bed", ID_2, actions({ sendBuildMessage: send }), h.dispatch);
    expect(send).toHaveBeenCalledWith("bld_1", "one bed", ID_2);
    expect(h.state.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);

    h.dispatch({ type: "messageCreated", message: msg("m4", "assistant", "ok", { created_at: LATER }) });
    h.dispatch({ type: "sent", text: "two", at: LATER, clientMessageId: ID_1 });
    await runSend("bld_1", "two", ID_1, actions({ sendBuildMessage: vi.fn().mockResolvedValue({ ok: false, message: "Still working on the last reply." }) }), h.dispatch);
    expect(h.state).toMatchObject({ error: "Still working on the last reply.", draft: "two" });
  });
});

describe("SpecPanel", () => {
  const SPEC = {
    sense: { what: ["soil moisture"], interval_s: 600 },
    act: { what: ["water pump"] },
    environment: { location: "indoor greenhouse", flags: ["humid"] },
    connect: { transport: "wifi", experience: ["phone alerts"] },
    power: { source: "unknown" },
    experience: { alerts: ["soil too dry"], dashboard: true },
    capabilities: ["read.soil_moisture_pct"],
    assumptions: ["Wi-Fi reaches the greenhouse"],
    open_questions: [{ field: "power.source", question: "Is there a USB power outlet near the plants, or should it run on battery?" }],
    settled: false,
  };
  const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

  it("shows what intake has understood and the assumptions, but not the open question", () => {
    const html = text(renderToStaticMarkup(<SpecPanel spec={SPEC} status="asking" />));
    expect(html).toContain("Spec so far");
    expect(html).toContain("Asking a few questions");
    expect(html).toContain("Senses soil moisture (every 10 min)");
    expect(html).toContain("Where indoor greenhouse (humid)");
    expect(html).toContain("Connects Wi-Fi, phone alerts");
    expect(html).toContain("Power Not decided yet");
    // The open question is asked in the chat, with its answers attached; the panel
    // is for what's settled, so it must not say the same sentence again.
    expect(html).not.toContain("Still to decide");
    expect(html).not.toContain("Is there a USB power outlet near the plants");
    expect(html).toContain("Assuming Wi-Fi reaches the greenhouse");
  });

  it("leaves out fields that don't match the draft shape, and renders nothing for no spec or an empty one", () => {
    const html = text(renderToStaticMarkup(<SpecPanel spec={{ ...SPEC, sense: "soil", connect: { transport: 7 }, settled: true }} status={null} />));
    expect(html).toContain("✓ Spec settled");
    expect(html).not.toContain("Senses");
    expect(html).toContain("Where indoor greenhouse");
    expect(renderToStaticMarkup(<SpecPanel spec={null} status="asking" />)).toBe("");
    expect(renderToStaticMarkup(<SpecPanel spec={{ settled: false }} status="asking" />)).toBe("");
  });
});

describe("CandidateParts", () => {
  it("says it's a capability match, not a plan, and lists each part with what it matched", () => {
    const part = {
      id: "P-005",
      version: "1.0.0",
      name: "Capacitive Soil Moisture Probe (DFRobot SEN0193)",
      category: "physical",
      status: "draft",
      successor: null,
      interface: "adc",
      capabilities: ["read.soil_moisture_pct"],
      unit_cost_usd: 5.9,
      matched_capabilities: ["read.soil_moisture_pct"],
    } as unknown as CandidatePart;
    const html = renderToStaticMarkup(<CandidateParts parts={[part]} />);
    expect(html).toContain("Not a final plan yet");
    expect(html).toContain("Capacitive Soil Moisture Probe (DFRobot SEN0193)");
    expect(html).toContain("read.soil_moisture_pct");
    expect(html).toContain("$5.90");
    expect(renderToStaticMarkup(<CandidateParts parts={[]} />)).toBe("");
  });
});

describe("chat markup", () => {
  it("puts the user on the right in ink and the assistant on the left in white", () => {
    expect(renderToStaticMarkup(<ChatBubble role="user" text="hi" />)).toMatch(/justify-end.*bg-ink/);
    expect(renderToStaticMarkup(<ChatBubble role="assistant" text="hello" />)).toMatch(/justify-start.*bg-white/);
  });

  it("renders three blinking dots while replying", () => {
    expect(renderToStaticMarkup(<TypingDots />).match(/animate-af-blink/g)).toHaveLength(3);
  });

  it("renders the device-ready card with price, parts and the sign-up gate", () => {
    const html = renderToStaticMarkup(<DesignReadyCard buildId="bld_1" card={READY} />);
    expect(html).not.toContain("enclosure");
    expect(html).toContain("✓ Device design ready");
    expect(html).toContain("est. $34 · ships in kit form");
    expect(html).toContain("ESP32-WROOM");
    expect(html).toMatch(/href="\/signup\?next=%2Fprojects%2Fbld_1"[^>]*>Sign up to continue →/);
  });
});

describe("DesignReadyCard enclosure preview", () => {
  it("offers the 3D viewer as a secondary action when a preview exists (mock mode)", async () => {
    const { ENCLOSURE_FIXTURE } = await import("@/components/enclosure/fixture");
    const html = renderToStaticMarkup(<DesignReadyCard buildId="bld_1" card={READY} enclosure={ENCLOSURE_FIXTURE} />);
    expect(html).toMatch(/<button type="button" aria-haspopup="dialog"[^>]*>View enclosure in 3D →<\/button>/);
    expect(html).toContain("Sign up to continue →");
  });

  it("says the preview isn't generated yet when there is none, and links nothing", () => {
    const html = renderToStaticMarkup(<DesignReadyCard buildId="bld_1" card={READY} enclosure={null} />);
    expect(html).toContain("3D preview available once the enclosure is generated");
    expect(html).not.toContain("View enclosure in 3D");
    expect(html).not.toContain(".glb");
  });

  it("a failed body read shows the message and a retry, and no preview button", async () => {
    const { ENCLOSURE_SAMPLE } = await import("@/components/enclosure/fixture");
    const html = renderToStaticMarkup(
      <DesignReadyCard buildId="bld_1" card={READY} enclosure={ENCLOSURE_SAMPLE} enclosureError="We couldn’t load the enclosure preview." onRetryEnclosure={() => {}} />,
    );
    expect(html).toContain("We couldn’t load the enclosure preview.");
    expect(html).toMatch(/<button type="button"[^>]*>Try again<\/button>/);
    expect(html).not.toContain("enclosure in 3D");
    expect(html).not.toContain(".glb");
  });

  it("the sample is the fixture, labelled, and the button says so", async () => {
    const { ENCLOSURE_SAMPLE, ENCLOSURE_FIXTURE } = await import("@/components/enclosure/fixture");
    expect(ENCLOSURE_SAMPLE.sample).toBe(true);
    expect(ENCLOSURE_SAMPLE.glbUrl).toBe(ENCLOSURE_FIXTURE.glbUrl);
    expect(ENCLOSURE_SAMPLE.description).toMatch(/^Sample enclosure\./);
    const html = renderToStaticMarkup(<DesignReadyCard buildId="bld_1" card={READY} enclosure={ENCLOSURE_SAMPLE} />);
    expect(html).toContain("View a sample enclosure in 3D →");
  });
});

describe("AnswerChoices", () => {
  const spec = (open_questions: unknown) => ({ capabilities: [], assumptions: [], open_questions });

  it("offers the options for the question intake is waiting on", () => {
    const html = renderToStaticMarkup(
      <AnswerChoices spec={spec([{ field: "power.source", question: "Will it run on USB power, or a battery?", options: ["USB power", "Battery"] }])} disabled={false} onChoose={() => {}} onContinue={() => {}} />,
    );
    expect(html).toContain("USB power");
    expect(html).toContain("Battery");
    // The question names the group, so a screen reader hears what is being answered.
    expect(html).toContain('aria-label="Will it run on USB power, or a battery?"');
  });

  it("sends the option verbatim, so the transcript reads as though it were typed", () => {
    const chosen: string[] = [];
    const markup = <AnswerChoices spec={spec([{ field: "power.source", question: "USB or battery?", options: ["USB power", "Battery"] }])} disabled={false} onChoose={(answer) => chosen.push(answer)} onContinue={() => {}} />;
    // Render to check the option text is exactly what would be sent.
    expect(renderToStaticMarkup(markup)).toContain(">Battery</button>");
    markup.props.onChoose("Battery");
    expect(chosen).toEqual(["Battery"]);
  });

  it("shows nothing when the question is open-ended", () => {
    expect(renderToStaticMarkup(<AnswerChoices spec={spec([{ field: "power.target_life_days", question: "How many days must it last?" }])} disabled={false} onChoose={() => {}} onContinue={() => {}} />)).toBe("");
  });

  it("shows nothing when there is no spec yet, and survives a spec it can't parse", () => {
    expect(renderToStaticMarkup(<AnswerChoices spec={null} disabled={false} onChoose={() => {}} onContinue={() => {}} />)).toBe("");
    expect(renderToStaticMarkup(<AnswerChoices spec={{ open_questions: "not a list" }} disabled={false} onChoose={() => {}} onContinue={() => {}} />)).toBe("");
  });

  it("disables the choices while a reply is in flight, so one tap can't send twice", () => {
    const html = renderToStaticMarkup(
      <AnswerChoices spec={spec([{ field: "power.source", question: "USB or battery?", options: ["USB power", "Battery"] }])} disabled onChoose={() => {}} onContinue={() => {}} />,
    );
    // The attribute itself, not the `disabled:` Tailwind variants in the class list.
    // Two answers plus "Continue chatting": nothing is clickable mid-send.
    expect(html.match(/disabled=""/g)).toHaveLength(3);
  });
});

describe("AnswerChoices · continue chatting", () => {
  const withOptions = { capabilities: [], assumptions: [], open_questions: [{ field: "settled", question: "Sound right?", options: ["Go"] }] };

  it("offers a single option alongside a way back to typing", () => {
    const html = renderToStaticMarkup(<AnswerChoices spec={withOptions} disabled={false} onChoose={() => {}} onContinue={() => {}} />);
    expect(html).toContain(">Go</button>");
    expect(html).toContain(">Continue chatting</button>");
  });

  it("continuing sends nothing: it only reopens the reply box", () => {
    const sent: string[] = [];
    let continued = 0;
    const markup = <AnswerChoices spec={withOptions} disabled={false} onChoose={(answer) => sent.push(answer)} onContinue={() => (continued += 1)} />;
    markup.props.onContinue();
    expect(continued).toBe(1);
    expect(sent).toEqual([]);
  });
});

describe("ready artifacts", () => {
  const READY_REGISTRY: DeviceReadyCard = {
    name: "Greenhouse soil monitor",
    est_price_usd: 34,
    fulfillment_note: "ships in kit form",
    parts: [
      { part_id: "C-001", label: "ESP32-S3 brain", accent: "peach" },
      { part_id: "P-005", label: "Capacitive soil probe ×4", accent: "blue" },
      { part_id: "E-001", label: "18650 cell", accent: "green" },
      { part_id: "E-004", label: "TP4056 charger", accent: "violet" },
    ],
  };

  it("draws the real circuit diagram from the card's own registry parts", () => {
    const wiring = readyWiring(READY_REGISTRY);
    expect(wiring).not.toBeNull();
    expect(wiring!.brain.id).toBe("C-001");
    // The card has no quantity field, so four probes come from the fixture.
    expect(wiring!.nodes.find((n) => n.part.id === "P-005")!.units).toHaveLength(4);
  });

  it("says nothing rather than guessing when the parts aren't registry parts", () => {
    expect(readyWiring({ ...READY_REGISTRY, parts: [{ part_id: "esp32-wroom", label: "ESP32-WROOM", accent: "peach" }] })).toBeNull();
  });

  it("reads what the device will send from the spec, and leaves it empty when there is no spec", () => {
    expect(cloudWorkspace({ capabilities: ["read.soil_moisture_pct", "net.wifi"], sense: { interval_s: 600 } })).toEqual({
      channels: ["soil moisture %"],
      everySeconds: 600,
    });
    expect(cloudWorkspace(null)).toEqual({ channels: [], everySeconds: null });
  });

  it("spells a cadence the way a person would say it", () => {
    expect(cadence(600)).toBe("every 10 minutes");
    expect(cadence(60)).toBe("every 1 minute");
    expect(cadence(3600)).toBe("every 1 hour");
    expect(cadence(45)).toBe("every 45 seconds");
  });

  it("shows all three artifacts on the ready card", () => {
    const html = renderToStaticMarkup(
      <DesignReadyCard card={READY_REGISTRY} buildId="b1" signedIn={false} spec={{ capabilities: ["read.soil_moisture_pct"], sense: { interval_s: 600 } }} enclosure={null} />,
    );
    expect(html).toContain("3D enclosure");
    expect(html).toContain("Circuit diagram");
    expect(html).toContain("Cloud workspace");
    expect(html).toContain("Created when you sign up");
    expect(html).toContain("soil moisture %");
    expect(html).toContain("every 10 minutes");
  });
});

describe("review fixes for #103", () => {
  const card = (parts: DeviceReadyCard["parts"]): DeviceReadyCard => ({ name: "Build", est_price_usd: 34, fulfillment_note: "kit", parts });

  it("draws nothing when any part on the card is not a registry part", () => {
    // The brain and supply are both present, so the old filter still drew a
    // diagram and silently dropped the sensor the card actually names.
    const mixed = card([
      { part_id: "C-001", label: "ESP32-S3", accent: "peach" },
      { part_id: "E-001", label: "18650", accent: "green" },
      { part_id: "X-999", label: "New sensor", accent: "blue" },
    ]);
    expect(readyWiring(mixed)).toBeNull();
    expect(readyWiring(card([]))).toBeNull();
  });

  it("states what it assumed, so the viewer reads it and not just the source", () => {
    const assumed = assumptionsFor(card([
      { part_id: "C-001", label: "ESP32-S3", accent: "peach" },
      { part_id: "P-005", label: "probe", accent: "blue" },
      { part_id: "E-001", label: "cell", accent: "green" },
    ]));
    expect(assumed.some((line) => line.startsWith("4 × "))).toBe(true);
    expect(assumed.some((line) => line.includes("5v-pin"))).toBe(true);
  });

  it("reopens the composer per question instance, not per wording", () => {
    // Same words, a new message: the box must close again.
    expect(composerVisible({ hasOptions: true, questionKey: "m1", typingFor: "m1" })).toBe(true);
    expect(composerVisible({ hasOptions: true, questionKey: "m2", typingFor: "m1" })).toBe(false);
    // No question with answers: the box is simply there.
    expect(composerVisible({ hasOptions: false, questionKey: "m2", typingFor: null })).toBe(true);
    expect(composerVisible({ hasOptions: true, questionKey: null, typingFor: null })).toBe(false);
  });

  it("labels the diagram as example wiring on the card", () => {
    const html = renderToStaticMarkup(
      <DesignReadyCard
        card={card([
          { part_id: "C-001", label: "ESP32-S3", accent: "peach" },
          { part_id: "P-005", label: "probe", accent: "blue" },
          { part_id: "E-001", label: "cell", accent: "green" },
        ])}
        buildId="b1"
        signedIn={false}
        spec={null}
      />,
    );
    expect(html).toContain("Example wiring");
    expect(html).toContain("Check these before building");
  });
});
