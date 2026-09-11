import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/auth/current";
import { listLeafCategories } from "@/lib/categories/service";
import { listMerchantRules } from "@/lib/merchant-rules/service";
import { resolveLedgerId } from "@/lib/ledgers/service";
import { buildExtractionPrompt, buildAudioExtractionPrompt } from "@/lib/ai/prompt";
import { extractFromImages, extractFromText, precheckImage } from "@/lib/ai/extract";
import { processExtractedItems } from "@/lib/ai/pipeline";
import { logExtraction } from "@/lib/ai/logs";
import { hasReachedMonthlyExtractionCap, MAX_EXTRACTIONS_PER_MONTH } from "@/lib/ai/limits";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const sourceType =
    body?.sourceType === "image"
      ? "image"
      : body?.sourceType === "text"
        ? "text"
        : body?.sourceType === "audio"
          ? "audio"
          : null;
  if (!sourceType) {
    return NextResponse.json({ error: "sourceType precisa ser 'image', 'text' ou 'audio'." }, { status: 400 });
  }

  // Teto de segurança por período (sondar-melhorias-multimodal.md seção 2) —
  // checado antes de qualquer chamada de IA, pra nunca gerar custo além dele.
  if (await hasReachedMonthlyExtractionCap(session.householdId)) {
    return NextResponse.json(
      {
        error: `Limite de ${MAX_EXTRACTIONS_PER_MONTH} processamentos por IA neste mês foi atingido. O limite é renovado no início do próximo mês.`,
      },
      { status: 429 },
    );
  }

  // The whole batch resolves against one ledger (default "Principal") —
  // individual rows can still be moved to another ledger in the review
  // screen, which re-resolves that row's category against the new ledger.
  const ledgerId = await resolveLedgerId(session.householdId, body?.ledgerId);

  const leaves = await listLeafCategories(session.householdId, ledgerId);
  const leafCategoryNames = leaves
    .filter((c) => c.category_type !== "awaiting_review")
    .map((c) => c.name);

  if (leafCategoryNames.length === 0) {
    return NextResponse.json(
      { error: "Crie ao menos uma categoria nesse orçamento antes de processar uma fatura." },
      { status: 400 },
    );
  }

  const now = new Date();

  try {
    let rawItems;
    if (sourceType === "image" || sourceType === "text") {
      const rules = (await listMerchantRules(session.householdId)).filter((r) => r.ledger_id === ledgerId);
      const merchantRules = rules
        .filter((r) => !r.is_ambiguous)
        .map((r) => ({ pattern: r.pattern, category: r.category_name }));
      const prompt = buildExtractionPrompt({
        leafCategoryNames,
        merchantRules,
        currentMonth: now.getUTCMonth() + 1,
        currentYear: now.getUTCFullYear(),
      });

      if (sourceType === "image") {
        const images = Array.isArray(body?.images) ? body.images : [];
        if (images.length === 0) {
          return NextResponse.json({ error: "Envie ao menos uma imagem." }, { status: 400 });
        }
        for (const img of images) {
          if (!ALLOWED_IMAGE_TYPES.has(img?.mediaType)) {
            return NextResponse.json({ error: "Tipo de imagem não suportado." }, { status: 400 });
          }
        }
        const precheck = await precheckImage(images);
        if (!precheck.ok) {
          return NextResponse.json({ error: precheck.reason }, { status: 400 });
        }
        rawItems = await extractFromImages(images, prompt);
      } else {
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (!text) return NextResponse.json({ error: "Cole o texto da fatura." }, { status: 400 });
        rawItems = await extractFromText(text, prompt);
      }
    } else {
      // audio — transcrição já feita no dispositivo (section 1.3), só o
      // texto chega aqui. Rascunho sempre passa pela revisão normal, nunca
      // salva direto (section 1.1) — processExtractedItems/save-batch são
      // os mesmos de imagem/texto, só o prompt e o input_method diferem.
      const text = typeof body?.text === "string" ? body.text.trim() : "";
      if (!text) return NextResponse.json({ error: "Fale ou digite o que você gastou." }, { status: 400 });
      const audioPrompt = buildAudioExtractionPrompt({
        leafCategoryNames,
        today: now.toISOString().slice(0, 10),
      });
      rawItems = await extractFromText(text, audioPrompt);
    }

    const items = await processExtractedItems(session.householdId, ledgerId, rawItems, {
      ruleType: sourceType === "audio" ? "spoken_alias" : "invoice_pattern",
    });
    const flaggedCount = items.filter((i) => i.needsReview || i.possibleDuplicate).length;
    await logExtraction({
      householdId: session.householdId,
      ledgerId,
      sourceType,
      entriesCreated: items.length,
      flaggedCount,
      modelUsed: "claude-opus-5",
    });

    return NextResponse.json({ items, ledgerId });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Erro da IA: ${err.message}` }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "Erro desconhecido ao processar.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
