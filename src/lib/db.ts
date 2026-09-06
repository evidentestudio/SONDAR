import { Pool, type QueryResultRow } from "pg";

declare global {
  var __sondarPool: Pool | undefined;
}

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
