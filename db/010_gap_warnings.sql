-- ---------------------------------------------------------------------------
-- payment_sources.leaves_no_paper_trail
-- ---------------------------------------------------------------------------
-- "Lacunas de registro (dinheiro e Pix)" — sondar-melhorias-multimodal.md
-- seção 3. Gasto de cartão tem rede de segurança (o print da fatura pega
-- depois); dinheiro e Pix não têm. Formas de pagamento são livres/nomeadas
-- pelo próprio usuário ("Dimensão livre" — sondar_schema.sql), então não dá
-- pra adivinhar por nome quais são "sem comprovante" — a pessoa marca
-- explicitamente na hora de criar/editar. Default false preserva toda forma
-- de pagamento existente exatamente como está.
ALTER TABLE payment_sources ADD COLUMN leaves_no_paper_trail BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- categories.gap_alerts_silenced_at
-- ---------------------------------------------------------------------------
-- "Não me avise mais sobre isso" por categoria (seção 3.3) — obrigatório,
-- senão quem cortou uma categoria de propósito receberia o aviso pra
-- sempre. NULL = avisos ativos (padrão). Cobre os dois avisos da seção 3
-- (queda de lançamentos manuais e lembrete de recorrente sumido) juntos,
-- não um por tipo — são a mesma preocupação ("essa categoria some do
-- controle") sob duas redações diferentes.
ALTER TABLE categories ADD COLUMN gap_alerts_silenced_at TIMESTAMPTZ;
