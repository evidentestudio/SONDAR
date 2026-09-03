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

// Reused across hot reloads in dev so we don't leak a new pool per edit.
const pool = global.__sondarPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  global.__sondarPool = pool;
}

export function db<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
) {
  return pool.query<T>(text, params);
}

export { pool };
