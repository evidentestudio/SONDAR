import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getPool, dbForHousehold } from "@/lib/db";

const pool = getPool();

// Segunda camada de isolamento entre famílias (db/006_rls.sql): mesmo que uma
// consulta futura esqueça o filtro por household_id (o que já aconteceu uma
// vez neste projeto), o próprio Postgres precisa recusar ler ou gravar uma
// linha de outro household quando a sessão está presa a um household via
// dbForHousehold. Exige DATABASE_URL_APP configurada (role restrito
// `sondar_app`, criado à mão — ver db/006_rls.sql) — sem isso, pula:
// dbForHousehold cai de volta no role dono (sem RLS), e testar isolamento
// contra ele não provaria nada.
const hasAppRole = Boolean(process.env.DATABASE_URL_APP);
const describeIfConfigured = hasAppRole ? describe : describe.skip;

describeIfConfigured("Row-Level Security (isolamento entre famílias)", () => {
  let householdA: string;
  let householdB: string;
  let ledgerB: string;
  let categoryB: string;
  let entryB: string;

  beforeAll(async () => {
    const { rows: hhA } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__rls_test_household_a__') RETURNING id`,
    );
    householdA = hhA[0].id;
    const { rows: hhB } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__rls_test_household_b__') RETURNING id`,
    );
    householdB = hhB[0].id;

    const { rows: lgB } = await pool.query<{ id: string }>(
      `INSERT INTO ledgers (household_id, name, is_default) VALUES ($1, 'Principal', true) RETURNING id`,
      [householdB],
    );
    ledgerB = lgB[0].id;

    const { rows: catB } = await pool.query<{ id: string }>(
      `INSERT INTO categories (household_id, ledger_id, name, category_type) VALUES ($1, $2, 'B_ONLY', 'normal') RETURNING id`,
      [householdB, ledgerB],
    );
    categoryB = catB[0].id;

    const { rows: entB } = await pool.query<{ id: string }>(
      `INSERT INTO financial_entries (household_id, ledger_id, entry_type, entry_date, description, amount, category_id)
       VALUES ($1, $2, 'expense', now(), 'gasto da familia B', 42, $3) RETURNING id`,
      [householdB, ledgerB, categoryB],
    );
    entryB = entB[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM financial_entries WHERE household_id IN ($1, $2)`, [
      householdA,
      householdB,
    ]);
    await pool.query(`DELETE FROM categories WHERE household_id IN ($1, $2)`, [householdA, householdB]);
    await pool.query(`DELETE FROM ledgers WHERE household_id IN ($1, $2)`, [householdA, householdB]);
    await pool.query(`DELETE FROM households WHERE id IN ($1, $2)`, [householdA, householdB]);
    await pool.end();
  });

  it("uma sessão presa ao household A não enxerga linhas do household B, mesmo sem filtro na query", async () => {
    const { rows } = await dbForHousehold(householdA, `SELECT * FROM categories WHERE id = $1`, [
      categoryB,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("o mesmo vale para financial_entries", async () => {
    const { rows } = await dbForHousehold(householdA, `SELECT * FROM financial_entries WHERE id = $1`, [
      entryB,
    ]);
    expect(rows).toHaveLength(0);
  });

  it("a sessão do dono do dado continua enxergando normalmente", async () => {
    const { rows } = await dbForHousehold(householdB, `SELECT * FROM categories WHERE id = $1`, [
      categoryB,
    ]);
    expect(rows).toHaveLength(1);
  });

  it("recusa gravar uma linha marcada com household_id de outra família", async () => {
    await expect(
      dbForHousehold(
        householdA,
        `INSERT INTO categories (household_id, ledger_id, name, category_type) VALUES ($1, $2, 'FORJADA', 'normal')`,
        [householdB, ledgerB],
      ),
    ).rejects.toThrow();
  });
});
