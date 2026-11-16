# Patrimônio

Aplicação web **multi-área (multi-tenant)** para gestão de patrimônio de equipamentos.
Inicia atendendo a área **COIDS** e é projetada para se tornar produto geral
(auto-serviço: qualquer área cria o próprio espaço).

**Dor central:** o gestor perde o controle, com o tempo, de *onde estão* os itens e
*quem está com cada um* (troca de detentor). **Solução:** cadastro +
**histórico de movimentações** + busca.

## Stack

- **Next.js 16** (App Router, Turbopack) + **React 19** + **TypeScript strict**
- **PostgreSQL** + **Prisma 6**
- **FreeIPA** como IdP (só autentica — **nenhuma senha é armazenada**)
- **Vitest** (unit + integração contra Postgres isolado)

## Rodando localmente

Pré-requisitos: Node 20+ e um PostgreSQL acessível (local ou via Docker).

### 1. Banco de dados

**Opção A — Postgres local:** crie o banco:

```sql
CREATE DATABASE patrimonio;
```

**Opção B — Docker Compose** (Postgres 16, `patrimonio/patrimonio`):

```bash
docker compose up -d
```

### 2. Ambiente

```bash
cp .env.example .env
```

Ajuste `DATABASE_URL` (se necessário) e defina um `SESSION_SECRET` longo e aleatório
(`openssl rand -hex 32`).

### 3. Instalação + schema + seed

```bash
npm install        # roda prisma generate (postinstall)
npm run db:push    # aplica prisma/schema.prisma no banco
npm run db:seed    # usuários demo + área COIDS (idempotente)
```

### 4. Desenvolvimento

```bash
npm run dev        # http://localhost:3000
```

**Logins de demonstração (modo `mock`):**

| uid                | papel na área COIDS | senha     |
| ------------------ | ------------------- | --------- |
| `coids.gestor`     | `admin_area`        | `mock123` |
| `coids.secretaria` | `secretaria`        | `mock123` |
| `outro.area`       | — (sem áreas)       | `mock123` |

> `outro.area` serve para validar isolamento de tenant (não vê a área COIDS, que é privada).

## Variáveis de ambiente

| Variável              | Descrição                                                            |
| --------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`        | Connection string do PostgreSQL                                       |
| `SESSION_SECRET`      | Chave do HMAC-SHA256 dos tokens de sessão (string longa e aleatória) |
| `IPA_MODE`            | `mock` (default; dev/teste) ou `ldaps` (produção)                    |
| `IPA_LDAPS_URL`       | Endpoint LDAPS (ex.: `ldaps://ipa.exemplo.com.br:636`) — obrigatório com `IPA_MODE=ldaps` |
| `IPA_BASE_DN`         | Base DN dos usuários (ex.: `dc=exemplo,dc=com,dc=br`) — obrigatório com `IPA_MODE=ldaps` |
| `IPA_CA_CERT`         | Caminho do certificado CA da FreeIPA (verificação TLS)               |
| `NEXT_PUBLIC_APP_URL` | URL pública do app (https em produção → cookie `Secure`)             |

## Qualidade

```bash
npm run type-check   # tsc --noEmit
npm run lint         # eslint .
npm test             # vitest run (unit + integração)
npm run build        # build de produção (output standalone)
```

Os testes de integração usam um banco **isolado** (`patrimonio_test`), criado
automaticamente se não existir (`test/helpers/test-db.ts`) — o banco de dev não é tocado.

## Arquitetura & segurança (destaques)

- **Port/adapter de autenticação** (`src/lib/ipa.ts`): interface `IpaProvider` com
  `LdapsIpaProvider` (produção: bind LDAPS **como o próprio usuário** em `IPA_BASE_DN`,
  escape de DN conforme RFC 4515 contra LDAP-injection, verificação de certificado via
  `IPA_CA_CERT`) e `MockIpaProvider` (dev/teste). Seleção por `IPA_MODE`.
- **Sessão**: token aleatório (256 bits) no cookie `patrimonio_session`
  (`HttpOnly`, `Secure` em produção, `SameSite=Strict`); no Postgres (`SESSAO`) fica só o
  **HMAC-SHA256** do token (chave `SESSION_SECRET`); expira em 8h; revogável.
- **Anti-enumeração**: mensagem de login genérica; rate limit de login e criação de área
  (in-memory por processo — hardening de produção é o pacote ⑤).
- **Multi-tenant**: toda query Prisma escopada por `area_id` + verificação de membership
  (anti-IDOR); áreas **privadas por padrão** (leitura pública é opt-in, ainda não exposta).
- **Anti mass-assignment**: todos os inputs validados com **Zod no servidor**, com
  allowlist explícita de campos. `admin_area` nunca é atribuível pela API de membros —
  somente via **transferência de admin** (com proteções: alvo deve ser membro ativo,
  nunca rebaixar/desativar/remover o único admin ativo).
- **RBAC por área**: `admin_area` (tudo + membros + config + transferir admin),
  `secretaria` (criar/editar patrimônios + foto — pacote ③), `usuario` (só visualiza).

## Estrutura

```
prisma/            schema.prisma (modelos) + seed.ts
src/app/           páginas (root, /login, /areas/[id]) + /api (auth, areas, members, transfer)
src/components/    componentes de UI (Hub, AreaTabs, MembersPanel, …)
src/lib/           prisma, session, ipa (ports/adapters), access (RBAC/tenant),
                   storage (BLOB em Postgres), validators (Zod), rate-limit, slug, api
test/              helpers/ + unit/ + integration/
```

## Deploy

**1 imagem / 1 container stateless**: `npm run build` gera `output: "standalone"`
(`.next/standalone/server.js`). TLS fica a cargo do ingress/reverse proxy; segredos
somente via env (em produção, `IPA_CA_CERT` como arquivo montado, ex.: `/run/secrets/`).

## Status

Ver [ROADMAP.md](./ROADMAP.md). Pacotes ① (Fundação) e ② (Multi-área & Auth FreeIPA)
**concluídos (dev)**; ③ em diante a seguir.
