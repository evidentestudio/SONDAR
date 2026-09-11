import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { getPool } from "@/lib/db";
import { createCategory } from "@/lib/categories/service";
import { createPaymentSource } from "@/lib/payment-sources/service";
import { createEntry, listEntries, findReconciliationCandidate, reconcileEntry } from "@/lib/entries/service";

const pool = getPool();
const MONTH = "2026-09";

describe("conciliação por hierarquia de fontes (fatura é a verdade, áudio é estimativa)", () => {
  let householdId: string;
  let ledgerId: string;
  let categoryId: string;
  let cartaoId: string;
  let pixId: string;

  beforeAll(async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO households (name) VALUES ('__test_household_reconciliation__') RETURNING id`,
    );
    householdId = rows[0].id;

    const { rows: ledgerRows } = await pool.query<{ id: string }>(
      `INSERT INTO ledgers (household_id, name, is_default) VALUES ($1, 'Principal', true) RETURNING id`,
      [householdId],
    );
    ledgerId = ledgerRows[0].id;

    const cat = await createCategory(householdId, ledgerId, { name: "Mercado" });
    if (cat.status !== "created") throw new Error("setup failed");
    categoryId = cat.category.id;

    const cartao = await createPaymentSource(householdId, { name: "Cartão de Crédito" });
    const pix = await createPaymentSource(householdId, { name: "Pix" });
    if (cartao.status !== "created" || pix.status !== "created") throw new Error("setup failed");
    cartaoId = cartao.source.id;
    pixId = pix.source.id;
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM financial_entries WHERE household_id = $1`, [householdId]);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM payment_sources WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM categories WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM ledgers WHERE household_id = $1`, [householdId]);
    await pool.query(`DELETE FROM households WHERE id = $1`, [householdId]);
    await pool.end();
  });

  it("acha candidato dentro da janela de ±3 dias, ±20% de valor e mesma forma de pagamento", async () => {
    const draft = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-05",
      description: "Mercado (falado)",
      amount: 40,
      categoryId,
      paymentSourceId: cartaoId,
      inputMethod: "ai_audio",
      amountConfidence: "approximate",
    });
    if (draft.status !== "created") throw new Error("setup failed");

    const result = await findReconciliationCandidate(householdId, ledgerId, {
      entryDate: "2026-09-07", // +2 dias
      amount: 38, // dentro de ±20% de 40
      paymentSourceId: cartaoId,
    });
    expect(result).toEqual({
      type: "matched",
      entry: {
        entryId: draft.entry.id,
        categoryId,
        paymentSourceId: cartaoId,
        entryDate: "2026-09-05",
        amount: 40,
      },
    });
  });

  it("fora da janela de data não casa", async () => {
    const draft = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-01",
      description: "Mercado (falado)",
      amount: 40,
      categoryId,
      paymentSourceId: cartaoId,
      inputMethod: "ai_audio",
      amountConfidence: "approximate",
    });
    if (draft.status !== "created") throw new Error("setup failed");

    const result = await findReconciliationCandidate(householdId, ledgerId, {
      entryDate: "2026-09-10", // 9 dias de diferença
      amount: 40,
      paymentSourceId: cartaoId,
    });
    expect(result).toEqual({ type: "none" });
  });

  it("fora da tolerância de valor não casa", async () => {
    const draft = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-05",
      description: "Mercado (falado)",
      amount: 40,
      categoryId,
      paymentSourceId: cartaoId,
      inputMethod: "ai_audio",
      amountConfidence: "approximate",
    });
    if (draft.status !== "created") throw new Error("setup failed");

    const result = await findReconciliationCandidate(householdId, ledgerId, {
      entryDate: "2026-09-05",
      amount: 60, // 50% acima, fora de ±20%
      paymentSourceId: cartaoId,
    });
    expect(result).toEqual({ type: "none" });
  });

  it("forma de pagamento diferente não casa", async () => {
    const draft = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-05",
      description: "Mercado (falado)",
      amount: 40,
      categoryId,
      paymentSourceId: cartaoId,
      inputMethod: "ai_audio",
      amountConfidence: "approximate",
    });
    if (draft.status !== "created") throw new Error("setup failed");

    const result = await findReconciliationCandidate(householdId, ledgerId, {
      entryDate: "2026-09-05",
      amount: 40,
      paymentSourceId: pixId,
    });
    expect(result).toEqual({ type: "none" });
  });

  it("lançamento já exato (amount_confidence 'exact') nunca é candidato — só rascunho pendente de áudio", async () => {
    const confirmed = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-05",
      description: "Mercado (já confirmado)",
      amount: 40,
      categoryId,
      paymentSourceId: cartaoId,
    });
    if (confirmed.status !== "created") throw new Error("setup failed");

    const result = await findReconciliationCandidate(householdId, ledgerId, {
      entryDate: "2026-09-05",
      amount: 40,
      paymentSourceId: cartaoId,
    });
    expect(result).toEqual({ type: "none" });
  });

  it("mais de um candidato é ambíguo — nunca decide sozinho", async () => {
    await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-05",
      description: "Mercado (falado 1)",
      amount: 40,
      categoryId,
      paymentSourceId: cartaoId,
      inputMethod: "ai_audio",
      amountConfidence: "approximate",
    });
    await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-06",
      description: "Mercado (falado 2)",
      amount: 41,
      categoryId,
      paymentSourceId: cartaoId,
      inputMethod: "ai_audio",
      amountConfidence: "approximate",
    });

    const result = await findReconciliationCandidate(householdId, ledgerId, {
      entryDate: "2026-09-05",
      amount: 40,
      paymentSourceId: cartaoId,
    });
    expect(result).toEqual({ type: "ambiguous" });
  });

  it("reconcileEntry substitui valor/data e marca amount_confidence como 'exact'", async () => {
    const draft = await createEntry(householdId, {
      ledgerId,
      entryType: "expense",
      entryDate: "2026-09-05",
      description: "Mercado (falado)",
      amount: 40,
      categoryId,
      paymentSourceId: cartaoId,
      inputMethod: "ai_audio",
      amountConfidence: "approximate",
    });
    if (draft.status !== "created") throw new Error("setup failed");

    const result = await reconcileEntry(householdId, draft.entry.id, {
      amount: 38.5,
      entryDate: "2026-09-06",
      inputMethod: "ai_image",
      reviewStatus: "confirmed",
    });
    expect(result.status).toBe("created");

    const entries = await listEntries(householdId, ledgerId, MONTH);
    const updated = entries.find((e) => e.id === draft.entry.id)!;
    expect(updated.amount).toBe("38.50");
    expect(updated.entry_date.slice(0, 10)).toBe("2026-09-06");
    expect(updated.amount_confidence).toBe("exact");
    expect(updated.input_method).toBe("ai_image");
    // Marca persistente pra dar pra conferir depois, sem depender de ter
    // visto o aviso na tela de revisão no momento exato da fusão.
    expect(updated.audio_confirmed_at).not.toBeNull();

    // Já conciliado (exact agora) — não pode virar candidato de novo.
    const secondLookup = await findReconciliationCandidate(householdId, ledgerId, {
      entryDate: "2026-09-06",
      amount: 38.5,
      paymentSourceId: cartaoId,
    });
    expect(secondLookup).toEqual({ type: "none" });
  });
});
