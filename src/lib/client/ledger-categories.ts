import type { CategoryNode } from "@/lib/categories/service";

export function flattenLeaves(nodes: CategoryNode[]): CategoryNode[] {
  const out: CategoryNode[] = [];
  for (const node of nodes) {
    if (node.children.length === 0) out.push(node);
    else out.push(...node.children);
  }
  return out;
}

/** Client-side fetch of one ledger's full category tree (with hierarchy and
 * category_type intact) — used wherever a form needs to offer both leaf
 * categories and top-level categories (e.g. as parents for a new
 * subcategory), not just a flat leaf list. */
export async function fetchLedgerCategoryTree(ledgerId: string): Promise<CategoryNode[]> {
  const res = await fetch(`/api/categories?ledgerId=${ledgerId}`);
  const data = await res.json();
  return data.categories ?? [];
}

/** Client-side fetch of one ledger's leaf categories — used wherever a form
 * lets the user pick a different orçamento and must re-populate the category
 * dropdown for that orçamento's own (independent) category tree. */
export async function fetchLedgerLeaves(ledgerId: string): Promise<CategoryNode[]> {
  return flattenLeaves(await fetchLedgerCategoryTree(ledgerId));
}
