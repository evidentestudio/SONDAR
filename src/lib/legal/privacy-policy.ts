/**
 * Rascunho técnico, não jurídico — o conteúdo abaixo reflete com precisão o
 * que o Sondar realmente faz com os dados (mapeado ao longo do
 * desenvolvimento), mas o texto em si não passou por revisão de advogado.
 * Não publicar como documento legal definitivo antes dessa revisão — ver
 * PENDENCIAS.md, seção "Segurança / LGPD".
 *
 * PRIVACY_POLICY_VERSION muda sempre que o conteúdo abaixo muda de forma
 * relevante — cada mudança de versão exige novo consentimento do usuário no
 * próximo login (a implementar), e fica registrada em consent_records
 * (db/007_lgpd_consent.sql) qual versão cada aceite corresponde.
 */
export const PRIVACY_POLICY_VERSION = "2026-09-10";

export type PrivacyPolicySection = { title: string; paragraphs: string[] };

export const PRIVACY_POLICY_SECTIONS: PrivacyPolicySection[] = [
  {
    title: "Quem trata os seus dados",
    paragraphs: [
      "O Sondar é o responsável pelo tratamento dos dados descritos nesta política. [PENDENTE: razão social/CNPJ e contato do responsável.]",
      "Para operar o serviço, alguns dados passam por terceiros que prestam infraestrutura técnica (operadores, não donos dos dados): Vercel (hospedagem da aplicação), Neon (banco de dados), Anthropic (processamento por inteligência artificial das faturas/lançamentos enviados) e Resend (envio de emails de confirmação de cadastro e redefinição de senha).",
    ],
  },
  {
    title: "Quais dados coletamos",
    paragraphs: [
      "Dados de cadastro: nome, email e senha. A senha nunca é armazenada em texto — só um hash irreversível.",
      "Dados financeiros que você mesmo insere: lançamentos, categorias, orçamentos, formas de pagamento, parcelamentos e notas.",
      "Quando você envia uma fatura (imagem, texto ou áudio) para extração automática por IA: a imagem/áudio em si nunca é armazenado — só o resultado da extração (descrição, valor, data, categoria sugerida) é salvo.",
    ],
  },
  {
    title: "Por que tratamos esses dados",
    paragraphs: [
      "Para fornecer o serviço de controle financeiro que você criou uma conta para usar (execução do que foi combinado com você).",
      "Com base no seu consentimento explícito, dado no momento do cadastro.",
    ],
  },
  {
    title: "Por quanto tempo guardamos",
    paragraphs: [
      "Enquanto sua conta existir. Ao pedir a exclusão da conta, seus dados somem do seu acesso imediatamente e são apagados de forma definitiva do banco em até 30 dias — uma janela de segurança contra exclusão acidental ou indevida.",
    ],
  },
  {
    title: "Seus direitos",
    paragraphs: [
      "Acesso, correção, exclusão e portabilidade dos seus dados, e revogação do seu consentimento a qualquer momento.",
      "[PENDENTE: funcionalidade de autoatendimento (exportar/excluir meus dados) ainda em desenvolvimento — ver PENDENCIAS.md. Até lá, esses pedidos podem ser feitos diretamente pelo contato acima.]",
    ],
  },
  {
    title: "Segurança",
    paragraphs: [
      "Senhas armazenadas com hash, nunca em texto puro. Conexão sempre criptografada (HTTPS). Isolamento técnico entre famílias reforçado no próprio banco de dados (Row-Level Security), além do controle de acesso da aplicação.",
    ],
  },
];
