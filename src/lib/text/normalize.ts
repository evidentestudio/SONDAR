/**
 * Ported from sondar-full-build-instructions.md section 3.1 — the base of
 * merchant-rule matching. Only used for fuzzy matching text (rule patterns
 * against a description); it is NOT the same normalization as
 * categories.name_normalized (which is lower(immutable_unaccent(name)),
 * computed by Postgres) — this one also collapses punctuation/whitespace,
 * which category name matching intentionally does not do.
 */
export function normalizeStr(s: string): string {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // remove accents (combining diacritics)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Levenshtein distance — tolerates small spelling mistakes in merchant rules. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

export function fuzzyMatch(normDesc: string, normPattern: string): boolean {
  if (!normPattern) return false;
  if (normDesc.includes(normPattern)) return true;
  const pTokens = normPattern.split(" ").filter(Boolean);
  const dTokens = normDesc.split(" ").filter(Boolean);
  return (
    pTokens.length > 0 &&
    pTokens.every((pt) => dTokens.some((dt) => levenshtein(pt, dt) <= (pt.length > 5 ? 2 : 1)))
  );
}
