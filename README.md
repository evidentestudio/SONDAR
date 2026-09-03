# Sondar

Controle financeiro pessoal/familiar. Migração web do protótipo "Controle
financeiro" (Sonar 2.0), construída em etapas — ver `sondar-etapas-implementacao.md`.

**Etapa atual: 0 — Fundação.**

## Stack

Next.js (App Router) + Postgres + Tailwind CSS. Consulte `db/sondar_schema.sql`
para o schema completo (aplicado por inteiro desde a Etapa 0).

## Setup local

1. Postgres rodando localmente (ou aponte `DATABASE_URL` para outro banco).
2. Copie `.env.example` para `.env.local` e preencha:
   - `DATABASE_URL`
   - `SESSION_SECRET` — gere com `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - `SEED_USER1_*` / `SEED_USER2_*` — os dois membros do household (não há
     cadastro aberto; login só funciona para quem foi semeado aqui)
3. Instale as dependências e aplique o schema:

   ```bash
   npm install
   npm run db:migrate   # aplica db/000_extensions.sql, db/sondar_schema.sql, db/001_auth.sql, em ordem
   npm run db:seed       # cria o household e os 2 usuários a partir do .env.local
   ```

4. `npm run dev` e abra http://localhost:3000 — deve redirecionar para
   `/login`; entre com as credenciais semeadas.

## Scripts

- `npm run dev` / `npm run build` / `npm run start`
- `npm run lint`
- `npm test` — vitest (conexão com o banco, existência de todas as
  tabelas/views do schema, hash de senha, sessão JWT, fluxo de login)
- `npm run db:migrate` — reaplica o schema (idempotente: usa `IF NOT EXISTS`/
  `CREATE OR REPLACE` em tudo)
- `npm run db:seed` — idempotente: nunca sobrescreve household ou usuário já
  existente

## Estrutura do banco

- `db/sondar_schema.sql` — o schema entregue, sem alterações estruturais. As
  únicas 2 mudanças em relação ao arquivo original são puramente sintáticas
  (Postgres exige função `IMMUTABLE` em coluna gerada / índice de expressão) e
  estão documentadas no cabeçalho do próprio arquivo.
- `db/000_extensions.sql` — extensões (`unaccent`, `pgcrypto`) + o wrapper
  `immutable_unaccent()` que a mudança acima usa. Roda antes do schema.
- `db/001_auth.sql` — adiciona `users.password_hash`, único campo que o schema
  original não tinha e que o login básico da Etapa 0 precisa. Roda depois do
  schema.

## Autenticação (Etapa 0)

Login básico para os dois membros do household — sem cadastro aberto, sem
multiusuário genérico (isso fica fora de escopo até depois da Etapa 7, ver
`sondar-etapas-implementacao.md`). Sessão é um JWT assinado (HS256, `jose`) em
cookie httpOnly; senha com bcrypt. `src/proxy.ts` (era `middleware.ts` até o
Next.js 16 renomear a convenção) protege todas as rotas exceto `/login` e
`/api/auth/*`.
