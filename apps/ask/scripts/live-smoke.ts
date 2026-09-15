/*
 * Live smoke: one device chat end to end against the real model and a local
 * database. Never run in CI; it spends money. Not imported by anything.
 *
 *   docker compose up -d postgres   # then migrate (see README)
 *   DB_HOST=localhost DB_NAME=albus DB_USER=albus_app DB_PASSWORD=albus_app DB_SSL=disable \
 *   ANTHROPIC_API_KEY=... \
 *     pnpm --filter ask smoke:live -- --ask "How has it changed today?"
 *
 * Options:
 *   --ask TEXT      the question (default: a trend question over two channels)
 *   --then TEXT     a follow-up, sent with the first exchange as history
 *   --hours N       hours of synthetic readings to seed (default 48)
 *   --record DIR    write each model response as <DIR>/<n>.json (responses only:
 *                   no request, no headers, nothing that carries the key)
 *   --keep          leave the fixture device behind instead of deleting it
 *
 * Seeds its own device, channels, readings and hourly rollups, so the only
 * prerequisite is a migrated database. Prints the reply, every tool call the
 * model chose with the window it asked for, and per-call tokens and cost.
 * Never prints the key.
 *
 * What this is for: the loop is unit-tested against fakes, so what it cannot
 * tell us is whether the model picks sensible windows unprompted, whether the
 * iteration cap is right, and what a turn actually costs. Read the tool calls,
 * not just the reply.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createDb, dbConfigFromEnv } from "@albusforge/db";
import { createProvider } from "@albusforge/llm";
import { recordingProvider } from "@albusforge/llm/testing";
import type { ConverseTurn, DeviceConverseRequest } from "@albusforge/schema";
import { converse } from "../src/converse";
import { createConverseStore } from "../src/converse-store";

type Pool = ReturnType<typeof createDb>["pool"];

const DEFAULT_ASK = "How has the temperature changed over the last day, and is the humidity tracking it?";

async function main() {
  if (process.env.CI) throw new Error("live-smoke calls the real API and never runs in CI");
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");

  const { values } = parseArgs({
    options: {
      ask: { type: "string" },
      then: { type: "string" },
      hours: { type: "string" },
      record: { type: "string" },
      keep: { type: "boolean" },
    },
  });
  const question = values.ask ?? DEFAULT_ASK;
  const hours = Number(values.hours ?? 48);
  const model = process.env.CHAT_MODEL ?? "claude-sonnet-5";

  let recorded = 0;
  const recordDir = values.record ? path.resolve(values.record) : undefined;
  if (recordDir) mkdirSync(recordDir, { recursive: true });
  const provider = recordingProvider(createProvider("anthropic", { apiKey }), (_request, response) => {
    recorded++;
    if (recordDir) writeFileSync(path.join(recordDir, `${recorded}.json`), `${JSON.stringify(response, null, 2)}\n`);
  });

  const { pool } = createDb(dbConfigFromEnv(process.env), { max: 4 });
  const tenantId = randomUUID(),
    actorId = randomUUID(),
    deviceId = randomUUID();

  try {
    await seed(pool, { tenantId, actorId, deviceId, hours });
    const store = createConverseStore(pool, { user: 1000, tenant: 1000, global: 1000 });

    const spend: { model: string; in: number; out: number; cacheRead: number; cost: number }[] = [];
    const options = {
      store,
      provider,
      model,
      maxTokens: 1024,
      maxIterations: Number(process.env.CHAT_MAX_ITERATIONS ?? 5),
      write: (line: string) => {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.model) {
          spend.push({
            model: String(entry.model),
            in: Number(entry.input_tokens ?? 0),
            out: Number(entry.output_tokens ?? 0),
            cacheRead: Number(entry.cache_read_input_tokens ?? 0),
            cost: Number(entry.cost_usd ?? 0),
          });
        }
      },
    };

    const history: ConverseTurn[] = [];
    for (const text of [question, values.then].filter((value): value is string => Boolean(value))) {
      const request: DeviceConverseRequest = {
        question: text,
        history: [...history],
        request_id: randomUUID(),
        actor_id: actorId,
        tenant_id: tenantId,
        device_id: deviceId,
      };
      console.log(`\n> ${text}`);
      const started = Date.now();
      const answer = await converse(request, options, AbortSignal.timeout(60_000));
      const elapsed = Date.now() - started;

      console.log(`\n${answer.reply}\n`);
      console.log(`mode: ${answer.mode}  ·  ${elapsed} ms`);
      if (answer.queries.length) {
        console.log("tool calls the model chose:");
        for (const query of answer.queries) {
          const window =
            query.from && query.to
              ? `${query.channel ?? "-"} ${query.from} -> ${query.to} (${query.points ?? "?"} pts)`
              : "-";
          console.log(`  ${query.tool.padEnd(14)} ${window}`);
        }
      } else {
        console.log("tool calls: none - the model answered without reading anything");
      }
      history.push({ role: "user", text }, { role: "assistant", text: answer.reply });
    }

    const total = spend.reduce((sum, call) => sum + call.cost, 0);
    console.log(`\nmodel calls: ${spend.length}`);
    for (const [index, call] of spend.entries()) {
      console.log(
        `  ${index + 1}. ${call.model}  in ${call.in} (cache read ${call.cacheRead})  out ${call.out}  $${call.cost.toFixed(6)}`,
      );
    }
    console.log(`turn cost: $${total.toFixed(6)}`);
    if (recorded) console.log(`recorded ${recorded} response(s)${recordDir ? ` to ${recordDir}` : ""}`);
  } finally {
    if (!values.keep) await cleanup(pool, { tenantId, deviceId });
    await pool.end();
  }
}

/** A device with two correlated channels and a diurnal shape, so a trend question has something to find. */
async function seed(pool: Pool, args: { tenantId: string; actorId: string; deviceId: string; hours: number }) {
  await pool.query("INSERT INTO users.tenants(id,name) VALUES($1,'live-smoke')", [args.tenantId]);
  await pool.query("INSERT INTO users.users(id,email) VALUES($1,$2)", [args.actorId, `${args.actorId}@example.test`]);
  await pool.query("INSERT INTO users.tenant_members(tenant_id,user_id,role) VALUES($1,$2,'admin')", [args.tenantId, args.actorId]);
  await pool.query(
    `INSERT INTO telemetry.devices(id,tenant_id,token_hash,channels,source,display_name,next_s,last_seen_at,status)
     VALUES($1,$2,$3,'{"temperature_c":{"unit":"C","min":-40,"max":85},"humidity_pct":{"unit":"%","min":0,"max":100}}',
       '{}','Smoke Plant',300,now(),'{"health":["OK"],"batt_mv":3790,"rssi":-58}')`,
    [args.deviceId, args.tenantId, randomUUID()],
  );

  const top = Math.floor(Date.now() / 3600_000) * 3600_000;
  let seq = 0;
  for (let hour = args.hours; hour > 0; hour--) {
    const bucket = top - hour * 3600_000;
    const phase = Math.sin(((new Date(bucket).getUTCHours() - 4) / 24) * 2 * Math.PI);
    // A slow warming drift on top of the daily cycle, with humidity inversely related.
    const drift = (args.hours - hour) * 0.02;
    const series = [
      ["temperature_c", 21 + 3 * phase + drift],
      ["humidity_pct", 58 - 6 * phase - drift],
    ] as const;
    for (const [channel, value] of series) {
      for (let sample = 0; sample < 4; sample++) {
        await pool.query("INSERT INTO telemetry.readings(device_id,seq,ordinal,channel,ts,value) VALUES($1,$2,0,$3,$4,$5)", [
          args.deviceId,
          ++seq,
          channel,
          new Date(bucket + sample * 900_000),
          Number((value + sample * 0.05).toFixed(3)),
        ]);
      }
      await pool.query(
        `INSERT INTO telemetry.rollups(device_id,channel,resolution,bucket,n,sum,min,max,last,stddev)
         VALUES($1,$2,'1h',$3,4,$4,$5,$6,$7,0)`,
        [args.deviceId, channel, new Date(bucket), value * 4 + 0.3, value, value + 0.15, value + 0.15],
      );
      await pool.query(
        `INSERT INTO telemetry.latest(device_id,channel,ts,seq,ordinal,value) VALUES($1,$2,$3,$4,0,$5)
         ON CONFLICT (device_id,channel) DO UPDATE SET ts=EXCLUDED.ts,seq=EXCLUDED.seq,value=EXCLUDED.value`,
        [args.deviceId, channel, new Date(bucket + 3 * 900_000), seq, Number((value + 0.15).toFixed(3))],
      );
    }
  }
  console.log(`seeded ${args.hours} h across temperature_c and humidity_pct on device ${args.deviceId}`);
}

async function cleanup(pool: Pool, args: { tenantId: string; deviceId: string }) {
  for (const statement of [
    "DELETE FROM telemetry.device_chat_requests WHERE device_id=$1",
    "DELETE FROM telemetry.rollups WHERE device_id=$1",
    "DELETE FROM telemetry.latest WHERE device_id=$1",
    "DELETE FROM telemetry.readings WHERE device_id=$1",
    "DELETE FROM telemetry.devices WHERE id=$1",
  ]) {
    await pool.query(statement, [args.deviceId]);
  }
  await pool.query("DELETE FROM builds.llm_calls WHERE tenant_id=$1", [args.tenantId]);
  await pool.query("DELETE FROM users.tenant_members WHERE tenant_id=$1", [args.tenantId]);
  await pool.query("DELETE FROM users.tenants WHERE id=$1", [args.tenantId]);
}

main().catch((error) => {
  // Never print the error object: an SDK error can carry request details.
  console.error(`live smoke failed: ${error instanceof Error ? error.message : "unknown"}`);
  process.exitCode = 1;
});
