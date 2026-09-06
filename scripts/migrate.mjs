/**
 * Cross-platform stand-in for `psql "$DATABASE_URL" -f ...`. Plain shell
 * interpolation of $DATABASE_URL only works on Unix shells — on Windows,
 * npm's default script shell (cmd.exe) doesn't expand it, so psql silently
 * fell back to connecting to localhost instead of the real database. This
 * loads .env.local itself and passes the URL to psql as a real argv element,
 * so it behaves the same on every OS.
 */
import { config as loadEnv } from "dotenv";
import { spawnSync } from "node:child_process";

loadEnv({ path: ".env.local" });
loadEnv();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is not set (check .env.local)");
  process.exit(1);
}

const files = [
  "db/000_extensions.sql",
  "db/sondar_schema.sql",
  "db/001_auth.sql",
];

const args = [databaseUrl, "-v", "ON_ERROR_STOP=1"];
for (const file of files) args.push("-f", file);

const result = spawnSync("psql", args, { stdio: "inherit" });

if (result.error) {
  if (result.error.code === "ENOENT") {
    console.error(
      "\npsql não foi encontrado no PATH. Instale o PostgreSQL (client tools) e tente de novo.",
    );
  } else {
    console.error(result.error);
  }
  process.exit(1);
}

process.exit(result.status ?? 1);
