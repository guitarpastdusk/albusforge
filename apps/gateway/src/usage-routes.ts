import { routes, UsageSummary, ModelConsumption } from "@albusforge/schema";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { parse } from "./http";
import { withSession } from "./session";

export function registerUsageRoutes(app: FastifyInstance, pool: Pool) {
  app.register(async (scope) => {
    scope.addHook("onRequest", async (_request, reply) => { reply.header("cache-control", "private, no-store"); });
    scope.get(routes.usage.pattern, async (request) => withSession(pool, request.headers.cookie, request.hostname, async (client, tenant) => {
      parse(z.strictObject({}), request.query, "query");
      const clock = (await client.query<{ start: Date; end: Date; now: Date }>(`SELECT CURRENT_TIMESTAMP AS now,
        date_trunc('month',CURRENT_TIMESTAMP,'UTC') AS start,
        (date_trunc('month',CURRENT_TIMESTAMP AT TIME ZONE 'UTC')+interval '1 month') AT TIME ZONE 'UTC' AS end`)).rows[0]!;
      const rows = (await client.query<ModelConsumption & { stage: string | null }>(`WITH attributed AS (
        SELECT CASE WHEN stage IN ('intake','codegen','bodygen','narration','ask','explain') THEN stage ELSE 'other' END AS category,
          input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens,cost_usd
        FROM builds.llm_calls WHERE tenant_id=$1 AND created_at >= $2 AND created_at < $3
      ) SELECT category AS stage,count(*)::text AS calls,
        COALESCE(sum(input_tokens),0)::text AS input_tokens,COALESCE(sum(output_tokens),0)::text AS output_tokens,
        COALESCE(sum(cache_read_input_tokens),0)::text AS cache_read_tokens,
        COALESCE(sum(cache_creation_input_tokens),0)::text AS cache_creation_tokens,
        COALESCE(sum(cost_usd),0)::numeric(30,6)::text AS cost_usd
        FROM attributed GROUP BY ROLLUP(category) ORDER BY category NULLS FIRST`, [tenant, clock.start, clock.end])).rows;
      const totals = rows.find((r) => r.stage === null)!;
      const total = ModelConsumption.strip().parse(totals);
      const telemetry = (await client.query<{ readings_in: string; payload_bytes: string }>(`SELECT
        COALESCE(sum(u.readings_in),0)::text AS readings_in,COALESCE(sum(u.payload_bytes),0)::text AS payload_bytes
        FROM telemetry.usage u JOIN telemetry.devices d ON d.id=u.device_id
        WHERE d.tenant_id=$1 AND u.period=$2`, [tenant, clock.start.toISOString().slice(0, 7)])).rows[0]!;
      return UsageSummary.parse({
        period: { start: clock.start.toISOString(), end: clock.end.toISOString() }, as_of: clock.now.toISOString(),
        model: { total, stages: rows.filter((r) => r.stage !== null) }, telemetry,
      });
    }));
  });
}
