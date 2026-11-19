# Patrimônio — 1 imagem / 1 container stateless (decisão travada no ①).
# Base node:20-slim (glibc): o engine do Prisma quebra em alpine/musl.
# Obs.: a imagem carrega o node_modules completo do stage `deps` porque o CLI do
# Prisma é preciso no boot (`db push` no entrypoint + seed opcional). Enxugar a
# imagem (ex.: stage de produção só com o CLI) fica para os pacotes ⑤/⑧.

# ---- Stage 1: deps — dependências via lockfile (postinstall roda prisma generate) ----
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma/schema.prisma ./prisma/
RUN npm ci

# ---- Stage 2: build — build de produção (output: "standalone" no next.config.ts) ----
FROM node:20-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- Stage 3: runner — runtime (usuário não-root, padrão do standalone Next) ----
FROM node:20-slim AS runner
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
# libssl para o engine do Prisma detectar o OpenSSL do sistema (sem isso, warning
# "failed to detect libssl" no boot — GATE 2 ③-C D1).
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

# standalone/server.js + node_modules mínimo rastreado
COPY --from=build --chown=node:node /app/.next/standalone ./
# assets estáticos (o server.js serve de .next/static e public/ quando presentes)
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
# Prisma: schema (db push no boot) + seed.ts (SEED_ON_BOOT=1)
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json ./package.json
# node_modules completo do stage deps por cima do mínimo do standalone:
# garante o CLI do Prisma (db push/db seed) e o tsx (seed) no boot.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

COPY --chown=node:node docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

EXPOSE 3000
USER node

# Healthcheck: aceita qualquer status < 400 na raiz (ex.: redirect p/ /login).
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/').then((r) => process.exit(r.status < 400 ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
