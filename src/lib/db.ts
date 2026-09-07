import { Pool, types, type QueryResultRow } from "pg";

declare global {
  var __sondarPool: Pool | undefined;
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

function createPool() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
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
 */
export function getPool(): Pool {
  if (!global.__sondarPool) {
    global.__sondarPool = createPool();
  }
  return global.__sondarPool;
}

export function db<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return getPool().query<T>(text, params);
}
