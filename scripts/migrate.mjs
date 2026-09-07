/**
 * Applies db/*.sql directly via the `pg` client (no `psql` binary required —
 * that was a recurring setup blocker on Windows, where it isn't installed by
 * default and PATH changes don't always stick across shells). Tracks what
 * ran in a _sondar_migrations table so re-running this is always safe: it
 * only applies files it hasn't recorded yet, instead of replaying
 * db/sondar_schema.sql's plain (non-idempotent) CREATE TABLE statements
 * against a database that already has them.
 */
import { config as loadEnv } from "dotenv";
import { Client } from "pg";
import fs from "node:fs";

loadEnv({ path: ".env.local" });
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (check .env.local)");
  process.exit(1);
}

// Historical fact, not a moving target: every database that predates the
// _sondar_migrations table necessarily has exactly these three applied,
// since they're the only migrations that existed before this tracking did.
const PRE_TRACKING_FILES = ["db/000_extensions.sql", "db/sondar_schema.sql", "db/001_auth.sql"];

const files = [...PRE_TRACKING_FILES, "db/002_fix_month_totals_view.sql"];

async function tableExists(client, name) {
  const { rows } = await client.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1) AS exists`,
    [name],
  );
  return rows[0].exists;
}

async function main() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const trackingExisted = await tableExists(client, "_sondar_migrations");
  await client.query(`
    CREATE TABLE IF NOT EXISTS _sondar_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  if (!trackingExisted && (await tableExists(client, "users"))) {
    for (const file of PRE_TRACKING_FILES) {
      await client.query(
        `INSERT INTO _sondar_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING`,
        [file],
      );
    }
    console.log("Schema já existia — marcando migrações antigas como já aplicadas.");
  }

  const { rows: appliedRows } = await client.query(`SELECT filename FROM _sondar_migrations`);
  const applied = new Set(appliedRows.map((r) => r.filename));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`— ${file} (já aplicado)`);
      continue;
    }
    console.log(`→ ${file}`);
    const sql = fs.readFileSync(file, "utf8");
    await client.query(sql);
    await client.query(`INSERT INTO _sondar_migrations (filename) VALUES ($1)`, [file]);
  }

  console.log("Migrações em dia.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
