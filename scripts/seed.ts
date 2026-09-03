/**
 * Seeds the shared household and its two known members from env vars.
 * There is no open signup in Sondar — this is the only way users get created.
 * Safe to re-run: never overwrites an existing household or user.
 */
import { config as loadEnv } from "dotenv";
import { Pool } from "pg";

loadEnv({ path: ".env.local" });
loadEnv();
import { hashPassword } from "../src/lib/auth/password";

type SeedUser = {
  email: string;
  password: string;
  name: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function loadSeedUsers(): SeedUser[] {
  const users: SeedUser[] = [];
  for (const n of [1, 2]) {
    const email = process.env[`SEED_USER${n}_EMAIL`];
    const password = process.env[`SEED_USER${n}_PASSWORD`];
    const name = process.env[`SEED_USER${n}_NAME`];
    if (email && password) {
      users.push({ email: email.trim().toLowerCase(), password, name: name ?? email });
    }
  }
  if (users.length === 0) {
    throw new Error(
      "No seed users configured. Set SEED_USER1_EMAIL/SEED_USER1_PASSWORD (and optionally SEED_USER2_*) in .env.local",
    );
  }
  return users;
}

async function main() {
  const pool = new Pool({ connectionString: requireEnv("DATABASE_URL") });
  const householdName = process.env.HOUSEHOLD_NAME ?? "Minha família";
  const seedUsers = loadSeedUsers();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: households } = await client.query<{ id: string }>(
      `SELECT id FROM households ORDER BY created_at ASC LIMIT 1`,
    );
    let householdId: string;
    if (households.length === 0) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO households (name) VALUES ($1) RETURNING id`,
        [householdName],
      );
      householdId = rows[0].id;
      console.log(`Created household "${householdName}" (${householdId})`);
    } else {
      householdId = households[0].id;
      console.log(`Household already exists (${householdId}), reusing it`);
    }

    for (const [index, seedUser] of seedUsers.entries()) {
      const { rows: existing } = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE lower(email) = $1`,
        [seedUser.email],
      );

      let userId: string;
      if (existing.length > 0) {
        userId = existing[0].id;
        console.log(`User ${seedUser.email} already exists, leaving password untouched`);
      } else {
        const passwordHash = await hashPassword(seedUser.password);
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO users (email, display_name, password_hash) VALUES ($1, $2, $3) RETURNING id`,
          [seedUser.email, seedUser.name, passwordHash],
        );
        userId = rows[0].id;
        console.log(`Created user ${seedUser.email} (${userId})`);
      }

      const role = index === 0 ? "owner" : "member";
      await client.query(
        `INSERT INTO household_members (household_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (household_id, user_id) DO NOTHING`,
        [householdId, userId, role],
      );
    }

    await client.query("COMMIT");
    console.log("Seed complete.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
