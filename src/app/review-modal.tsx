"use client";

import { useEffect, useRef, useState } from "react";
import type { PaymentSourceRow } from "@/lib/payment-sources/service";
import type { LedgerRow } from "@/lib/ledgers/service";
import type { CategoryNode } from "@/lib/categories/service";
import { formatBRL, parseBRLAmount, toAmountInputValue } from "@/lib/format";
import { fetchLedgerCategoryTree, flattenLeaves } from "@/lib/client/ledger-categories";

type SourceType = "image" | "text" | "audio";

type UploadedImage = { data: string; mediaType: string; previewUrl: string };

type DraftRow = {
  key: string;
  date: string;
  description: string;
  amount: string;
  ledgerId: string;
  categoryId: string;
  categoryName: string;
  needsReview: boolean;
  possibleDuplicate: boolean;
  categoryNotFound: boolean;
  aiCategoryGuess: string;
  matchedRuleId: string | null;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  paymentSourceId: string;
  /** Ver AmountConfidence em lib/entries/service.ts — true quando a IA (ou a
   * própria pessoa, editável aqui) considera o valor uma estimativa, não
   * exato. Sempre false pra imagem/texto colado, a menos que a pessoa marque. */
  approximate: boolean;
  savingRule: boolean;
  /** categoryId a saved merchant rule targets for this row, or null if none
   * saved yet — compared against the row's current categoryId to know
   * whether "Salvar regra" should be disabled (matches) or re-enabled
   * (user picked a different category since). */
  ruleSavedForCategoryId: string | null;
};

function suggestPattern(description: string): string {
  const tokens = description.split(/[\s*]+/).filter((t) => t.length >= 3);
  return tokens[0] ?? description;
}

export function ReviewModal({
  ledgers,
  defaultLedgerId,
  paymentSources,
  initialSourceType,
  onClose,
  onSaved,
}: {
  ledgers: LedgerRow[];
  defaultLedgerId: string;
  paymentSources: PaymentSourceRow[];
  /** Abre o modal já na aba certa — usado pelo botão "🎤 Falar" de primeiro
   * nível (ao lado de "Processar fatura"/"Novo lançamento"), pra não
   * obrigar a pessoa a escolher a origem antes de poder ditar. */
  initialSourceType?: SourceType;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sourceType, setSourceType] = useState<SourceType>(initialSourceType ?? "image");
  const audioTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [text, setText] = useState("");
  const [audioText, setAudioText] = useState("");
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [treeCache, setTreeCache] = useState<Record<string, CategoryNode[]>>({});
  const [ruleForm, setRuleForm] = useState<{
    rowKey: string;
    pattern: string;
    ledgerId: string;
    categoryId: string;
    isAmbiguous: boolean;
  } | null>(null);
  const [newCategoryForm, setNewCategoryForm] = useState<{
    rowKey: string;
    ledgerId: string;
    name: string;
    parentId: string;
    createNewParent: boolean;
    newParentName: string;
    error: string | null;
    saving: boolean;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Foca o campo assim que a aba de áudio abre, pra chegar o mais perto
  // possível de "1 toque no botão Falar -> teclado já pronto pra ditar".
  // iOS só abre o teclado a partir de um gesto do usuário — como isto roda
  // logo depois do clique que trocou a aba (ainda no mesmo ciclo, antes do
  // próximo repaint), continua contando como gesto na maioria das versões.
  // Se mesmo assim não abrir em algum aparelho, a pessoa ainda pode tocar
  // no campo manualmente — nunca fica sem alternativa.
  useEffect(() => {
    if (sourceType === "audio" && !rows) {
      audioTextareaRef.current?.focus();
    }
  }, [sourceType, rows]);

  function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1] ?? "";
        setImages((prev) => [...prev, { data: base64, mediaType: file.type, previewUrl: result }]);
      };
      reader.readAsDataURL(file);
    }
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  async function processSource() {
    setError(null);
    setProcessing(true);
    try {
      const body =
        sourceType === "image"
          ? { sourceType, ledgerId: defaultLedgerId, images: images.map(({ data, mediaType }) => ({ data, mediaType })) }
          : { sourceType, ledgerId: defaultLedgerId, text: sourceType === "audio" ? audioText : text };

      const res = await fetch("/api/ai/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não foi possível processar.");
        return;
      }
      await ensureTree(defaultLedgerId);
      setRows(
        data.items.map(
          (
            item: {
              date: string;
              description: string;
              amount: number;
              categoryId: string | null;
              categoryName: string;
              needsReview: boolean;
              possibleDuplicate: boolean;
              categoryNotFound: boolean;
              aiCategoryGuess: string;
              matchedRuleId: string | null;
              installmentCurrent: number | null;
              installmentTotal: number | null;
              approximate?: boolean;
              paymentSourceId?: string | null;
            },
            index: number,
          ): DraftRow => ({
            key: `${index}-${item.description}`,
            date: item.date,
            description: item.description,
            amount: toAmountInputValue(item.amount),
            ledgerId: defaultLedgerId,
            categoryId: item.categoryId ?? "",
            categoryName: item.categoryName,
            needsReview: item.needsReview,
            possibleDuplicate: item.possibleDuplicate,
            categoryNotFound: item.categoryNotFound,
            aiCategoryGuess: item.aiCategoryGuess,
            matchedRuleId: item.matchedRuleId,
            installmentCurrent: item.installmentCurrent,
            installmentTotal: item.installmentTotal,
            approximate: item.approximate === true,
            // A IA já tenta reconhecer a forma de pagamento mencionada na
            // fala (só áudio) — só cai no default do household quando ela
            // não reconheceu nada.
            paymentSourceId: item.paymentSourceId || paymentSources.find((ps) => ps.is_default)?.id || "",
            savingRule: false,
            ruleSavedForCategoryId: null,
          }),
        ),
      );
    } catch {
      setError("Falha de rede ao processar.");
    } finally {
      setProcessing(false);
    }
  }

  function updateRow(key: string, patch: Partial<DraftRow>) {
    setRows((prev) => (prev ? prev.map((r) => (r.key === key ? { ...r, ...patch } : r)) : prev));
  }

  function removeRow(key: string) {
    setRows((prev) => (prev ? prev.filter((r) => r.key !== key) : prev));
  }

  async function ensureTree(ledgerId: string, forceRefresh = false): Promise<CategoryNode[]> {
    if (!forceRefresh && treeCache[ledgerId]) return treeCache[ledgerId];
    const fetched = await fetchLedgerCategoryTree(ledgerId);
    setTreeCache((prev) => ({ ...prev, [ledgerId]: fetched }));
    return fetched;
  }

  async function changeRowLedger(key: string, ledgerId: string) {
    const tree = await ensureTree(ledgerId);
    // The chosen category almost certainly doesn't exist in the new
    // ledger's independent category tree — reset it so nothing gets saved
    // against a category that belongs to a different orçamento.
    updateRow(key, { ledgerId, categoryId: flattenLeaves(tree)[0]?.id ?? "" });
  }

  async function createCategory(ledgerId: string, input: { name: string; parentId: string | null }) {
    const res = await fetch("/api/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, ledgerId }),
    });
    const data = await res.json();
    return { ok: res.ok, data } as const;
  }

  async function submitNewCategory() {
    if (!newCategoryForm) return;
    const name = newCategoryForm.name.trim();
    if (!name) {
      setNewCategoryForm({ ...newCategoryForm, error: "Nome não pode ser vazio." });
      return;
    }
    const newParentName = newCategoryForm.newParentName.trim();
    if (newCategoryForm.createNewParent && !newParentName) {
      setNewCategoryForm({ ...newCategoryForm, error: "Nome da categoria-mãe não pode ser vazio." });
      return;
    }

    setNewCategoryForm({ ...newCategoryForm, saving: true, error: null });

    let parentId = newCategoryForm.parentId || null;

    if (newCategoryForm.createNewParent) {
      const parent = await createCategory(newCategoryForm.ledgerId, {
        name: newParentName,
        parentId: null,
      });
      if (!parent.ok) {
        setNewCategoryForm({
          ...newCategoryForm,
          saving: false,
          error: parent.data.message ?? parent.data.error ?? "Não foi possível criar a categoria-mãe.",
        });
        return;
      }
      parentId = parent.data.category.id;
    }

    const child = await createCategory(newCategoryForm.ledgerId, {
      name,
      parentId,
    });
    // Refresh either way — if only the parent creation above succeeded, the
    // tree should still pick it up so the next attempt can use it directly.
    await ensureTree(newCategoryForm.ledgerId, true);
    if (!child.ok) {
      setNewCategoryForm({
        ...newCategoryForm,
        saving: false,
        error: child.data.message ?? child.data.error ?? "Não foi possível criar.",
      });
      return;
    }
    updateRow(newCategoryForm.rowKey, { categoryId: child.data.category.id });
    setNewCategoryForm(null);
  }

  async function submitRule() {
    if (!ruleForm) return;
    updateRow(ruleForm.rowKey, { savingRule: true });
    const res = await fetch("/api/merchant-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pattern: ruleForm.pattern,
        ledgerId: ruleForm.ledgerId,
        categoryId: ruleForm.categoryId,
        isAmbiguous: ruleForm.isAmbiguous,
      }),
    });
    updateRow(ruleForm.rowKey, {
      savingRule: false,
      ruleSavedForCategoryId: res.ok ? ruleForm.categoryId : null,
    });
    setRuleForm(null);
  }

  async function saveAll() {
    if (!rows || rows.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/save-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType,
          items: rows.map((r) => ({
            date: r.date,
            description: r.description,
            amount: parseBRLAmount(r.amount),
            ledgerId: r.ledgerId,
            categoryId: r.categoryId || null,
            paymentSourceId: r.paymentSourceId || null,
            needsReview: r.needsReview,
            installmentCurrent: r.installmentTotal ? r.installmentCurrent : null,
            installmentTotal: r.installmentTotal,
            approximate: r.approximate,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Não foi possível salvar.");
        return;
      }
      if (data.errors?.length > 0) {
        setError(`${data.created} salvos, ${data.errors.length} falharam.`);
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(30,42,37,0.45)" }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-serif text-lg text-ink">
            {rows
              ? "Revisar lançamentos"
              : sourceType === "audio"
                ? "Falar"
                : sourceType === "text"
                  ? "Colar texto da fatura"
                  : "Enviar imagem"}
          </h2>
          <button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-lg text-muted">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 rounded-lg border border-rust bg-rust-light px-4 py-2 text-sm text-rust">
              {error}
            </div>
          )}

          {!rows && (
            <div className="flex flex-col gap-4">
              {sourceType === "audio" ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-muted">
                    Toque no campo abaixo pra abrir o teclado, depois toque no ícone de microfone{" "}
                    <strong className="text-ink-soft">do próprio teclado</strong> (não é um botão desta
                    tela) pra ditar o gasto — ex: &ldquo;gastei uns quarenta no mercado hoje no
                    cartão&rdquo;.
                  </p>
                  <div className="relative self-center rounded-lg border border-dashed border-border-strong bg-paper px-4 pb-2 pt-5 opacity-80">
                    <span className="absolute left-2 top-1 rounded bg-border-strong px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted">
                      exemplo ilustrativo
                    </span>
                    <svg
                      viewBox="0 0 320 80"
                      role="img"
                      aria-label="Exemplo ilustrativo: teclado de celular com o ícone de microfone perto da barra de espaço — não é parte funcional desta tela"
                      className="w-full max-w-xs"
                    >
                      <rect x="4" y="14" width="312" height="58" rx="10" fill="var(--color-border)" opacity="0.5" />
                      <rect x="16" y="26" width="216" height="34" rx="8" fill="var(--color-card)" stroke="var(--color-border-strong)" />
                      <text x="124" y="48" textAnchor="middle" fontSize="12" fill="var(--color-muted)">
                        barra de espaço
                      </text>
                      <circle cx="272" cy="43" r="20" fill="var(--color-muted)" />
                      <path
                        d="M272 34a5 5 0 0 1 5 5v6a5 5 0 0 1-10 0v-6a5 5 0 0 1 5-5Z M264 45a1.2 1.2 0 0 1 2.4 0 5.6 5.6 0 0 0 11.2 0 1.2 1.2 0 0 1 2.4 0 8 8 0 0 1-6.8 7.9v3.3h3a1.2 1.2 0 0 1 0 2.4h-8.4a1.2 1.2 0 0 1 0-2.4h3v-3.3A8 8 0 0 1 264 45Z"
                        fill="var(--color-card)"
                      />
                    </svg>
                  </div>
                  <p className="text-center text-xs text-muted">
                    O desenho acima é só um exemplo de onde esse ícone costuma ficar — não é uma peça
                    clicável desta tela. No seu teclado de verdade, a posição varia: no iPhone costuma
                    ficar perto do espaço ou do &ldquo;retornar&rdquo;; no Android (Gboard), perto do
                    emoji.
                  </p>
                  <textarea
                    ref={audioTextareaRef}
                    value={audioText}
                    onChange={(e) => setAudioText(e.target.value)}
                    placeholder="Use o microfone do teclado para ditar o seu gasto"
                    rows={4}
                    className="w-full rounded-lg border border-border-strong p-3 text-sm outline-none focus:border-accent"
                  />
                </div>
              ) : sourceType === "image" ? (
                <div
                  onDrop={(e) => {
                    e.preventDefault();
                    addFiles(e.dataTransfer.files);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files);
                    if (files.length > 0) addFiles(files);
                  }}
                  className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-border-strong p-8 text-center"
                >
                  <p className="text-sm text-muted">
                    Arraste a imagem da fatura aqui, cole (Ctrl+V) ou escolha um arquivo.
                  </p>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="min-h-11 rounded-lg border border-border-strong px-4 text-sm text-accent-dark"
                  >
                    Escolher arquivo
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => e.target.files && addFiles(e.target.files)}
                  />
                  {images.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {images.map((img, i) => (
                        <div key={i} className="relative">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.previewUrl} alt="" className="h-20 w-20 rounded object-cover" />
                          <button
                            type="button"
                            onClick={() => removeImage(i)}
                            className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-rust text-xs text-white"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Cole aqui o texto da fatura..."
                  rows={10}
                  className="w-full rounded-lg border border-border-strong p-3 text-sm outline-none focus:border-accent"
                />
              )}

              {sourceType !== "audio" && (
                <button
                  type="button"
                  onClick={() => setSourceType(sourceType === "image" ? "text" : "image")}
                  className="self-start text-sm text-accent-dark underline-offset-2 hover:underline"
                >
                  {sourceType === "image"
                    ? "ou cole o texto da fatura em vez de enviar imagem"
                    : "ou envie a imagem da fatura em vez de colar o texto"}
                </button>
              )}

              <button
                type="button"
                disabled={
                  processing ||
                  (sourceType === "image"
                    ? images.length === 0
                    : sourceType === "audio"
                      ? !audioText.trim()
                      : !text.trim())
                }
                onClick={processSource}
                className="min-h-11 self-start rounded-lg bg-accent px-5 text-sm font-medium text-white disabled:opacity-50"
              >
                {processing ? "Processando..." : "Processar"}
              </button>
            </div>
          )}

          {rows && (
            <div className="flex flex-col gap-3">
              {rows.length === 0 && (
                <p className="py-6 text-center text-sm text-muted">
                  Nenhum lançamento identificado nessa fatura.
                </p>
              )}
              {rows.map((row) => {
                const rowTree = treeCache[row.ledgerId] ?? [];
                const rowLeaves = flattenLeaves(rowTree);
                const topLevelCategories = rowTree.filter((c) => c.category_type === "normal");
                return (
                <div key={row.key} className="rounded-lg border border-border-strong p-3">
                  <div className="mb-2 flex flex-wrap gap-2">
                    {row.needsReview && (
                      <span className="rounded-full bg-accent-light px-3 py-1 text-xs text-accent-dark">
                        Revisar categoria
                      </span>
                    )}
                    {row.possibleDuplicate && (
                      <span className="rounded-full px-3 py-1 text-xs" style={{ background: "var(--row-awaiting-bg)", color: "var(--row-awaiting-text)" }}>
                        Possível duplicidade
                      </span>
                    )}
                    {row.categoryNotFound && (
                      <span className="rounded-full bg-rust-light px-3 py-1 text-xs text-rust">
                        IA sugeriu &ldquo;{row.aiCategoryGuess}&rdquo; — não encontrada
                      </span>
                    )}
                    {row.matchedRuleId && (
                      <span className="rounded-full bg-accent-light px-3 py-1 text-xs text-accent-dark">
                        Regra aplicada
                      </span>
                    )}
                    <label className="flex items-center gap-1 rounded-full border border-border-strong px-3 py-1 text-xs text-ink-soft">
                      <input
                        type="checkbox"
                        checked={row.approximate}
                        onChange={(e) => updateRow(row.key, { approximate: e.target.checked })}
                      />
                      Valor aproximado
                    </label>
                    {row.installmentTotal && (
                      <span className="flex items-center gap-1 rounded-full border border-border-strong px-3 py-1 text-xs text-ink-soft">
                        Parcela
                        <input
                          type="number"
                          min={1}
                          max={row.installmentTotal}
                          value={row.installmentCurrent ?? 1}
                          onChange={(e) =>
                            updateRow(row.key, {
                              installmentCurrent: Math.min(
                                Math.max(1, Number(e.target.value) || 1),
                                row.installmentTotal!,
                              ),
                            })
                          }
                          className="w-10 rounded border border-border-strong bg-card px-1 text-center"
                          title="A IA às vezes só sabe o total de parcelas, não qual está em andamento — corrija se necessário"
                        />
                        /{row.installmentTotal}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <label className="flex flex-col gap-0.5 text-xs text-muted">
                      Data
                      <input
                        type="date"
                        value={row.date}
                        onChange={(e) => updateRow(row.key, { date: e.target.value })}
                        className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
                      />
                    </label>
                    <label className="flex min-w-40 flex-1 flex-col gap-0.5 text-xs text-muted">
                      Descrição
                      <input
                        type="text"
                        value={row.description}
                        onChange={(e) => updateRow(row.key, { description: e.target.value })}
                        className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
                      />
                    </label>
                    <label className="flex w-28 flex-col gap-0.5 text-xs text-muted">
                      Valor
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.amount}
                        onChange={(e) => updateRow(row.key, { amount: e.target.value })}
                        className="money min-h-11 rounded-lg border border-border-strong px-2 text-sm"
                      />
                    </label>
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    {ledgers.length > 1 && (
                      <label className="flex flex-col gap-0.5 text-xs text-muted">
                        Orçamento
                        <select
                          value={row.ledgerId}
                          onChange={(e) => changeRowLedger(row.key, e.target.value)}
                          className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
                        >
                          {ledgers.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="flex flex-1 flex-col gap-0.5 text-xs text-muted">
                      Categoria
                      <select
                        value={row.categoryId}
                        onChange={(e) => updateRow(row.key, { categoryId: e.target.value })}
                        className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
                      >
                        <option value="">Aguardando Revisão</option>
                        {rowLeaves.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-1 flex-col gap-0.5 text-xs text-muted">
                      Forma de pagamento
                      <select
                        value={row.paymentSourceId}
                        onChange={(e) => updateRow(row.key, { paymentSourceId: e.target.value })}
                        className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
                      >
                        <option value="">Opcional</option>
                        {paymentSources.map((ps) => (
                          <option key={ps.id} value={ps.id}>
                            {ps.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setNewCategoryForm({
                          rowKey: row.key,
                          ledgerId: row.ledgerId,
                          name: "",
                          parentId: "",
                          createNewParent: false,
                          newParentName: "",
                          error: null,
                          saving: false,
                        })
                      }
                      className="min-h-11 rounded-lg border border-border-strong px-3 text-sm text-accent-dark"
                    >
                      + Nova categoria
                    </button>
                    <button
                      type="button"
                      disabled={row.ruleSavedForCategoryId !== null && row.ruleSavedForCategoryId === row.categoryId}
                      onClick={() =>
                        setRuleForm({
                          rowKey: row.key,
                          pattern: suggestPattern(row.description),
                          ledgerId: row.ledgerId,
                          categoryId: row.categoryId || rowLeaves[0]?.id || "",
                          isAmbiguous: false,
                        })
                      }
                      className="min-h-11 rounded-lg border border-border-strong px-3 text-sm text-accent-dark disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {row.ruleSavedForCategoryId !== null && row.ruleSavedForCategoryId === row.categoryId
                        ? "Regra salva ✓"
                        : "Salvar regra"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      className="min-h-11 rounded-lg px-3 text-sm text-rust"
                    >
                      Remover
                    </button>
                  </div>

                  {newCategoryForm?.rowKey === row.key && (
                    <div className="mt-2 flex flex-col gap-2 rounded-lg bg-accent-light p-2">
                      {newCategoryForm.error && (
                        <p className="text-xs text-rust">{newCategoryForm.error}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="flex flex-1 flex-col gap-0.5 text-xs text-muted">
                          Nome da categoria
                          <input
                            type="text"
                            autoFocus
                            value={newCategoryForm.name}
                            onChange={(e) => setNewCategoryForm({ ...newCategoryForm, name: e.target.value })}
                            placeholder="ex: Supermercado"
                            className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
                          />
                        </label>
                        {newCategoryForm.createNewParent ? (
                          <label className="flex flex-1 flex-col gap-0.5 text-xs text-muted">
                            Nome da categoria-mãe (nova)
                            <input
                              type="text"
                              value={newCategoryForm.newParentName}
                              onChange={(e) =>
                                setNewCategoryForm({ ...newCategoryForm, newParentName: e.target.value })
                              }
                              placeholder="ex: Mercado/Rancho"
                              className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
                            />
                          </label>
                        ) : (
                          <label className="flex flex-1 flex-col gap-0.5 text-xs text-muted">
                            Categoria-mãe
                            <select
                              value={newCategoryForm.parentId}
                              onChange={(e) => setNewCategoryForm({ ...newCategoryForm, parentId: e.target.value })}
                              className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
                            >
                              <option value="">— categoria própria (sem categoria-mãe) —</option>
                              {topLevelCategories.map((c) => (
                                <option key={c.id} value={c.id}>
                                  subcategoria de: {c.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex items-center gap-1 text-xs text-ink-soft">
                          <input
                            type="checkbox"
                            checked={newCategoryForm.createNewParent}
                            onChange={(e) =>
                              setNewCategoryForm({
                                ...newCategoryForm,
                                createNewParent: e.target.checked,
                                parentId: "",
                              })
                            }
                          />
                          colocar dentro de uma categoria-mãe nova
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={newCategoryForm.saving}
                          onClick={submitNewCategory}
                          className="min-h-11 rounded-lg bg-accent px-3 text-sm text-white disabled:opacity-50"
                        >
                          {newCategoryForm.saving ? "Criando..." : "Criar e usar aqui"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewCategoryForm(null)}
                          className="min-h-11 rounded-lg px-3 text-sm text-muted"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}

                  {ruleForm?.rowKey === row.key && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-accent-light p-2">
                      <input
                        type="text"
                        value={ruleForm.pattern}
                        onChange={(e) => setRuleForm({ ...ruleForm, pattern: e.target.value })}
                        placeholder="Padrão (ex: ifood)"
                        className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
                      />
                      <select
                        value={ruleForm.categoryId}
                        onChange={(e) => setRuleForm({ ...ruleForm, categoryId: e.target.value })}
                        className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
                      >
                        {rowLeaves.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                      <label className="flex items-center gap-1 text-xs text-ink-soft">
                        <input
                          type="checkbox"
                          checked={ruleForm.isAmbiguous}
                          onChange={(e) => setRuleForm({ ...ruleForm, isAmbiguous: e.target.checked })}
                        />
                        sempre ambíguo
                      </label>
                      <button
                        type="button"
                        onClick={submitRule}
                        className="min-h-11 rounded-lg bg-accent px-3 text-sm text-white"
                      >
                        Confirmar
                      </button>
                      <button
                        type="button"
                        onClick={() => setRuleForm(null)}
                        className="min-h-11 rounded-lg px-3 text-sm text-muted"
                      >
                        Cancelar
                      </button>
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}
        </div>

        {rows && rows.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-6 py-4">
            <span className="text-sm text-muted">
              {rows.length} lançamento(s) —{" "}
              {formatBRL(rows.reduce((s, r) => s + (Number(r.amount.replace(",", ".")) || 0), 0))}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRows(null)}
                className="min-h-11 rounded-lg px-4 text-sm text-muted"
              >
                Voltar
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={saveAll}
                className="min-h-11 rounded-lg bg-accent px-5 text-sm font-medium text-white disabled:opacity-50"
              >
                {saving ? "Salvando..." : "Salvar tudo"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
