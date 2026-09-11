import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { getPool } from "@/lib/db";
import { countExtractionsThisMonth, hasReachedMonthlyExtractionCap, MAX_EXTRACTIONS_PER_MONTH } from "@/lib/ai/limits";

const pool = getPool();

describe("teto de extrações por período", () => {
  let householdId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_ai_limits__') RETURNING id`,
    );
    householdId = rows[0].id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM ai_extraction_logs WHERE household_id = $1`, [householdId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("sem nenhuma extração no mês, contagem é zero e teto não foi atingido", async () => {
    expect(await countExtractionsThisMonth(householdId)).toBe(0);
    expect(await hasReachedMonthlyExtractionCap(householdId)).toBe(false);
  });

  it("conta apenas extrações do mês corrente, ignorando logs de meses anteriores", async () => {
    await pool.query(
      `INSERT INTO ai_extraction_logs (household_id, source_type, entries_created, flagged_count, model_used, created_at)
       VALUES ($1, 'image', 1, 0, 'claude-opus-5', date_trunc('month', now()))`,
      [householdId],
    );
    await pool.query(
      `INSERT INTO ai_extraction_logs (household_id, source_type, entries_created, flagged_count, model_used, created_at)
       VALUES ($1, 'image', 1, 0, 'claude-opus-5', date_trunc('month', now()) - interval '1 month')`,
      [householdId],
    );

    expect(await countExtractionsThisMonth(householdId)).toBe(1);
  });

  it("teto é atingido quando a contagem do mês chega no limite configurado", async () => {
    const values: string[] = [];
    const params: unknown[] = [householdId];
    for (let i = 0; i < MAX_EXTRACTIONS_PER_MONTH; i++) {
      values.push(`($1, 'audio', 1, 0, 'claude-opus-5', now())`);
    }
    await pool.query(
      `INSERT INTO ai_extraction_logs (household_id, source_type, entries_created, flagged_count, model_used, created_at)
       VALUES ${values.join(", ")}`,
      params,
    );

    expect(await countExtractionsThisMonth(householdId)).toBe(MAX_EXTRACTIONS_PER_MONTH);
    expect(await hasReachedMonthlyExtractionCap(householdId)).toBe(true);
  });
});
