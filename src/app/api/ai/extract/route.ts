import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSession } from "@/lib/auth/current";
import { listLeafCategories } from "@/lib/categories/service";
import { listMerchantRules } from "@/lib/merchant-rules/service";
import { buildExtractionPrompt } from "@/lib/ai/prompt";
import { extractFromImages, extractFromText } from "@/lib/ai/extract";
import { processExtractedItems } from "@/lib/ai/pipeline";
import { logExtraction } from "@/lib/ai/logs";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const sourceType = body?.sourceType === "image" ? "image" : body?.sourceType === "text" ? "text" : null;
  if (!sourceType) {
    return NextResponse.json({ error: "sourceType precisa ser 'image' ou 'text'." }, { status: 400 });
  }

  const leaves = await listLeafCategories(session.householdId);
  const leafCategoryNames = leaves
    .filter((c) => c.category_type !== "awaiting_review")
    .map((c) => c.name);

  if (leafCategoryNames.length === 0) {
    return NextResponse.json(
      { error: "Crie ao menos uma categoria antes de processar uma fatura." },
      { status: 400 },
    );
  }

  const rules = await listMerchantRules(session.householdId);
  const merchantRules = rules
    .filter((r) => !r.is_ambiguous)
    .map((r) => ({ pattern: r.pattern, category: r.category_name }));

  const now = new Date();
  const prompt = buildExtractionPrompt({
    leafCategoryNames,
    merchantRules,
    currentMonth: now.getUTCMonth() + 1,
    currentYear: now.getUTCFullYear(),
  });

  try {
    let rawItems;
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
      rawItems = await extractFromImages(images, prompt);
    } else {
      const text = typeof body?.text === "string" ? body.text.trim() : "";
      if (!text) return NextResponse.json({ error: "Cole o texto da fatura." }, { status: 400 });
      rawItems = await extractFromText(text, prompt);
    }

    const items = await processExtractedItems(session.householdId, rawItems);
    const flaggedCount = items.filter((i) => i.needsReview || i.possibleDuplicate).length;
    await logExtraction(session.householdId, sourceType, items.length, flaggedCount, "claude-opus-5");

    return NextResponse.json({ items });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      return NextResponse.json({ error: `Erro da IA: ${err.message}` }, { status: 502 });
    }
    const message = err instanceof Error ? err.message : "Erro desconhecido ao processar.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
