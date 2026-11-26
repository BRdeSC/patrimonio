# Patrimônio — Roadmap & Plano de Execução

> Fonte de verdade no repositório. A versão **viva** (status por ciclo, contratos e checklists) está na **Nota do Canvas: "Patrimônio — Arquitetura & Plano"** (dono: OpenCode, Maestro).

## 1. Visão

Aplicação web **multi-área (multi-tenant)** para gestão de patrimônio de equipamentos.
Inicia atendendo a área **COIDS** e é projetada para se tornar produto geral (auto-serviço: qualquer área cria o próprio espaço).

**Dor central:** o gestor perde o controle, com o tempo, de *onde estão* os itens e *quem está com cada um* (troca de detentor). **Solução:** cadastro + **histórico de movimentações** + busca.

## 2. Decisões de Arquitetura (travadas)

| Dimensão | Decisão |
|---|---|
| Stack | Next.js full-stack (TypeScript) + PostgreSQL + Prisma |
| Deploy | **1 imagem / 1 container stateless** → registry → máquina de deploy |
| Autenticação | **FreeIPA via LDAPS** (usuário digita a senha). FreeIPA **só autentica** (IdP) |
| Autorização | **Por área**, gerenciada no app pelo responsável maior (`AREA_MEMBRO`) |
| Multi-tenancy | `area_id` em tudo; **privado por padrão**, leitura pública opt-in |
| Imagens | **Postgres BLOB** (`PATRIMONIO_FOTO`) + abstração `lib/storage.ts` (troca p/ S3 no futuro) |
| Sessão | Cookie `HttpOnly/Secure/SameSite=Strict` + linha em `SESSAO` no Postgres (revogável) |
| TLS | Ingress/reverse proxy à frente |

## 3. Papéis (por área)

| Papel | Permissões |
|---|---|
| **OWNER** (responsável maior — quem criou ou recebeu transferência) | CRUD + excluir + gerenciar membros/papéis + config (visibilidade) + transferir admin |
| **OPERATOR** | Criar/editar patrimônios + foto |
| **VIEWER** | Só visualiza |

## 4. Roadmap por Pacotes (WBS)

- [x] **① Fundação** — scaffold Next.js + TS + Prisma + Postgres; qualidade (eslint/prettier/type-check); Docker + docker-compose (Postgres); estrutura de pastas; `.env.example`. ✅
- [x] **② Multi-área & Auth FreeIPA** — modelos (Area, Usuario, Sessao, AreaMembro); login FreeIPA via **ports/adapters** (`IpaProvider`: `LdapsIpaProvider` prod + `MockIpaProvider` dev/test, seletor por `IPA_MODE`); sessão em Postgres; criação de área em auto-serviço; Hub "Minhas Áreas"; dashboard da área; gestão de membros + transferência de admin. ✅
- [x] **③ CRUD de Patrimônios** — schemas Zod; API list/create/read/update/delete; busca + filtros; forms; upload de foto (BLOB); UI (aba "Patrimônios"). ✅
- [x] **③-A Hub & Áreas Públicas** — hub "Minhas Áreas", leitura pública opt-in, modo escuro (next-themes). ✅
- [x] **③-B UX & Papéis (pedidos do dono)** — D1–D9: ajustes UX, ordenação da lista, "Atualizado por" (detalhe + resposta PATCH + busca ao abrir), detalhe=read-only / editar=gestão de fotos (ops registram o operador), alinhamento da galeria, capa servida com no-cache. ✅ (92 testes, 9 gates)
- [x] **③-C Docker full-stack** — Dockerfile (multi-stage, `output: standalone` já configurado), entrypoint c/ `prisma db push` idempotente + seed opcional, `.dockerignore`, service `web` no compose (porta 3100, sem conflito c/ dev), mount CA FreeIPA. ✅
- [x] **③-D Export PDF** — exportar a lista de patrimônios em PDF (rota GET `/patrimonios/exportar` c/ pdfkit; paridade de busca/ordem c/ a lista; botão "Exportar PDF" no painel). ✅ **ENCERRADO (dono: release 42825b5 em develop)** — D.0 ✅ (96/96) · D.1 ✅ (5 colunas + wrap, bbox 0) · D.2 ✅ Basalto (A4 retrato, 6 colunas fixas em mm, 8.5pt, padding 2mm, zebra) · D.3 ✅ Maestro (takeover documentado: "Atualizado em" só data dd/mm/aaaa + Descrição 45mm / Atualizado 22mm — resolveu a discrepância do D.2). Gates: GATE 1 stale (desvio documentado) + GATE 2 não executado — dono testou ao vivo e lançou (decisão do dono).
- [ ] **③-E Paginação da listagem** — paginação server-side em `GET /patrimonios` (`page` + `limit` 10|20|50|100|todos; resposta `{itens, total, page}`) + footer no painel (select itens/página, "Mostrando X–Y de Z itens", Anterior/Próxima, reset p/ página 1 a cada filtro/ordenação) + Exportar PDF enviando os filtros ativos (PDF ignora paginação). ✅ **MAESTRO (takeover documentado — 3º freeze do Dev, 26/11):** paginação server-side (`page`/`limit` no schema Zod — inválido → 400; total = count do MESMO where; `todos` = sem limite, retrocompatível; resposta `{patrimonios, total, page}`) + footer no painel (select 10/20/50/100/Todos, "Mostrando X–Y de Z itens", ← Anterior / "Página X de Y" / Próxima →, reset page=1 a cada filtro/ordenação) + Exportar PDF inalterado (envia só filtros ativos — PDF ignora paginação) + bloco (o) na suíte. Self-gates: type-check 0 · lint 0 · 97/97 · build · live 3130 matriz 100% + cleanup. GATES 1+2 a seguir (abas fixas, sessões novas).
- [ ] **④ Movimentações / Histórico** — registrar trocas de detentor/localização; timeline no detalhe; KPI de pendências.
- [ ] **⑤ Hardening** — headers (CSP/HSTS/nosniff); rate limiting de produção (login + criação de área); revisita anti-IDOR; serving de foto seguro; gestão de segredos.
- [ ] **⑥ Testes** — unit (Zod, isolamento tenant) + integração (CRUD, permissões, IDOR negativo) + suíte de abuso.
- [ ] **⑦ Docs / Contratos** — README, contratos de API, notas do canvas.
- [ ] **⑧ Infra** — conta service FreeIPA (se aplicável), CA cert, conectividade container→FreeIPA (636), criação da área COIDS em produção.

## 5. Convenções

- **Git:** NENHUM agente executa `git commit` / `git push` / `git reset` ou altera histórico. Tudo fica no **working tree** para revisão manual do dono. O Maestro **só sugere** comandos (Conventional Commits).
- **Qualidade:** `type-check` + `lint` + testes passando = condição de pacote pronto.
- **Segurança:** Secure by Design em todo pacote; **GATE SecOps bloqueante** antes do QA; **GATE QA bloqueante** antes do fechamento.
- **Exemplos de commits sugeridos:**
  - `chore: scaffold Next.js + Prisma + Postgres com qualidade (lint/type-check/test)`
  - `feat(auth): login FreeIPA via IpaProvider (ldaps+mock) com sessão em Postgres`
  - `feat(area): auto-serviço de criação de área, hub e gestão de membros`

## 6. Status do Ciclo (espelho da Nota do Canvas)

| Pacote | Dev | SecOps (GATE 1) | QA (GATE 2) |
|---|---|---|---|
| ① Fundação | ✅ | ✅ (GATE 1) | ✅ (GATE 2) |
| ② Multi-área & Auth | ✅ | ✅ (GATE 1) | ✅ (GATE 2) |
| ③ CRUD + Foto | ✅ (92 testes) | ✅ (2×) | ✅ (2×) |
| ③-A Hub & Áreas Públicas | ✅ | ✅ | ✅ |
| ③-B UX & Papéis (D1–D9) | ✅ | ✅ | ✅ |
| ③-C Docker full-stack | ✅ | ✅ | ✅ |
| ③-D Export PDF | ✅ (release 42825b5) | ⚠️ GATE 1 stale (desvio) — dono encerrou c/ release | — (dono testou live) |
| ③-E Paginação (dono, 26/11) | ✅ MAESTRO (takeover — 3º freeze) | ⬜ | ⬜ |
| ④ Movimentações | ⬜ | ⬜ | ⬜ |
| ⑤ Hardening | ⬜ | ⬜ | ⬜ |
| ⑥ Testes | ⬜ | — | ⬜ |
| ⑦ Docs | ⬜ | — | ⬜ |
| ⑧ Infra | ⬜ | — | — |
