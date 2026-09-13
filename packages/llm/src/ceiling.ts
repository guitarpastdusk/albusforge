import { type Db, llmCalls } from "@albusforge/db";
import { eq, sql } from "drizzle-orm";

/**
 * Every token a build has used, from `llm_calls`: input, output, cache reads
 * and cache writes. Counting cache reads makes the ceiling conservative; it is
 * an abuse guard, not a bill.
 */
export async function buildTokensUsed(db: Db, buildId: string): Promise<number> {
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${llmCalls.inputTokens} + ${llmCalls.outputTokens} + ${llmCalls.cacheReadInputTokens} + ${llmCalls.cacheCreationInputTokens}), 0)`,
    })
    .from(llmCalls)
    .where(eq(llmCalls.buildId, buildId));
  return Number(row?.total ?? 0);
}
