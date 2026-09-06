import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getPool } from "@/lib/db";
import { createCategory } from "@/lib/categories/service";
import { setBudget, copyBudgetsFromPreviousMonth } from "@/lib/budgets/service";
import { getCategoryMonthSummary, getMonthTotals, getPaymentSourceTotals } from "@/lib/budget-summary/service";
import { createEntry } from "@/lib/entries/service";
import { createPaymentSource } from "@/lib/payment-sources/service";

const pool = getPool();
const MONTH = "2026-09";
const PREV_MONTH = "2026-08";

describe("orçamento e resumo categoria x gasto — Etapa 2", () => {
  let householdId: string;
  let carroId: string;
  let combustivelId: string;
  let mercadoId: string;
  let cartaoId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_budget__') RETURNING id`,
    );
    householdId = rows[0].id;

    const carro = await createCategory(householdId, { name: "Carro" });
    const mercado = await createCategory(householdId, { name: "Mercado" });
    if (carro.status !== "created" || mercado.status !== "created") throw new Error("setup failed");
    carroId = carro.category.id;
    mercadoId = mercado.category.id;

    const combustivel = await createCategory(householdId, { name: "Combustível", parentId: carroId });
    if (combustivel.status !== "created") throw new Error("setup failed");
    combustivelId = combustivel.category.id;

    const cartao = await createPaymentSource(householdId, { name: "Cartão" });
    if (cartao.status !== "error") cartaoId = cartao.source.id;

    // Orçamentos do mês
    await setBudget(householdId, carroId, MONTH, 60); // "sem subcategoria" do grupo Carro
    await setBudget(householdId, combustivelId, MONTH, 150);
    await setBudget(householdId, mercadoId, MONTH, 250);

    // Lançamento órfão direto no grupo "Carro": createEntry recusaria isso
    // (regra de negócio exige categoria-folha), então simulamos dado legado
    // — uma categoria que já tinha lançamentos antes de ganhar subcategoria —
    // inserindo direto no banco, como o bug real do protótipo descrito em
    // sondar-full-build-instructions.md 3.4.
    await pool.query(
      `INSERT INTO financial_entries (household_id, entry_type, entry_date, description, amount, category_id)
       VALUES ($1, 'expense', '2026-09-05', 'Multa (órfã, direto no grupo Carro)', 50, $2)`,
      [householdId, carroId],
    );

    await createEntry(householdId, {
      entryType: "expense",
      entryDate: "2026-09-10",
      description: "Gasolina",
      amount: 100,
      categoryId: combustivelId,
      paymentSourceId: cartaoId,
    });

    await createEntry(householdId, {
      entryType: "expense",
      entryDate: "2026-09-15",
      description: "Feira",
      amount: 200,
      categoryId: mercadoId,
    });

    await createEntry(householdId, {
      entryType: "income",
      entryDate: "2026-09-01",
      description: "Salário",
      amount: 300,
      categoryId: null,
    });
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM financial_entries WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM budgets WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM payment_sources WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("categoria-folha soma direto (Mercado)", async () => {
    const tree = await getCategoryMonthSummary(householdId, MONTH);
    const mercado = tree.find((c) => c.id === mercadoId)!;
    expect(mercado.gasto).toBe(200);
    expect(mercado.orcado).toBe(250);
    expect(mercado.direct).toBeNull();
  });

  it("categoria com subcategoria soma filhas + órfão direto (bug real do protótipo)", async () => {
    const tree = await getCategoryMonthSummary(householdId, MONTH);
    const carro = tree.find((c) => c.id === carroId)!;

    // manual: 100 (Combustível) + 50 (órfã direto em Carro)
    expect(carro.gasto).toBe(150);
    expect(carro.orcado).toBe(210); // 150 (Combustível) + 60 (direto)
    expect(carro.direct).toEqual({ gasto: 50, orcado: 60 });

    const combustivel = carro.children.find((c) => c.id === combustivelId)!;
    expect(combustivel.gasto).toBe(100);
    expect(combustivel.orcado).toBe(150);
  });

  it("total do mês bate com a soma manual das categorias normais", async () => {
    const totals = await getMonthTotals(householdId, MONTH);
    // manual: 50 (Carro direto) + 100 (Combustível) + 200 (Mercado) = 350
    expect(totals.gastoTotal).toBe(350);
    expect(totals.creditosTotal).toBe(300);
  });

  it("total por origem bate com a soma manual (só a Gasolina tem Cartão)", async () => {
    const totals = await getPaymentSourceTotals(householdId, MONTH);
    const cartao = totals.find((t) => t.paymentSourceId === cartaoId);
    expect(cartao?.total).toBe(100);
  });

  it("copiar orçamento do mês anterior traz os valores pro mês alvo", async () => {
    await setBudget(householdId, mercadoId, PREV_MONTH, 999);
    const result = await copyBudgetsFromPreviousMonth(householdId, MONTH);
    expect(result.copied).toBeGreaterThan(0);

    const tree = await getCategoryMonthSummary(householdId, MONTH);
    const mercado = tree.find((c) => c.id === mercadoId)!;
    expect(mercado.orcado).toBe(999);
  });

  it("recusa lançamento numa categoria-grupo (só folha recebe lançamento)", async () => {
    const result = await createEntry(householdId, {
      entryType: "expense",
      entryDate: "2026-09-20",
      description: "Não deveria entrar",
      amount: 10,
      categoryId: carroId,
    });
    expect(result.status).toBe("error");
  });
});
