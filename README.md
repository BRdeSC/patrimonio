# Patrimônio

Aplicação web **multi-área (multi-tenant)** para gestão de patrimônio de equipamentos.
Inicia atendendo a área **COIDS** e é projetada para se tornar produto geral
(auto-serviço: qualquer área cria o próprio espaço).

**Dor central:** o gestor perde o controle, com o tempo, de *onde estão* os itens e
*quem está com cada um*. **Solução:** cadastro + fotos + busca/ordenação +
atribuição de alterações ("atualizado por") + (próximo) histórico de movimentações.

**Status: MVP (v1)** — ver [ROADMAP.md](./ROADMAP.md).

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript strict**
- **PostgreSQL** + **Prisma 6** (schema via `prisma db push`)
- **FreeIPA** como IdP via LDAPS (só autentica — **nenhuma senha é armazenada**)
- **Tailwind CSS 4** (tema claro/escuro)
- **Vitest** (unit + integração contra Postgres isolado)

## Rodando com Docker (tudo em um comando)

Pré-requisito: Docker Compose. Se você tem um Postgres local na porta 5432,
pare-o antes (o compose publica a 5432 por padrão — ou defina `POSTGRES_PORT`).

```bash
docker compose up -d --build
# → http://localhost:3100
```

- O **schema é aplicado automaticamente no boot** (`prisma db push` idempotente no entrypoint).
- **Seed de demonstração:** `SEED_ON_BOOT=1 docker compose up -d --build` (cria usuários demo + área COIDS).
- **FreeIPA:** o compose já nasce com `IPA_MODE=ldaps` e a base DN CPTEC/INPE.
  Coloque o certificado CA em `./secrets/freeipa_chave_operacional.pem`
  (diretório **gitignored**) — o mount `/run/secrets/...` já está configurado.
- **Porta 3000:** o compose publica `3100:3000` de propósito (não conflita com
  `npm run dev`). Para usar a 3000, pare o dev e sobrescreva o mapping.
- **Banco já existente:** se o volume `patrimonio_pgdata` existe com outras
  credenciais, alinhe `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`
  (o serviço `web` interpola as mesmas variáveis).

## Desenvolvimento local

```bash
cp .env.example .env          # ajuste DATABASE_URL + SESSION_SECRET (openssl rand -hex 32)
docker compose up -d db       # ou use um Postgres local com o banco criado
npm install                   # roda prisma generate (postinstall)
npm run db:push               # aplica prisma/schema.prisma
npm run db:seed               # usuários demo + área COIDS (idempotente)
npm run dev                   # http://localhost:3000
```

**Logins de demonstração (com `IPA_MODE=mock`):**

| uid                | papel na área COIDS | senha     |
| ------------------ | ------------------- | --------- |
| `coids.gestor`     | `OWNER`             | `mock123` |
| `coids.secretaria` | `OPERATOR`          | `mock123` |
| `outro.area`       | — (sem áreas)       | `mock123` |

> `outro.area` serve para validar isolamento de tenant (não vê a área COIDS, que é privada).

## Rodando sob subpath (ex.: `/patrimonio`)

Para servir o app atrás de um subpath (ex.: `https://host/patrimonio`, num
reverse proxy que hospeda mais apps no mesmo domínio), defina:

```bash
NEXT_PUBLIC_BASE_PATH="/patrimonio"
```

- **É build-time**: o valor é inlinado no bundle client. Em dev, lido do `.env`
  (reiniciar o `npm run dev` após mudar). No Docker, o compose passa como ARG de
  build (lendo o MESMO `.env`): `docker compose up -d --build` →
  `http://localhost:3100/patrimonio`.
- Rotas, assets, `next/link` e o cookie de sessão (`Path=/patrimonio`) ficam
  escopados ao subpath automaticamente; as chamadas internas (`fetch` de API)
  já levam o prefixo. O reverse proxy passa o path **como está — sem rewrite**.
- Vazio (`""`) mantém o app na raiz.

## Variáveis de ambiente

| Variável              | Descrição                                                            |
| --------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`        | Connection string do PostgreSQL                                       |
| `SESSION_SECRET`      | Chave do HMAC-SHA256 dos tokens de sessão (string longa e aleatória) |
| `IPA_MODE`            | `mock` (dev/teste) ou `ldaps` (produção)                             |
| `IPA_LDAPS_URL`       | Endpoint LDAPS (ex.: `ldaps://ipa.exemplo.com.br:636`) — obrigatório com `IPA_MODE=ldaps` |
| `IPA_BASE_DN`         | **Base DN dos usuários** (na FreeIPA: `cn=users,cn=accounts,dc=...,dc=...`) — obrigatório com `IPA_MODE=ldaps` |
| `IPA_CA_CERT`         | Caminho do arquivo com o certificado CA da FreeIPA (verificação TLS) |
| `NEXT_PUBLIC_APP_URL` | URL pública do app (em http local não aplica `Secure` no cookie; em produção tratar via variável server-side) |
| `NEXT_PUBLIC_BASE_PATH` | Subpath sob o qual o app é servido (ex.: `/patrimonio`). Vazio = raiz. **Build-time** |
| `SEED_ON_BOOT`        | Docker: `1` semeia o demo no boot (default `0`)                      |
| `POSTGRES_PORT`       | Docker: porta externa do Postgres (default `5432`)                   |

## Funcionalidades (MVP)

- **Áreas (auto-serviço):** hub "Minhas Áreas", criação em auto-serviço,
  gestão de membros e papéis, exclusão com cascata
- **Privado por padrão;** leitura pública opt-in (áreas públicas listadas no hub)
- **Tema claro/escuro** persistido
- **Patrimônios:** listagem com busca (debounce), filtros e contador de
  pendências, **ordenação por coluna**, detalhe, criar/editar com validação
  client+server
- **Fotos (até 10 por item):** galeria, capa determinística (1ª foto),
  adicionar/remover/reordenar por **drag & drop**, lightbox; o detalhe é
  **exibição pura** e a gestão das fotos fica no editar
- **Auditoria:** "Atualizado por" + "Atualizado em" — toda alteração (inclusive
  operação de foto) registra o operador, visível para qualquer usuário da área
- **RBAC por papel** + **anti-IDOR** (toda query escopada por `area_id` +
  membership; 404 uniforme para não-membro de área privada)

## Papéis (por área)

| Papel      | Permissões                                                              |
| ---------- | ----------------------------------------------------------------------- |
| `OWNER`    | Tudo: CRUD + excluir + gerenciar membros/papéis + config de visibilidade |
| `OPERATOR` | Criar/editar patrimônios + fotos                                         |
| `VIEWER`   | Somente visualizar                                                      |

Múltiplos `OWNER` são permitidos; as rotas de mudança de papel/exclusão têm o
guard do **último OWNER ativo** (409). `OWNER` é concedido pela própria API de
membros (não existe mais fluxo separado de "transferência de admin").

## Qualidade

```bash
npm run type-check   # tsc --noEmit
npm run lint         # eslint .
npm test             # vitest run — 10 arquivos / 92 testes (unit + integração)
npm run build        # build de produção (output standalone)
```

Os testes de integração usam um banco **isolado** (`patrimonio_test`), criado
automaticamente se não existir (`test/helpers/test-db.ts`) — o banco de dev não é tocado.

## Arquitetura & segurança (destaques)

- **Port/adapter de autenticação** (`src/lib/ipa.ts`): interface `IpaProvider` com
  `LdapsIpaProvider` (produção: bind LDAPS **como o próprio usuário** em
  `IPA_BASE_DN`, escape de DN conforme RFC 4515 contra LDAP-injection,
  verificação de certificado via `IPA_CA_CERT`, erro genérico anti-enumeração)
  e `MockIpaProvider` (dev/teste). Seleção por `IPA_MODE`.
- **JIT provisioning:** o primeiro login cria o `Usuario`; a FreeIPA é a fonte de
  verdade da identidade (nome/email/DN atualizados em todo login).
- **Sessão:** token aleatório (256 bits) no cookie `patrimonio_session`
  (`HttpOnly`, `Secure` em produção, `SameSite=Strict`); no Postgres (`SESSAO`)
  fica só o **HMAC-SHA256** do token (chave `SESSION_SECRET`); expira em 8h; revogável.
- **Multi-tenant:** toda query Prisma escopada por `area_id` + verificação de
  membership (anti-IDOR); 404 uniforme para não-membro de área privada.
- **Anti mass-assignment:** todos os inputs validados com **Zod no servidor**,
  com allowlist explícita de campos.
- **Fotos:** BLOB (`BYTEA`) no Postgres, com allowlist de MIME + teto de 5 MB +
  serving com `nosniff`; capa servida com `no-cache` (troca refletida para todos
  no próximo refresh), fotos individuais com cache. Abstração em
  `src/lib/storage.ts` (troca para S3/MinIO no futuro sem reescrever rotas).
- **Rate limit** no login e na criação de área (in-memory por processo —
  hardening de produção é o pacote ⑤).

## Estrutura

```
prisma/            schema.prisma (modelos) + seed.ts
src/app/           páginas (root, /login, /areas/[id]) + /api
                   (auth, areas, areas/publicas, areas/[id]/members,
                    areas/[id]/patrimonios[/[pid][/fotos[/[fid]]|/reordenar])
src/components/    componentes de UI (Hub, AreaTabs, PatrimoniosPanel,
                   MembersPanel, PublicAreasSection, ThemeToggle, …)
src/lib/           prisma, session, ipa (ports/adapters), access (RBAC/tenant),
                   storage (BLOB em Postgres), foto (serving/cache),
                   patrimonio (helpers), validators (Zod), rate-limit, slug, api
test/              helpers/ + unit/ + integration/
Dockerfile         multi-stage (node:20-slim, standalone, usuário não-root)
docker-entrypoint.sh  prisma db push idempotente + seed opcional + server.js
docker-compose.yml db (postgres:16, healthcheck, volume) + web (:3100)
```

## Deploy (Docker)

**1 imagem / 1 container stateless**: o `Dockerfile` gera um build multi-stage
com `output: "standalone"` do Next; o entrypoint aplica o schema no boot
(`prisma db push`) e sobe `server.js`. TLS fica a cargo do ingress/reverse
proxy; segredos somente via env (em produção, `IPA_CA_CERT` como arquivo
montado, ex.: `/run/secrets/`). `SEED_ON_BOOT=1` opcional para ambientes novos.

## Status

Ver [ROADMAP.md](./ROADMAP.md). **MVP concluído**: pacotes ① (Fundação),
② (Multi-área & Auth FreeIPA), ③ (CRUD + Foto), ③-A (Hub & Áreas Públicas),
③-B (UX & papéis, D1–D9) e ③-C (Docker full-stack) — todos com gates
independentes de SecOps e QA. A seguir: ④ (Movimentações/Histórico),
⑤ (Hardening) e ⑧ (Infra FreeIPA de produção).
