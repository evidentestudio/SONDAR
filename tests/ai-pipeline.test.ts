import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { getPool } from "@/lib/db";
import { createCategory } from "@/lib/categories/service";
import { createMerchantRule } from "@/lib/merchant-rules/service";
import { createEntry } from "@/lib/entries/service";
import { processExtractedItems } from "@/lib/ai/pipeline";
import type { RawExtractedItem } from "@/lib/ai/extract";

const pool = getPool();

function item(overrides: Partial<RawExtractedItem>): RawExtractedItem {
  return {
    date: "2026-09-05",
    description: "Loja Genérica",
    amount: 50,
    category: "Mercado",
    revisar: false,
    ...overrides,
  };
}

describe("processExtractedItems", () => {
  let householdId: string;
  let ledgerId: string;
  let mercadoId: string;
  let assinaturasId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_ai_pipeline__') RETURNING id`,
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
    await pool.query(`DELETE FROM ai_extraction_logs WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM financial_entries WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM merchant_rules WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM ledgers WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("resolve categoria conhecida de forma insensível a acento/caixa", async () => {
    const [draft] = await processExtractedItems(householdId, ledgerId, [
      item({ category: "mercado", description: "Padaria da Esquina" }),
    ]);
    expect(draft.categoryId).toBe(mercadoId);
    expect(draft.categoryName).toBe("MERCADO");
    expect(draft.categoryNotFound).toBe(false);
    expect(draft.needsReview).toBe(false);
  });

  it("categoria inventada pela IA cai em Aguardando Revisão — nunca cria categoria nova", async () => {
    const [draft] = await processExtractedItems(householdId, ledgerId, [
      item({ category: "Categoria Que Não Existe", description: "Compra Estranha" }),
    ]);
    expect(draft.categoryId).toBeNull();
    expect(draft.categoryName).toBe("Aguardando Revisão");
    expect(draft.categoryNotFound).toBe(true);
    expect(draft.needsReview).toBe(true);
    expect(draft.aiCategoryGuess).toBe("Categoria Que Não Existe");
  });

  it("regra de estabelecimento sobrepõe o palpite da IA", async () => {
    await createMerchantRule(householdId, ledgerId, { pattern: "ifood", categoryId: mercadoId });

    const [draft] = await processExtractedItems(householdId, ledgerId, [
      item({ description: "IFOOD*Restaurante X", category: "Assinaturas" }),
    ]);
    expect(draft.categoryId).toBe(mercadoId);
    expect(draft.categoryName).toBe("MERCADO");
    expect(draft.matchedRuleId).not.toBeNull();
  });

  it("regra ambígua força Aguardando Revisão independente do palpite da IA", async () => {
    await createMerchantRule(householdId, ledgerId, {
      pattern: "anthropic",
      categoryId: assinaturasId,
      isAmbiguous: true,
    });

    const [draft] = await processExtractedItems(householdId, ledgerId, [
      item({ description: "ANTHROPIC PBC", category: "Mercado" }),
    ]);
    expect(draft.categoryId).toBeNull();
    expect(draft.categoryName).toBe("Aguardando Revisão");
    expect(draft.needsReview).toBe(true);
    expect(draft.matchedRuleId).toBeNull();
  });

  it("detecta possível duplicidade quando já existe lançamento igual no mês", async () => {
    const created = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-10",
      description: "Assinatura mensal",
      amount: 39.9,
      categoryId: mercadoId,
    });
    expect(created.status).toBe("created");

    const [draft] = await processExtractedItems(householdId, ledgerId, [
      item({ date: "2026-09-15", description: "Outra Loja Qualquer", category: "Mercado", amount: 39.9 }),
    ]);
    expect(draft.possibleDuplicate).toBe(true);
  });

  it("itens malformados são descartados silenciosamente", async () => {
    const drafts = await processExtractedItems(householdId, ledgerId, [
      item({ date: "05/09/2026" }), // data fora do formato ISO
      item({ description: "   " }), // descrição vazia
      item({ amount: 0 }), // valor não positivo
      item({ amount: -10 }), // valor negativo
      item({ description: "Item Válido", amount: 25, category: "Mercado" }), // este deve passar
    ]);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].description).toBe("Item Válido");
  });
});
