import { dbForHousehold } from "@/lib/db";

export type NoteRow = {
  id: string;
  household_id: string;
  content: string;
  is_done: boolean;
  created_by: string | null;
  created_at: string;
  deleted_at: string | null;
};

export async function listNotes(householdId: string): Promise<NoteRow[]> {
  const { rows } = await dbForHousehold<NoteRow>(
    householdId,
    `SELECT * FROM notes WHERE household_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`,
    [householdId],
  );
  return rows;
}

export async function createNote(
  householdId: string,
  content: string,
  createdBy?: string | null,
): Promise<NoteRow | null> {
  const trimmed = content.trim();
  if (!trimmed) return null;
  const { rows } = await dbForHousehold<NoteRow>(
    householdId,
    `INSERT INTO notes (household_id, content, created_by) VALUES ($1, $2, $3) RETURNING *`,
    [householdId, trimmed, createdBy ?? null],
  );
  return rows[0];
}

export async function setNoteDone(householdId: string, id: string, isDone: boolean): Promise<void> {
  await dbForHousehold(householdId, `UPDATE notes SET is_done = $1 WHERE id = $2 AND household_id = $3`, [
    isDone,
    id,
    householdId,
  ]);
}

export async function deleteNote(householdId: string, id: string): Promise<void> {
  await dbForHousehold(householdId, `UPDATE notes SET deleted_at = now() WHERE id = $1 AND household_id = $2`, [
    id,
    householdId,
  ]);
}
