import { dbForHousehold } from "@/lib/db";

/**
 * Teto de segurança por household, por mês corrente — ver
 * sondar-melhorias-multimodal.md seção 2 ("custo e volume"): protege contra
 * loop de cliente com bug ou uso abusivo, sem incomodar uso legítimo intenso
 * (várias faturas + vários lançamentos por áudio todo dia). Conta qualquer
 * chamada que chegou a rodar a extração completa (Opus) — pré-checagens
 * recusadas antes de custar (ver precheckImage em extract.ts) não entram
 * aqui, porque o objetivo delas é justamente nunca chegar a esse ponto.
 */
export const MAX_EXTRACTIONS_PER_MONTH = 300;

export async function countExtractionsThisMonth(householdId: string): Promise<number> {
  const { rows } = await dbForHousehold<{ count: number }>(
    householdId,
    `SELECT COUNT(*)::int AS count FROM ai_extraction_logs
     WHERE household_id = $1 AND created_at >= date_trunc('month', now())`,
    [householdId],
  );
  return rows[0].count;
}

export async function hasReachedMonthlyExtractionCap(householdId: string): Promise<boolean> {
  const count = await countExtractionsThisMonth(householdId);
  return count >= MAX_EXTRACTIONS_PER_MONTH;
}
