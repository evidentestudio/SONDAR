import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { getPool } from "@/lib/db";
import { createCategory } from "@/lib/categories/service";
import { createMerchantRule } from "@/lib/merchant-rules/service";
import { createPaymentSource } from "@/lib/payment-sources/service";
import { createEntry } from "@/lib/entries/service";
import { processExtractedItems } from "@/lib/ai/pipeline";
import { logExtraction } from "@/lib/ai/logs";
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

  // Isola cada teste dos lançamentos criados por outros — sem isso, um
  // rascunho de áudio (amount_confidence 'approximate') deixado por um
  // teste de conciliação viraria candidato inesperado em outro teste que
  // usa a mesma data/valor padrão do helper item().
  afterEach(async () => {
    await pool.query(`DELETE FROM financial_entries WHERE household_id = $1`, [householdId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM ai_extraction_logs WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM payment_sources WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM merchant_rules WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM ledgers WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("marca approximate e resolve payment_source_hint (extração de áudio)", async () => {
    const cartao = await createPaymentSource(householdId, { name: "Cartão de Crédito" });
    if (cartao.status !== "created") throw new Error("setup failed");

    const [comEstimativa, semEstimativa, semHint] = await processExtractedItems(householdId, ledgerId, [
      item({ description: "Mercado", approximate: true, payment_source_hint: "cartao" }),
      item({ description: "Padaria", approximate: false, payment_source_hint: "cartao" }),
      item({ description: "Farmácia" }),
    ]);

    expect(comEstimativa.approximate).toBe(true);
    expect(comEstimativa.paymentSourceId).toBe(cartao.source.id);

    expect(semEstimativa.approximate).toBe(false);
    expect(semEstimativa.paymentSourceId).toBe(cartao.source.id);

    // Sem approximate/payment_source_hint no item (como imagem/texto de
    // fatura sempre é) — nunca deve quebrar nem inventar valor.
    expect(semHint.approximate).toBe(false);
    expect(semHint.paymentSourceId).toBeNull();
  });

  it("payment_source_hint não reconhecido vira null, sem travar a extração", async () => {
    const [draft] = await processExtractedItems(householdId, ledgerId, [
      item({ description: "Posto de Gasolina", payment_source_hint: "criptomoeda" }),
    ]);
    expect(draft.paymentSourceId).toBeNull();
  });

  it("logExtraction grava ledger_id e período coberto (fundação da dedup por imagem)", async () => {
    await logExtraction({
      householdId,
      ledgerId,
      sourceType: "image",
      entriesCreated: 3,
      flaggedCount: 1,
      modelUsed: "claude-opus-5",
      periodStart: "2026-09-01",
      periodEnd: "2026-09-18",
    });

    const { rows } = await pool.query<{
      ledger_id: string;
      period_start: string | null;
      period_end: string | null;
    }>(
      `SELECT ledger_id, period_start, period_end FROM ai_extraction_logs
       WHERE household_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [householdId],
    );
    expect(rows[0].ledger_id).toBe(ledgerId);
    expect(rows[0].period_start).not.toBeNull();
    expect(rows[0].period_end).not.toBeNull();
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

  it("apelido falado só se aplica quando a extração pede o pool de áudio", async () => {
    await createMerchantRule(householdId, ledgerId, {
      pattern: "mercado",
      categoryId: mercadoId,
      ruleType: "spoken_alias",
    });

    // Sem options (fatura/texto, default invoice_pattern) — o apelido
    // "mercado" não pode ser confundido com um padrão de fatura; a
    // categoria vem do palpite normal da IA, não da regra.
    const [asInvoice] = await processExtractedItems(householdId, ledgerId, [
      item({ description: "mercado", category: "Assinaturas" }),
    ]);
    expect(asInvoice.matchedRuleId).toBeNull();
    expect(asInvoice.categoryId).toBe(assinaturasId);

    // Pedindo o pool de áudio, a mesma fala "mercado" agora casa com o
    // apelido salvo, ignorando o palpite da IA (regra é autoritativa).
    const [asAudio] = await processExtractedItems(
      householdId,
      ledgerId,
      [item({ description: "mercado", category: "Assinaturas" })],
      { ruleType: "spoken_alias" },
    );
    expect(asAudio.matchedRuleId).not.toBeNull();
    expect(asAudio.categoryId).toBe(mercadoId);
  });

  it("preview de conciliação: fatura/texto acha rascunho de áudio pendente sem forma de pagamento em comum", async () => {
    const cartao = await createPaymentSource(householdId, { name: "Cartão Conciliação" });
    if (cartao.status !== "created") throw new Error("setup failed");

    const draft = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-05",
      description: "Mercado (falado)",
      amount: 40,
      categoryId: mercadoId,
      paymentSourceId: cartao.source.id,
      inputMethod: "ai_audio",
      amountConfidence: "approximate",
    });
    if (draft.status !== "created") throw new Error("setup failed");

    // Sourced from an invoice/text (default ruleType) — payment_source_hint
    // só existe pra áudio, então o preview de fatura não tem
    // paymentSourceId resolvido, e sem forma de pagamento em comum ele não
    // pode confirmar o match (mesma forma de pagamento é obrigatória).
    const [asInvoice] = await processExtractedItems(householdId, ledgerId, [
      item({ date: "2026-09-06", description: "Supermercado XYZ", amount: 38, category: "Mercado" }),
    ]);
    expect(asInvoice.reconcileEntryId).toBeNull();

    // Sourced from audio (ruleType spoken_alias) nunca procura conciliação —
    // é o lado "estimativa" da hierarquia, não o buscador.
    const [asAudio] = await processExtractedItems(
      householdId,
      ledgerId,
      [item({ date: "2026-09-06", description: "Mercado", amount: 38, category: "Mercado" })],
      { ruleType: "spoken_alias" },
    );
    expect(asAudio.reconcileEntryId).toBeNull();
    expect(asAudio.reconciliationAmbiguous).toBe(false);
  });

  it("preview de conciliação: acha o candidato quando ambos os lados não têm forma de pagamento definida", async () => {
    const draft = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-08",
      description: "Padaria (falado)",
      amount: 20,
      categoryId: mercadoId,
      inputMethod: "ai_audio",
      amountConfidence: "approximate",
    });
    if (draft.status !== "created") throw new Error("setup failed");

    const [asInvoice] = await processExtractedItems(householdId, ledgerId, [
      item({ date: "2026-09-09", description: "Padaria do Bairro", amount: 19, category: "Mercado" }),
    ]);
    expect(asInvoice.reconcileEntryId).toBe(draft.entry.id);
    expect(asInvoice.reconcileEntryAmount).toBe(20);
    expect(asInvoice.reconcileEntryDate).toBe("2026-09-08");
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
