import { describe, expect, it } from "vitest";
import { validateSplitGroupTotals } from "@/lib/entries/split-validation";

describe("validateSplitGroupTotals (Etapa 5 — tela de revisão, antes de salvar)", () => {
  it("itens sem splitGroupKey nunca são validados — sempre ok", () => {
    const result = validateSplitGroupTotals([
      { amount: 10 },
      { amount: 20 },
      { splitGroupKey: null, splitGroupTotal: null, amount: 5 },
    ]);
    expect(result).toEqual({ ok: true });
  });

  it("grupo cuja soma das partes bate com o total original é válido", () => {
    const result = validateSplitGroupTotals([
      { splitGroupKey: "row-1", splitGroupTotal: 100, amount: 60 },
      { splitGroupKey: "row-1", splitGroupTotal: 100, amount: 40 },
    ]);
    expect(result).toEqual({ ok: true });
  });

  it("grupo cuja soma não bate com o total original é rejeitado", () => {
    const result = validateSplitGroupTotals([
      { splitGroupKey: "row-1", splitGroupTotal: 100, amount: 60 },
      { splitGroupKey: "row-1", splitGroupTotal: 100, amount: 30 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("90.00");
      expect(result.message).toContain("100.00");
    }
  });

  it("tolera diferença de arredondamento de centavos", () => {
    const result = validateSplitGroupTotals([
      { splitGroupKey: "row-1", splitGroupTotal: 10, amount: 3.33 },
      { splitGroupKey: "row-1", splitGroupTotal: 10, amount: 3.33 },
      { splitGroupKey: "row-1", splitGroupTotal: 10, amount: 3.34 },
    ]);
    expect(result).toEqual({ ok: true });
  });

  it("valida múltiplos grupos independentemente — um desbalanceado não afeta o outro", () => {
    const result = validateSplitGroupTotals([
      { splitGroupKey: "ok-group", splitGroupTotal: 50, amount: 25 },
      { splitGroupKey: "ok-group", splitGroupTotal: 50, amount: 25 },
      { splitGroupKey: "bad-group", splitGroupTotal: 50, amount: 25 },
      { splitGroupKey: "bad-group", splitGroupTotal: 50, amount: 10 },
    ]);
    expect(result.ok).toBe(false);
  });

  it("remover uma parte no meio (grupo com 3 vira 2) continua exigindo bater com o total", () => {
    const originalTotal = 90;
    // Pessoa tinha 3 partes (30+30+30) e removeu uma, redistribuindo o
    // valor pras 2 que sobraram.
    const afterRemoving = validateSplitGroupTotals([
      { splitGroupKey: "row-2", splitGroupTotal: originalTotal, amount: 45 },
      { splitGroupKey: "row-2", splitGroupTotal: originalTotal, amount: 45 },
    ]);
    expect(afterRemoving).toEqual({ ok: true });

    const forgotToRedistribute = validateSplitGroupTotals([
      { splitGroupKey: "row-2", splitGroupTotal: originalTotal, amount: 30 },
      { splitGroupKey: "row-2", splitGroupTotal: originalTotal, amount: 30 },
    ]);
    expect(forgotToRedistribute.ok).toBe(false);
  });
});
