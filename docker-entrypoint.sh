#!/bin/sh
# Entrypoint do container `web`:
#  1. Aplica o schema de forma idempotente (repo sem migrations — decisão travada).
#  2. Opcionalmente semeia dados de demonstração (SEED_ON_BOOT=1).
#  3. Sobe o server standalone do Next (passa a ser o PID 1 via exec).
set -e

npx prisma db push --skip-generate

if [ "${SEED_ON_BOOT:-0}" = "1" ]; then
    npx prisma db seed
fi

exec node server.js
