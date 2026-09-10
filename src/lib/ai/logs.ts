import { dbForHousehold } from "@/lib/db";

/** Metadata only, per the schema's own privacy note — the image itself is never persisted. */
export async function logExtraction(
  householdId: string,
  sourceType: "image" | "text",
  entriesCreated: number,
  flaggedCount: number,
  modelUsed: string,
): Promise<void> {
  await dbForHousehold(
    householdId,
    `INSERT INTO ai_extraction_logs (household_id, source_type, entries_created, flagged_count, model_used)
     VALUES ($1, $2, $3, $4, $5)`,
    [householdId, sourceType, entriesCreated, flaggedCount, modelUsed],
  );
}
