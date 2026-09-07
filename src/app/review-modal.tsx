"use client";

import { useRef, useState } from "react";
import type { CategorySummaryNode } from "@/lib/budget-summary/service";
import type { PaymentSourceRow } from "@/lib/payment-sources/service";
import { formatBRL, parseBRLAmount } from "@/lib/format";

type SourceType = "image" | "text";

type UploadedImage = { data: string; mediaType: string; previewUrl: string };

type DraftRow = {
  key: string;
  date: string;
  description: string;
  amount: string;
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
  savingRule: boolean;
};

function suggestPattern(description: string): string {
  const tokens = description.split(/[\s*]+/).filter((t) => t.length >= 3);
  return tokens[0] ?? description;
}

export function ReviewModal({
  leaves,
  paymentSources,
  onClose,
  onSaved,
}: {
  leaves: CategorySummaryNode[];
  paymentSources: PaymentSourceRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sourceType, setSourceType] = useState<SourceType>("image");
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<DraftRow[] | null>(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<{
    rowKey: string;
    pattern: string;
    categoryId: string;
    isAmbiguous: boolean;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
          ? { sourceType, images: images.map(({ data, mediaType }) => ({ data, mediaType })) }
          : { sourceType, text };

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
            },
            index: number,
          ): DraftRow => ({
            key: `${index}-${item.description}`,
            date: item.date,
            description: item.description,
            amount: String(item.amount),
            categoryId: item.categoryId ?? "",
            categoryName: item.categoryName,
            needsReview: item.needsReview,
            possibleDuplicate: item.possibleDuplicate,
            categoryNotFound: item.categoryNotFound,
            aiCategoryGuess: item.aiCategoryGuess,
            matchedRuleId: item.matchedRuleId,
            installmentCurrent: item.installmentCurrent,
            installmentTotal: item.installmentTotal,
            paymentSourceId: "",
            savingRule: false,
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

  async function submitRule() {
    if (!ruleForm) return;
    updateRow(ruleForm.rowKey, { savingRule: true });
    await fetch("/api/merchant-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pattern: ruleForm.pattern,
        categoryId: ruleForm.categoryId,
        isAmbiguous: ruleForm.isAmbiguous,
      }),
    });
    updateRow(ruleForm.rowKey, { savingRule: false });
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
            categoryId: r.categoryId || null,
            paymentSourceId: r.paymentSourceId || null,
            needsReview: r.needsReview,
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
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-serif text-lg text-ink">Processar fatura</h2>
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
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSourceType("image")}
                  className={`min-h-11 rounded-lg px-4 text-sm ${sourceType === "image" ? "bg-accent text-white" : "border border-border-strong text-ink-soft"}`}
                >
                  Imagem
                </button>
                <button
                  type="button"
                  onClick={() => setSourceType("text")}
                  className={`min-h-11 rounded-lg px-4 text-sm ${sourceType === "text" ? "bg-accent text-white" : "border border-border-strong text-ink-soft"}`}
                >
                  Texto colado
                </button>
              </div>

              {sourceType === "image" ? (
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

              <button
                type="button"
                disabled={processing || (sourceType === "image" ? images.length === 0 : !text.trim())}
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
              {rows.map((row) => (
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
                    {(row.installmentCurrent ?? 1) > 0 && row.installmentTotal && (
                      <span className="rounded-full border border-border-strong px-3 py-1 text-xs text-ink-soft">
                        Parcela {row.installmentCurrent}/{row.installmentTotal}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <input
                      type="date"
                      value={row.date}
                      onChange={(e) => updateRow(row.key, { date: e.target.value })}
                      className="min-h-11 rounded-lg border border-border-strong px-2 text-sm"
                    />
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) => updateRow(row.key, { description: e.target.value })}
                      className="min-h-11 min-w-40 flex-1 rounded-lg border border-border-strong px-2 text-sm"
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      value={row.amount}
                      onChange={(e) => updateRow(row.key, { amount: e.target.value })}
                      className="money min-h-11 w-28 rounded-lg border border-border-strong px-2 text-sm"
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select
                      value={row.categoryId}
                      onChange={(e) => updateRow(row.key, { categoryId: e.target.value })}
                      className="min-h-11 flex-1 rounded-lg border border-border-strong px-2 text-sm"
                    >
                      <option value="">Aguardando Revisão</option>
                      {leaves.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={row.paymentSourceId}
                      onChange={(e) => updateRow(row.key, { paymentSourceId: e.target.value })}
                      className="min-h-11 flex-1 rounded-lg border border-border-strong px-2 text-sm"
                    >
                      <option value="">Origem (opcional)</option>
                      {paymentSources.map((ps) => (
                        <option key={ps.id} value={ps.id}>
                          {ps.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setRuleForm({
                          rowKey: row.key,
                          pattern: suggestPattern(row.description),
                          categoryId: row.categoryId || leaves[0]?.id || "",
                          isAmbiguous: false,
                        })
                      }
                      className="min-h-11 rounded-lg border border-border-strong px-3 text-sm text-accent-dark"
                    >
                      Salvar regra
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(row.key)}
                      className="min-h-11 rounded-lg px-3 text-sm text-rust"
                    >
                      Remover
                    </button>
                  </div>

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
                        {leaves.map((l) => (
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
              ))}
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
