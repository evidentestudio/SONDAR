/**
 * Etapa 5 (sondar-etapas-implementacao.md): "soma das partes precisa bater
 * com o valor original, nas duas telas (revisão e lançamento salvo)".
 * Módulo sem dependências (nenhum import de banco) de propósito — usado
 * tanto no servidor (save-batch, antes de gravar qualquer coisa) quanto no
 * cliente (review-modal.tsx, pra dar o erro na hora, sem ida e volta ao
 * servidor). splitEntry (entries/service.ts) faz a validação equivalente
 * pro caso "lançamento já salvo", direto contra o banco.
 */
export function validateSplitGroupTotals(
  items: { splitGroupKey?: string | null; splitGroupTotal?: number | null; amount: number }[],
): { ok: true } | { ok: false; message: string } {
  const sums = new Map<string, number>();
  const totals = new Map<string, number>();
  for (const item of items) {
    if (!item.splitGroupKey) continue;
    sums.set(item.splitGroupKey, (sums.get(item.splitGroupKey) ?? 0) + item.amount);
    if (item.splitGroupTotal != null) totals.set(item.splitGroupKey, item.splitGroupTotal);
  }
  for (const [key, sum] of sums) {
    const total = totals.get(key);
    if (total !== undefined && Math.abs(sum - total) > 0.005) {
      return {
        ok: false,
        message: `A soma das partes de um lançamento dividido (${sum.toFixed(2)}) não bate com o valor original (${total.toFixed(2)}).`,
      };
    }
  }
  return { ok: true };
}
