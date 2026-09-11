import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { getPool } from "@/lib/db";
import { createCategory, setGapAlertsSilenced } from "@/lib/categories/service";
import { createPaymentSource } from "@/lib/payment-sources/service";
import { createEntry } from "@/lib/entries/service";
import { findGapWarnings } from "@/lib/gap-warnings/service";

const pool = getPool();
const MONTH = "2026-09";
const PRIOR_1 = "2026-08";
const PRIOR_2 = "2026-07";
const PRIOR_3 = "2026-06";

describe("avisos de lacuna de registro (dinheiro/Pix)", () => {
  let householdId: string;
  let ledgerId: string;
  let categoryId: string;
  let dinheiroId: string;
  let cartaoId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_gap_warnings__') RETURNING id`,
    );
    householdId = rows[0].id;

    const { rows: ledgerRows } = await pool.query<{ id: string }>(
      `INSERT INTO ledgers (household_id, name, is_default) VALUES ($1, 'Principal', true) RETURNING id`,
      [householdId],
    );
    ledgerId = ledgerRows[0].id;

    const cat = await createCategory(householdId, ledgerId, { name: "Feira" });
    if (cat.status !== "created") throw new Error("setup failed");
    categoryId = cat.category.id;

    const dinheiro = await createPaymentSource(householdId, { name: "Dinheiro", leavesNoPaperTrail: true });
    const cartao = await createPaymentSource(householdId, { name: "Cartão de Crédito" });
    if (dinheiro.status !== "created" || cartao.status !== "created") throw new Error("setup failed");
    dinheiroId = dinheiro.source.id;
    cartaoId = cartao.source.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM financial_entries WHERE household_id = $1`, [householdId]);
    await setGapAlertsSilenced(householdId, categoryId, false);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM payment_sources WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM ledgers WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  async function entryIn(month: string, amount: number, paymentSourceId: string) {
    const result = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: `${month}-10`,
      description: "Feira da semana",
      amount,
      categoryId,
      paymentSourceId,
    });
    if (result.status !== "created") throw new Error("setup failed");
  }

  it("sem 3 meses de histórico prévio, nunca avisa (nem faltando, nem caindo)", async () => {
    await entryIn(PRIOR_1, 100, dinheiroId);
    await entryIn(PRIOR_2, 100, dinheiroId);
    // PRIOR_3 sem nenhum lançamento — só 2 dos 3 meses anteriores têm histórico.

    const warnings = await findGapWarnings(householdId, ledgerId, MONTH);
    expect(warnings).toEqual([]);
  });

  it("3 meses de histórico + mês atual sem nenhum lançamento -> aviso 'missing'", async () => {
    await entryIn(PRIOR_1, 100, dinheiroId);
    await entryIn(PRIOR_2, 100, dinheiroId);
    await entryIn(PRIOR_3, 100, dinheiroId);
    // MONTH sem lançamento algum.

    const warnings = await findGapWarnings(householdId, ledgerId, MONTH);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ categoryId, kind: "missing" });
  });

  it("3 meses de histórico + mês atual com queda de mais de 50% -> aviso 'drop'", async () => {
    await entryIn(PRIOR_1, 100, dinheiroId);
    await entryIn(PRIOR_2, 100, dinheiroId);
    await entryIn(PRIOR_3, 100, dinheiroId);
    await entryIn(MONTH, 30, dinheiroId); // 30% da média — bem abaixo de 50%

    const warnings = await findGapWarnings(householdId, ledgerId, MONTH);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ categoryId, kind: "drop" });
  });

  it("3 meses de histórico + mês atual em linha com o padrão -> nenhum aviso", async () => {
    await entryIn(PRIOR_1, 100, dinheiroId);
    await entryIn(PRIOR_2, 100, dinheiroId);
    await entryIn(PRIOR_3, 100, dinheiroId);
    await entryIn(MONTH, 90, dinheiroId); // só uma leve variação, não é lacuna

    const warnings = await findGapWarnings(householdId, ledgerId, MONTH);
    expect(warnings).toEqual([]);
  });

  it("lançamentos em forma de pagamento com comprovante (cartão) nunca contam pro histórico nem pro aviso", async () => {
    await entryIn(PRIOR_1, 100, cartaoId);
    await entryIn(PRIOR_2, 100, cartaoId);
    await entryIn(PRIOR_3, 100, cartaoId);
    // Cartão tem fatura pra conferir depois — não é o problema que a seção 3 cobre.

    const warnings = await findGapWarnings(householdId, ledgerId, MONTH);
    expect(warnings).toEqual([]);
  });

  it("categoria com avisos silenciados nunca aparece, mesmo com o padrão de lacuna presente", async () => {
    await entryIn(PRIOR_1, 100, dinheiroId);
    await entryIn(PRIOR_2, 100, dinheiroId);
    await entryIn(PRIOR_3, 100, dinheiroId);
    // MONTH sem lançamento -> seria "missing" se não estivesse silenciada.
    await setGapAlertsSilenced(householdId, categoryId, true);

    const warnings = await findGapWarnings(householdId, ledgerId, MONTH);
    expect(warnings).toEqual([]);
  });
});
