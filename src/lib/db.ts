import { Pool, types, type QueryResultRow, type QueryResult } from "pg";

declare global {
  var __sondarPool: Pool | undefined;
  var __sondarAppPool: Pool | undefined;
}

// pg parses DATE columns (financial_entries.entry_date, budgets.month) into
// JS Date objects by default, but every type/service in this codebase treats
// them as plain "YYYY-MM-DD" strings (matching what Postgres actually sends
// over the wire). Registering this globally, once, is simpler and safer than
// converting at every call site — a missed one crashes in production only
// once real rows exist to render (e.g. entry.entry_date.slice is not a
// function), not during development against an empty table.
const PG_TYPE_DATE = 1082;
types.setTypeParser(PG_TYPE_DATE, (value: string) => value);

function createPool(envVar: string) {
  const connectionString = process.env[envVar];
  if (!connectionString) {
    throw new Error(`${envVar} is not set`);
  }
  return new Pool({ connectionString });
}

/**
 * Lazy on purpose: constructing the Pool reads process.env.DATABASE_URL, and
 * some standalone scripts (e.g. scripts/seed.ts) load .env.local themselves
 * at runtime, after their own static imports have already been resolved —
 * building the pool at module-eval time would run before that env load and
 * throw. Callers get the same pool every time either way (cached on
 * globalThis, which also survives Next.js dev hot-reloads).
 *
 * This is the unrestricted (table owner) connection — used for auth/identity
 * tables that don't carry a household_id (users, households,
 * household_members, auth_tokens), and by scripts/tests that legitimately
 * need cross-household access (migrate.mjs, seed.ts, the cron job's initial
 * "which plans are due across every household" scan). Any query touching a
 * household-owned table from application code should go through
 * dbForHousehold below instead, not this.
 */
export function getPool(): Pool {
  if (!global.__sondarPool) {
    global.__sondarPool = createPool("DATABASE_URL");
  }
  return global.__sondarPool;
}

/**
 * Pool for the restricted `sondar_app` Postgres role (db/006_rls.sql) — the
 * only role actually subject to the Row-Level Security policies. Falls back
 * to DATABASE_URL when DATABASE_URL_APP isn't set, so a dev environment that
 * hasn't gone through the RLS role setup yet still works (without RLS
 * enforcement); production must set DATABASE_URL_APP.
 */
function getAppPool(): Pool {
  if (!global.__sondarAppPool) {
    global.__sondarAppPool = createPool(
      process.env.DATABASE_URL_APP ? "DATABASE_URL_APP" : "DATABASE_URL",
    );
  }
  return global.__sondarAppPool;
}

export function db<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getPool().query<T>(text, params);
}

export type TransactionQuery = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<QueryResult<T>>;

/**
 * Runs several statements against the unrestricted (owner) pool as one
 * all-or-nothing transaction — for multi-step writes where a failure partway
 * through must not leave a half-finished result behind (e.g. signup: a
 * household created but no matching consent record because a later insert
 * failed). Rolls back and rethrows on any error.
 */
export async function withTransaction<T>(fn: (query: TransactionQuery) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn((text, params) => client.query(text, params));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Runs one query scoped to a single household through the RLS-restricted
 * `sondar_app` role. Every service function reading/writing a
 * household-owned table (categories, budgets, payment_sources,
 * installment_plans, financial_entries, merchant_rules, notes, ledgers,
 * audit_log, ai_extraction_logs) must go through this instead of db() — it's
 * the second, database-enforced layer of isolation on top of each service's
 * own `WHERE household_id = $1`: even a future query that forgets that
 * filter can't return or write another household's rows, because Postgres
 * itself rejects it.
 *
 * Wrapped in a real transaction because `SET LOCAL` (via set_config's
 * third argument) only takes effect for the current transaction — required
 * for correctness under connection pooling (a pooled connection is reused
 * by other requests right after this one releases it; a plain session-level
 * SET would leak this household's id to whichever request grabs the
 * connection next).
 */
export async function dbForHousehold<T extends QueryResultRow = QueryResultRow>(
  householdId: string,
  text: string,
  params?: unknown[],
) {
  const client = await getAppPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_household_id', $1, true)", [householdId]);
    const result = await client.query<T>(text, params);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
