import { expect, it } from "vitest";
import { configFromEnv } from "./config.js";
import { connectDatabase } from "./database.js";

it("uses the shared direct PostgreSQL pool with bounded waits and TLS", async () => {
  const config = configFromEnv({ K_SERVICE: "cloudlink", DB_HOST: "10.0.0.3", DB_NAME: "db", DB_USER: "app", DB_PASSWORD: "secret" });
  const db = connectDatabase(config);
  try {
    expect(db.pool.options).toMatchObject({ host: "10.0.0.3", port: 5432, database: "db", user: "app",
      ssl: { rejectUnauthorized: false }, max: 5, connectionTimeoutMillis: 5000,
      statement_timeout: 10000, query_timeout: 11000, idleTimeoutMillis: 30000 });
    expect(db.pool.totalCount).toBe(0); // Construction opens no connection or external API request.
  } finally { await db.close(); }
});
