import Anthropic from "@anthropic-ai/sdk";

// Opus 5 is Anthropic's current default per house policy — never silently
// downgrade to a cheaper model for cost reasons; that's the user's call.
const MODEL = "claude-opus-5";

type ImageMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não está configurada.");
  return new Anthropic({ apiKey });
}

export type RawExtractedItem = {
  date: string;
  description: string;
  amount: number;
  category: string;
  revisar: boolean;
  installment_current?: number | null;
  installment_total?: number | null;
  /** Só preenchido pela extração de áudio (buildAudioExtractionPrompt) —
   * true quando a fala soou como estimativa ("uns quarenta"), nunca
   * presente/relevante pra fatura (imagem/texto), que é sempre valor exato. */
  approximate?: boolean | null;
  /** Idem — forma de pagamento mencionada na fala (ex: "cartão", "pix"),
   * resolvida contra as formas reais do household em processExtractedItems. */
  payment_source_hint?: string | null;
};

/**
 * Assistant-message prefill is rejected outright on claude-opus-5, so
 * reliability comes entirely from the prompt's own "respond with JSON only"
 * instruction — same approach already validated in the prototype (strip any
 * accidental markdown fence, then JSON.parse).
 */
function parseJsonArray(text: string): RawExtractedItem[] {
  const cleaned = text.replace(/```json|```/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("A IA não retornou um JSON válido.");
  }
  if (!Array.isArray(parsed)) throw new Error("A IA não retornou um array.");
  return parsed as RawExtractedItem[];
}

function extractText(response: Anthropic.Message): string {
  if (response.stop_reason === "refusal") {
    throw new Error("A IA recusou processar esse conteúdo.");
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("A IA não retornou texto.");
  }
  return textBlock.text;
}

export async function extractFromImages(
  images: { data: string; mediaType: ImageMediaType }[],
  prompt: string,
): Promise<RawExtractedItem[]> {
  const client = getClient();
  const content: Anthropic.ContentBlockParam[] = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.data },
  }));
  content.push({ type: "text", text: prompt });

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    output_config: { effort: "medium" },
    messages: [{ role: "user", content }],
  });

  return parseJsonArray(extractText(response));
}

export async function extractFromText(
  invoiceText: string,
  prompt: string,
): Promise<RawExtractedItem[]> {
  const client = getClient();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    output_config: { effort: "medium" },
    messages: [
      { role: "user", content: `${prompt}\n\nTexto colado da fatura:\n${invoiceText}` },
    ],
  });

  return parseJsonArray(extractText(response));
}
