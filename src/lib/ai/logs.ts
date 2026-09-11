import { dbForHousehold } from "@/lib/db";

export type LogExtractionInput = {
  householdId: string;
  ledgerId: string;
  sourceType: "image" | "text";
  entriesCreated: number;
  flaggedCount: number;
  modelUsed: string;
  /** Intervalo de datas que a imagem cobre (ex: extrato/fatura parcial) —
   * usado pela deduplicação pra saber se um print novo já foi coberto por
   * um anterior. Null pra texto/áudio, que não cobrem um intervalo.
   * Ainda não preenchido por nenhum chamador — ver
   * sondar-melhorias-multimodal.md seção 1.2 e 2.2 (sub-etapas futuras). */
  periodStart?: string | null;
  periodEnd?: string | null;
};

/** Metadata only, per the schema's own privacy note — the image itself is never persisted. */
export async function logExtraction(input: LogExtractionInput): Promise<void> {
  await dbForHousehold(
    input.householdId,
    `INSERT INTO ai_extraction_logs
       (household_id, ledger_id, source_type, entries_created, flagged_count, model_used, period_start, period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      input.householdId,
      input.ledgerId,
      input.sourceType,
      input.entriesCreated,
      input.flaggedCount,
      input.modelUsed,
      input.periodStart ?? null,
      input.periodEnd ?? null,
    ],
  );
}
