import { z } from "zod";

/**
 * Multi-turn device chat. Distinct from `sensor-ask`: that route classifies one
 * question into a closed intent and renders a template, so no model text ever
 * reaches a caller. This one lets the model write the reply, and constrains it
 * a different way — every number in that reply has to come back from a tool
 * call this service executed (CLOUD-PLATFORM.md section 2.2).
 */

const Time = z.iso.datetime({ offset: true });
/** Local to this module: `Channel` is already exported by `./fleet`. */
const ChannelKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

export const ConverseTurn = z.strictObject({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(4000),
});
export type ConverseTurn = z.infer<typeof ConverseTurn>;

/**
 * What the browser sends. History is replayed by the client every turn: this
 * service stores no conversation, so a reload starts a new one and nothing a
 * previous session said can be recovered from us.
 */
export const DeviceConverseInput = z
  .strictObject({
    question: z.string().trim().min(1).max(4000),
    /** Prior turns, oldest first. Bounded so one tab cannot grow a request without limit. */
    history: z.array(ConverseTurn).max(20).default([]),
  })
  .refine((body) => body.history.at(-1)?.role !== "user", {
    message: "History must not end with an unanswered question",
  });
export type DeviceConverseInput = z.infer<typeof DeviceConverseInput>;

/**
 * Trusted identity, assembled by the gateway. Never copied from a browser body.
 *
 * A turn is either signed in, carrying an actor, or public, carrying none —
 * and the refinement below says so in the same terms as the database's
 * `device_chat_identity` check, so a request that the ledger would reject is
 * rejected here first rather than at insert time.
 */
export const DeviceConverseRequest = DeviceConverseInput.safeExtend({
  request_id: z.uuid(),
  actor_id: z.uuid().nullable().default(null),
  /** Taken on the public showcase, where there is no signed-in caller at all. */
  public: z.boolean().default(false),
  tenant_id: z.uuid(),
  device_id: z.uuid(),
}).refine((body) => body.public === (body.actor_id === null), {
  message: "A public turn carries no actor, and a signed-in turn must carry one",
  path: ["actor_id"],
});
export type DeviceConverseRequest = z.infer<typeof DeviceConverseRequest>;

/**
 * One executed tool call, echoed back so the reply is auditable: the person can
 * see which window produced the number they were told.
 */
export const ConverseQuery = z.strictObject({
  tool: z.enum(["list_channels", "device_status", "query_window", "query_series"]),
  channel: ChannelKey.nullable(),
  from: Time.nullable(),
  to: Time.nullable(),
  /** Rows or samples the executor actually read. */
  points: z.number().int().min(0).max(100000).nullable(),
});
export type ConverseQuery = z.infer<typeof ConverseQuery>;

export const DeviceConverseResponse = z.strictObject({
  request_id: z.uuid(),
  device_id: z.uuid(),
  reply: z.string().max(8000),
  /**
   * `model` — the reply is the model's own words over executed queries.
   * `no_tool` — the model answered without reading anything; shown, but marked.
   * `unavailable` — the model or its deadline failed; a deterministic summary is returned instead.
   */
  mode: z.enum(["model", "no_tool", "unavailable"]),
  queries: z.array(ConverseQuery).max(24),
  limitations: z.array(z.string().max(500)).max(10),
});
export type DeviceConverseResponse = z.infer<typeof DeviceConverseResponse>;
