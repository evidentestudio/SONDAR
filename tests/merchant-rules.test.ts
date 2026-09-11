import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getPool } from "@/lib/db";
import { createCategory } from "@/lib/categories/service";
import { createMerchantRule, findMatchingRule } from "@/lib/merchant-rules/service";

const pool = getPool();

describe("regras de estabelecimento", () => {
  let householdId: string;
  let ledgerId: string;
  let mercadoId: string;
  let assinaturasId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_rules__') RETURNING id`,
    );
    householdId = rows[0].id;

    const { rows: ledgerRows } = await pool.query<{ id: string }>(
      `INSERT INTO ledgers (household_id, name, is_default) VALUES ($1, 'Principal', true) RETURNING id`,
      [householdId],
    );
    ledgerId = ledgerRows[0].id;

    const mercado = await createCategory(householdId, ledgerId, { name: "Mercado" });
    const assinaturas = await createCategory(householdId, ledgerId, { name: "Assinaturas" });
    if (mercado.status !== "created" || assinaturas.status !== "created") {
      throw new Error("setup failed");
    }
    mercadoId = mercado.category.id;
    assinaturasId = assinaturas.category.id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM merchant_rules WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM ledgers WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("regra casa mesmo com erro de grafia/acento no lançamento", async () => {
    const rule = await createMerchantRule(householdId, ledgerId, { pattern: "ifood", categoryId: mercadoId });
    expect(rule.status).toBe("created");

    const match = await findMatchingRule(householdId, ledgerId, "IFOOD*Restaurante Bom Ltda");
    expect(match).toEqual({
      type: "matched",
      categoryId: mercadoId,
      categoryName: "MERCADO",
      ruleId: expect.any(String),
      pattern: "ifood",
    });
  });

  it("rule_type é 'invoice_pattern' por padrão e aceita 'spoken_alias' explícito", async () => {
    const invoiceRule = await createMerchantRule(householdId, ledgerId, {
      pattern: "ifood-default-type",
      categoryId: mercadoId,
    });
    const aliasRule = await createMerchantRule(householdId, ledgerId, {
      pattern: "mercado",
      categoryId: mercadoId,
      ruleType: "spoken_alias",
    });
    expect(invoiceRule.status).toBe("created");
    expect(aliasRule.status).toBe("created");
    if (invoiceRule.status !== "created" || aliasRule.status !== "created") throw new Error("unreachable");

    expect(invoiceRule.rule.rule_type).toBe("invoice_pattern");
    expect(aliasRule.rule.rule_type).toBe("spoken_alias");
  });

  it("apelido falado e padrão de fatura nunca se misturam — cada um só casa no seu próprio pool", async () => {
    // As duas regras já existem do teste anterior: "ifood-default-type"
    // (invoice_pattern) e "mercado" (spoken_alias), ambas -> mercadoId.

    // Pedindo o pool de fatura (default), a descrição "mercado" (só existe
    // como apelido falado) não pode casar — senão uma fala qualquer
    // contendo a palavra "mercado" colidiria com regras de fatura.
    const asInvoice = await findMatchingRule(householdId, ledgerId, "mercado");
    expect(asInvoice.type).toBe("none");

    // Pedindo o pool de áudio, o padrão de fatura "ifood-default-type" (só
    // existe como invoice_pattern) também não pode casar.
    const asSpokenAlias = await findMatchingRule(
      householdId,
      ledgerId,
      "IFOOD*Restaurante Bom Ltda",
      "spoken_alias",
    );
    expect(asSpokenAlias.type).toBe("none");

    // Mas cada um casa dentro do seu próprio pool.
    const spokenMatch = await findMatchingRule(householdId, ledgerId, "mercado", "spoken_alias");
    expect(spokenMatch).toEqual({
      type: "matched",
      categoryId: mercadoId,
      categoryName: "MERCADO",
      ruleId: expect.any(String),
      pattern: "mercado",
    });
  });

  it("regra ambígua nunca aplica categoria sozinha — força revisão", async () => {
    await createMerchantRule(householdId, ledgerId, {
      pattern: "anthropic",
      categoryId: assinaturasId,
      isAmbiguous: true,
    });

    const match = await findMatchingRule(householdId, ledgerId, "ANTHROPIC PBC");
    expect(match.type).toBe("ambiguous");
  });

  it("recusa padrão duplicado", async () => {
    const result = await createMerchantRule(householdId, ledgerId, { pattern: "IFOOD", categoryId: mercadoId });
    expect(result.status).toBe("error");
  });

  it("recusa categoria que não é folha", async () => {
    const parent = await createCategory(householdId, ledgerId, { name: "Carro" });
    if (parent.status !== "created") throw new Error("setup failed");
    await createCategory(householdId, ledgerId, { name: "Combustível", parentId: parent.category.id });

    const result = await createMerchantRule(householdId, ledgerId, {
      pattern: "posto",
      categoryId: parent.category.id,
    });
    expect(result.status).toBe("error");
  });

  it("descrição sem nenhuma regra correspondente não casa nada", async () => {
    const match = await findMatchingRule(householdId, ledgerId, "Loja Qualquer Sem Relação");
    expect(match.type).toBe("none");
  });

  it("regra de outro orçamento não se aplica aqui — ledgers não se influenciam", async () => {
    const { rows: otherLedgerRows } = await pool.query<{ id: string }>(
      `INSERT INTO ledgers (household_id, name) VALUES ($1, 'Empresa') RETURNING id`,
      [householdId],
    );
    const otherLedgerId = otherLedgerRows[0].id;
    const outraCategoria = await createCategory(householdId, otherLedgerId, { name: "Despesas Empresa" });
    if (outraCategoria.status !== "created") throw new Error("setup failed");

    await createMerchantRule(householdId, otherLedgerId, {
      pattern: "netflix",
      categoryId: outraCategoria.category.id,
    });

    // A regra existe (no orçamento "Empresa"), mas buscando no ledgerId
    // "Principal" ela não deve casar — cada orçamento é independente.
    const match = await findMatchingRule(householdId, ledgerId, "NETFLIX.COM");
    expect(match.type).toBe("none");

    await pool.query(`DELETE FROM merchant_rules WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM categories WHERE ledger_id = $1`, [otherLedgerId]);
    await pool.query(`DELETE FROM ledgers WHERE id = $1`, [otherLedgerId]);
  });
});
