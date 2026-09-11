# Sondar — Melhorias de ingestão multimodal e conciliação

Complemento ao `sondar-etapas-implementacao.md`. Não substitui o plano de etapas
existente: os itens abaixo devem ser encaixados nele por ordem de prioridade.

Princípio que rege tudo neste documento: **o sistema nunca decide sozinho em caso
de dúvida.** Item incerto vai para "revisar", nunca é lançado silenciosamente.
Isso já vale para o dicionário de comerciantes e passa a valer igualmente para
deduplicação, conciliação e sugestões de lacuna.

---

## 1. Ingestão multimodal (foto, áudio, texto)

Escopo confirmado: a pessoa registra gastos do jeito que preferir — print de
histórico/fatura parcial, foto de canhoto, áudio ou digitação. A extração não
depende de fatura fechada.

### 1.1 Áudio é rascunho, não lançamento

- Áudio nunca entra direto como lançamento confirmado. Entra como **pendente**.
- Após a transcrição/extração, devolver imediatamente um cartão de confirmação
  com: valor, data, categoria sugerida, fonte de pagamento.
- Um toque confirma. A correção acontece com a memória fresca, não numa fila de
  revisão dias depois.

### 1.2 Campos novos por lançamento

| Campo | Valores | Uso |
|---|---|---|
| `origem` | `foto` \| `audio` \| `texto` | Regra de deduplicação e conciliação |
| `confianca_valor` | `exato` \| `aproximado` | Áudio arredondado ("uns quarenta") |
| `periodo_coberto` (na imagem) | intervalo de datas | Evita reimportação duplicada |

`periodo_coberto` é gravado na extração da imagem, não no lançamento: sem ele não
dá para saber se o print do dia 18 substitui ou soma ao do dia 10.

### 1.3 Transcrição no dispositivo

Usar a API de ditado do próprio celular quando disponível e enviar só o texto
para a IA. O que se precisa do modelo é a extração, não a transcrição — isso
corta custo e latência.

### 1.4 Apelido falado no dicionário de comerciantes

Não tentar casar "mercado" com string canônica de fatura. Tratar fala como
apelido, no mesmo mecanismo de regras que já existe:

- Dicionário passa a ter **duas chaves**: string de fatura e apelido falado.
- Na primeira ocorrência de um apelido novo, perguntar uma vez a que corresponde
  e gravar. Da segunda em diante, entra direto.

---

## 2. Deduplicação e conciliação

### 2.1 Confirmação pela pessoa (decisão do Pedro)

Lançamentos parecidos geram alerta para a pessoa confirmar: manter os dois ou
fundir em um. O sistema aponta, ela decide.

### 2.2 Filtros para o alerta não virar ruído

Sem estes dois filtros o alerta perde eficácia — a pessoa passa a clicar em
"manter os dois" sem ler:

1. **Só alertar quando as origens forem diferentes.** Áudio + print é suspeito.
   Dois lançamentos digitados por ela na mão no mesmo dia foram intencionais.
2. **Print repetido = uma pergunta, não N.** Se a imagem cobre período já
   importado, perguntar uma única vez de forma agregada:
   *"12 de 18 lançamentos já existem. Importar só os 6 novos?"*

### 2.3 Hierarquia de fontes na conciliação

A fatura/extrato é sempre a verdade; o áudio é sempre estimativa.

Quando chega um print, cada transação procura um pendente de áudio com:

- janela de **±3 dias**
- valor dentro de **±20%** (quem fala arredonda)
- mesma fonte de pagamento

**Achou:** funde — mantém categoria e apelido já atribuídos pela pessoa,
substitui valor e data pelos do banco, marca como conciliado.
**Não achou:** entra como novo; o lançamento de áudio permanece.
**Ambíguo** (dois candidatos, ou valor fora da tolerância): vai para revisão.

### 2.4 Chave determinística de duplicata

Para lançamentos de mesma origem estruturada (print × print):
`data + valor + comerciante normalizado + fonte de pagamento`.
Colisão nunca é resolvida sozinha — duas compras iguais no mesmo dia existem.

---

## 3. Lacunas de registro (dinheiro e Pix)

Problema: gasto de cartão tem rede de segurança (o print da fatura pega depois).
Dinheiro e Pix não têm — se ela esqueceu, ninguém sabe. Categorias pagas em
dinheiro ficam sistematicamente subestimadas e o painel exibe número com
aparência de completo.

**Descartado:** ajuste de saldo de carteira no fim do mês. Depende de a pessoa
contar o dinheiro no início e no fim — comportamento que o público-alvo não tem.

### 3.1 Aviso de queda de lançamentos manuais

Texto (redação do Pedro, mais explícita que "depende de registro manual"):

> Seus lançamentos de gastos em dinheiro ou Pix nesta categoria reduziram
> bastante neste mês. Verifique se foi intencional ou esquecimento de algum
> valor pago em dinheiro ou Pix.

### 3.2 Lembrete de recorrentes não lançados

O Sondar aponta o padrão que sumiu — **sem sugerir valor**:

> Você costuma lançar padaria e feira em dinheiro toda semana. Este mês só
> aparece um lançamento. Faltou algum?

O toque leva à tela de lançamento normal, **vazia**, com a categoria
pré-preenchida. Ela digita o valor.

**Não implementar** lista de gastos prováveis com botão de confirmar: a pessoa
confirma no automático e o orçamento se enche de gasto inventado — o oposto do
princípio de nunca chutar.

### 3.3 Condições de disparo

- Exige **3 meses** do mesmo padrão. Um mês não basta.
- **Uma vez por mês**, agregado, no fechamento. Nunca um alerta por categoria ao
  longo do mês.
- **"Não me avise mais sobre isso"** por categoria, obrigatório. Quem cortou a
  padaria de propósito receberia o aviso para sempre.

---

## 4. Custo e volume

O volume de chamadas de visão/áudio é muito maior que o previsto originalmente
(vários registros por semana por usuário, não uma fatura por mês).

- **Teto de extrações por período**, por usuário.
- **Pré-checagem barata antes da chamada de IA:** imagem ilegível ou sem
  transação é recusada antes de virar custo.
- Recalcular o teto de preço com esse volume.

---

## 5. Revisão em lote

Com entrada multimodal a taxa de "revisar" sobe. Revisar item a item mata o
hábito.

- Lista com edição rápida.
- Aplicar regra de comerciante direto da própria tela de revisão.

---

## 6. Backlog pós-lançamento (ordem de impacto)

1. Lançamentos recorrentes (aluguel, assinaturas) — hoje se paga custo de IA por
   dado que nunca muda.
2. Saldo previsto até o fim do mês (orçado × recorrentes × gasto atual).
3. Exportação CSV/PDF — barato e responde à objeção de aprisionamento de dados.
4. Alerta de estouro de categoria.

---

## 7. Fora de escopo — decisões tomadas

- **Open Finance / conexão bancária: não fazer.** Custo, compliance e
  responsabilidade sobre dado bancário desproporcionais. O posicionamento
  "não conecto seu banco" é mais defensável que integração parcial.
  Observação de marketing: o argumento de venda é **controle sobre a descrição
  do gasto** (lançamento importado fica preso ao texto do banco —
  "PAGSEGURO *XXXXX"), não segurança. Open Finance é consentimento via Banco
  Central, sem senha compartilhada; usar "é inseguro" como argumento é
  contestável em público.
- **"Reset financeiro": adiado, não cancelado.** Se um dia sair, será produto de
  entrada de **entrega imediata** — parecer de vazamentos a partir do relato da
  pessoa, com roteiro de perguntas fixo (não campo livre) —, usado para vender o
  Sondar como continuidade. Não é funcionalidade do Sondar agora.
- **Implicação de arquitetura:** se o Reset (ou qualquer venda) entrar no futuro,
  o schema precisa prever `user_id` e escopo de acesso **desde já**. Retrofitar
  multiusuário com dados reais dentro custa caro.
