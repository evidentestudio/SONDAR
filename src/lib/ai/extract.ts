import Anthropic from "@anthropic-ai/sdk";

// Opus 5 is Anthropic's current default per house policy — never silently
// downgrade to a cheaper model for cost reasons; that's the user's call.
const MODEL = "claude-opus-5";

// Exceção deliberada: só pra pré-checagem barata abaixo (precheckImage), que
// existe justamente pra evitar rodar o MODEL caro em cima de imagem ilegível
// ou sem nenhum lançamento — ver sondar-melhorias-multimodal.md seção 2.
const PRECHECK_MODEL = "claude-haiku-4-5-20251001";

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

export type PrecheckResult = { ok: true } | { ok: false; reason: string };

/**
 * Pré-checagem barata (Haiku, poucos tokens de saída) antes da extração
 * completa (Opus): imagem ilegível ou sem nenhum lançamento visível é
 * recusada aqui, antes de virar custo — sondar-melhorias-multimodal.md
 * seção 2. Qualquer falha em interpretar a resposta da pré-checagem libera a
 * extração completa (nunca bloqueia o usuário por erro nosso).
 */
export async function precheckImage(
  images: { data: string; mediaType: ImageMediaType }[],
): Promise<PrecheckResult> {
  const client = getClient();
  const content: Anthropic.ContentBlockParam[] = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.data },
  }));
  content.push({
    type: "text",
    text: `Responda APENAS com um JSON no formato exato {"legible":true,"has_transaction":true} (sem markdown, sem texto antes ou depois). "legible": a imagem está nítida e legível o suficiente pra ler valores e nomes de estabelecimento? "has_transaction": a imagem mostra ao menos um lançamento/gasto individual (não é uma tela em branco, um documento sem relação com gastos, ou uma imagem sem nenhuma linha de compra)?`,
  });

  const response = await client.messages.create({
    model: PRECHECK_MODEL,
    max_tokens: 100,
    messages: [{ role: "user", content }],
  });

  let parsed: { legible?: boolean; has_transaction?: boolean };
  try {
    parsed = JSON.parse(extractText(response).replace(/```json|```/g, "").trim());
  } catch {
    return { ok: true };
  }
  if (parsed.legible === false) {
    return { ok: false, reason: "Não conseguimos ler essa imagem — tente outra foto, com mais luz e foco." };
  }
  if (parsed.has_transaction === false) {
    return { ok: false, reason: "Não encontramos nenhum lançamento nessa imagem." };
  }
  return { ok: true };
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
