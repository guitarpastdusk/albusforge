/*
 * The migration runner, run by the pre-deploy Cloud Run Job as the owner role
 * (`albus_migrate`):  node packages/db/dist/migrate.js
 *
 * 1. Takes a Postgres advisory lock, so concurrent runs queue instead of racing.
 * 2. Applies every pending migration from packages/db/migrations.
 * 3. With DB_APP_ROLE and DB_APP_PASSWORD, creates or updates the app role and
 *    grants it DML only. The role is created here rather than by Terraform:
 *    Cloud SQL puts every API-created user in cloudsqlsuperuser, which carries
 *    CREATE on the database.
 */
import { fileURLToPath, pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { type AppRole, appRoleFromEnv, type DbConfig, dbConfigFromEnv, pgConnectionConfig } from "./config.js";
import { APP_SCHEMAS } from "./schema/index.js";

// Any constant works, as long as every run uses the same one.
const MIGRATION_LOCK_KEY = "7243004119431865601";

// Resolves the same from src/ (tests) and dist/ (the Job).
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

type Log = (message: string, fields?: Record<string, unknown>) => void;

export interface MigrateOptions {
  appRole?: AppRole;
  migrationsFolder?: string;
  log?: Log;
}

export async function runMigrations(config: DbConfig, options: MigrateOptions = {}): Promise<void> {
  const log = options.log ?? (() => {});
  // One client, not a pool: a session-level advisory lock belongs to one connection.
  const client = new pg.Client(pgConnectionConfig(config));
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_LOCK_KEY]);
    log("migration lock acquired");

    await migrate(drizzle(client), { migrationsFolder: options.migrationsFolder ?? MIGRATIONS_FOLDER });
    log("migrations applied");

    if (options.appRole) {
      await provisionAppRole(client, options.appRole);
      log("app role provisioned", { role: options.appRole.name });
    }
  } finally {
    // Closing the session releases the lock, including when a step above threw.
    await client.end();
  }
}

async function provisionAppRole(client: pg.Client, role: AppRole): Promise<void> {
  // DDL takes no bind parameters, so identifiers and the password are escaped.
  const ident = pg.escapeIdentifier(role.name);
  const password = pg.escapeLiteral(role.password);
  const privileges = "SELECT, INSERT, UPDATE, DELETE";

  await client.query("BEGIN");
  try {
    const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [role.name]);
    // NOINHERIT so a membership granted later still doesn't pass its privileges through.
    await client.query(
      existing.rowCount
        ? `ALTER ROLE ${ident} WITH LOGIN NOINHERIT PASSWORD ${password}`
        : `CREATE ROLE ${ident} WITH LOGIN NOINHERIT PASSWORD ${password}`,
    );

    await removeMemberships(client, role.name);

    // PostgreSQL 15+ already withholds these from PUBLIC; Cloud SQL and older
    // clusters may not, and either would let the app role run DDL.
    const database = await client.query<{ name: string }>("SELECT current_database() AS name");
    await client.query(`REVOKE CREATE ON DATABASE ${pg.escapeIdentifier(database.rows[0]!.name)} FROM PUBLIC`);
    await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");

    for (const name of APP_SCHEMAS) {
      const schema = pg.escapeIdentifier(name);
      await client.query(`GRANT USAGE ON SCHEMA ${schema} TO ${ident}`);
      await client.query(`GRANT ${privileges} ON ALL TABLES IN SCHEMA ${schema} TO ${ident}`);
      await client.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${ident}`);
      // Default privileges apply to objects this (the owner) role creates later.
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT ${privileges} ON TABLES TO ${ident}`);
      await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema} GRANT USAGE ON SEQUENCES TO ${ident}`);
    }

    await assertNoDdl(client, role.name);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof UnsafeAppRoleError) await disableLogin(client, role.name, error);
    throw error;
  }
}

/** The app role could run DDL and the runner can't take that away. */
class UnsafeAppRoleError extends Error {}

type Membership = { role: string; grantor: string };

const listMemberships = async (client: pg.Client, name: string) =>
  (
    await client.query<Membership>(
      `SELECT r.rolname AS role, g.rolname AS grantor FROM pg_auth_members m
         JOIN pg_roles r ON r.oid = m.roleid
         JOIN pg_roles g ON g.oid = m.grantor
         JOIN pg_roles u ON u.oid = m.member
        WHERE u.rolname = $1`,
      [name],
    )
  ).rows;

/**
 * The model allows the app role no memberships at all. NOINHERIT doesn't make
 * one safe: a SET-only grant still allows `SET ROLE x; CREATE TABLE …`. In
 * PostgreSQL 16 each grantor's grant is separate, so a bare REVOKE can leave
 * another grantor's in place; revoke each by its grantor, then re-check.
 */
async function removeMemberships(client: pg.Client, name: string): Promise<void> {
  for (const { role, grantor } of await listMemberships(client, name)) {
    // A failed REVOKE aborts the transaction; the savepoint keeps it usable.
    await client.query("SAVEPOINT revoke_membership");
    try {
      await client.query(
        `REVOKE ${pg.escapeIdentifier(role)} FROM ${pg.escapeIdentifier(name)} GRANTED BY ${pg.escapeIdentifier(grantor)}`,
      );
      await client.query("RELEASE SAVEPOINT revoke_membership");
    } catch {
      // Not this grantor's to revoke as the migrator; the re-check below reports it.
      await client.query("ROLLBACK TO SAVEPOINT revoke_membership");
    }
  }

  const remaining = await listMemberships(client, name);
  if (remaining.length) {
    const list = remaining.map((m) => `${m.role} (granted by ${m.grantor})`).join(", ");
    throw new UnsafeAppRoleError(
      `App role ${name} is still a member of ${list}, which the migrator can't revoke. Revoke it as its grantor, then rerun.`,
    );
  }
}

/**
 * Fail closed: the transaction rolled back, so whatever let the role run DDL is
 * still there. Take its login away until a clean run restores it. Connections
 * already open stay open until they close.
 */
async function disableLogin(client: pg.Client, name: string, cause: UnsafeAppRoleError): Promise<void> {
  try {
    const existing = await client.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [name]);
    if (existing.rowCount) await client.query(`ALTER ROLE ${pg.escapeIdentifier(name)} NOLOGIN`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    cause.message += ` Disabling its login also failed: ${reason}`;
    return;
  }
  cause.message += " Its login has been disabled.";
}

/** Refuses to finish if the app role could still change the schema by any path. */
async function assertNoDdl(client: pg.Client, name: string): Promise<void> {
  const { rows } = await client.query<Record<string, boolean>>(
    `SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
            has_database_privilege(r.rolname, current_database(), 'CREATE') AS db_create,
            has_schema_privilege(r.rolname, 'public', 'CREATE') AS public_create,
            bool_or(has_schema_privilege(r.rolname, s, 'CREATE')) AS app_schema_create
       FROM pg_roles r, unnest($2::text[]) AS s
      WHERE r.rolname = $1
      GROUP BY r.rolname, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls`,
    [name, APP_SCHEMAS],
  );
  const held = Object.entries(rows[0] ?? {})
    .filter(([, value]) => value)
    .map(([key]) => key);
  if (held.length) throw new UnsafeAppRoleError(`App role ${name} still holds ${held.join(", ")}; refusing to continue.`);
}

/** One JSON object per line, in the shape Cloud Logging parses from a Cloud Run Job. */
function jsonLog(severity: "INFO" | "ERROR"): Log {
  return (message, fields) => console.log(JSON.stringify({ severity, message, ...fields }));
}

async function main(): Promise<void> {
  const config = dbConfigFromEnv();
  const appRole = appRoleFromEnv();
  const log = jsonLog("INFO");
  // Never the password: only where and as whom.
  log("migrations starting", {
    host: config.host,
    database: config.database,
    user: config.user,
    appRole: appRole?.name ?? null,
  });
  await runMigrations(config, { appRole, log });
  log("migrations complete");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    jsonLog("ERROR")("migrations failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exitCode = 1;
  });
}
