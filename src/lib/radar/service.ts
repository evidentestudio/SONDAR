import Anthropic from "@anthropic-ai/sdk";
import type { CategorySummaryNode } from "@/lib/budget-summary/service";
import type { CategoryBudgetInput } from "@/lib/radar/redistribution";

// Mesmo modelo padrão já usado pra extração por IA (src/lib/ai/extract.ts) —
// consistência de custo/qualidade em todo o app.
const MODEL = "claude-opus-5";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY não está configurada.");
  return new Anthropic({ apiKey });
}

/**
 * Categorias-folha com orçado/gasto do mês — mesma regra de "o que é
 * filtrável" já usada em dashboard_filters e no Painel (src/app/painel/
 * painel-manager.tsx: collectFilterableRows): só categoria-folha, nunca a
 * mãe nem o "sem subcategoria" sintético (esse não tem onde receber um
 * orçado próprio). Também exclui category_type diferente de 'normal' —
 * reserva e "aguardando revisão" não fazem sentido nem pro diagnóstico nem
 * pra redistribuição de meta mensal.
 */
export function flattenLeafBudgets(nodes: CategorySummaryNode[]): CategoryBudgetInput[] {
  const out: CategoryBudgetInput[] = [];
  for (const node of nodes) {
    if (node.categoryType !== "normal") continue;
    if (node.children.length === 0) {
      out.push({ categoryId: node.id, label: node.name, orcado: node.orcado, gasto: node.gasto });
      continue;
    }
    for (const child of node.children) {
      if (child.categoryType !== "normal") continue;
      out.push({
        categoryId: child.id,
        label: `${node.name} — ${child.name}`,
        orcado: child.orcado,
        gasto: child.gasto,
      });
    }
  }
  return out;
}

export type CategoryStatus = "dentro" | "perto" | "estourado";

/** Mesmos limiares (70%/100%) e mesmo tratamento do caso "sem orçado mas com
 * gasto" já usados nas cores do Painel (statusColor em painel-manager.tsx) —
 * o Radar nunca pode classificar diferente do que a pessoa já vê na tela. */
export function classifyStatus(gasto: number, orcado: number): CategoryStatus {
  if (orcado <= 0) return gasto > 0 ? "estourado" : "dentro";
  const pct = gasto / orcado;
  if (pct >= 1) return "estourado";
  if (pct >= 0.7) return "perto";
  return "dentro";
}

export type CategoryWithHistory = CategoryBudgetInput & {
  status: CategoryStatus;
  /** Gasto dos meses anteriores disponíveis, do mais antigo pro mais recente
   * (não inclui o mês atual). */
  historicoGasto: { mes: string; gasto: number }[];
};

export type RadarDiagnosis = {
  diagnosis: string;
  tips: string[];
  patterns: string[];
};

function parseJsonObject(text: string): RadarDiagnosis {
  const cleaned = text.replace(/```json|```/g, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("A IA não retornou um JSON válido.");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as RadarDiagnosis).diagnosis !== "string" ||
    !Array.isArray((parsed as RadarDiagnosis).tips) ||
    !Array.isArray((parsed as RadarDiagnosis).patterns)
  ) {
    throw new Error("A IA não retornou o formato esperado.");
  }
  return parsed as RadarDiagnosis;
}

/**
 * Diagnóstico do Radar Financeiro — sempre sob pedido (nunca automático ao
 * abrir o Painel, por decisão do usuário, pra não consumir chamadas de IA
 * silenciosamente). Só recebe as categorias já existentes do usuário e seus
 * números reais; a IA nunca decide valores de redistribuição (isso é
 * aritmética exata, ver src/lib/radar/redistribution.ts) — aqui ela só
 * escreve o diagnóstico em português, as dicas qualitativas e os padrões de
 * consumo identificados no histórico fornecido.
 */
export async function buildRadarDiagnosis(
  categories: CategoryWithHistory[],
  monthLabel: string,
): Promise<RadarDiagnosis> {
  const client = getClient();

  const payload = categories.map((c) => ({
    categoria: c.label,
    orcado: c.orcado,
    gasto: c.gasto,
    status: c.status,
    historico_gasto_meses_anteriores: c.historicoGasto,
  }));

  const prompt = `Você é o "Radar Financeiro" do Sondar, um app de controle financeiro familiar. Responda sempre em português do Brasil.

Mês analisado: ${monthLabel}. Dados reais de TODAS as categorias com orçamento do usuário (não existe nenhuma categoria fora desta lista — nunca mencione ou sugira uma categoria que não esteja aqui):
${JSON.stringify(payload, null, 2)}

"status" já foi calculado: "dentro" (dentro da meta), "perto" (perto de estourar, 70% ou mais do orçado), "estourado" (gasto igual ou maior que o orçado, ou gasto sem nenhum orçado definido). A meta de cada categoria é o próprio valor orçado dela.

Gere:
1. "diagnosis": um diagnóstico curto (2 a 4 frases) sobre a saúde geral do orçamento deste mês.
2. "tips": até 5 dicas práticas de como reorganizar os orçados entre as categorias listadas pra não estourar a meta mensal. Fale em termos qualitativos (ex: "dá pra reduzir um pouco o orçado de Lazer, que está com folga, e reforçar o de Mercado, que está perto de estourar") — NUNCA proponha um valor numérico exato de redistribuição, isso é calculado por outra parte do sistema.
3. "patterns": até 3 padrões de consumo identificados no histórico fornecido (ex: uma categoria subindo há vários meses seguidos, ou uma queda notável). Se não houver histórico suficiente pra alguma categoria, apenas não comente padrão nenhum sobre ela.

Responda APENAS com um JSON no formato exato abaixo (sem markdown, sem texto antes ou depois):
{"diagnosis": "...", "tips": ["...", "..."], "patterns": ["...", "..."]}`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    output_config: { effort: "medium" },
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("A IA recusou gerar esse diagnóstico.");
  }
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("A IA não retornou texto.");
  }
  return parseJsonObject(textBlock.text);
}
