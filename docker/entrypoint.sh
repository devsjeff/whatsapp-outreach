#!/bin/sh
set -eu

echo "[entrypoint] Verifying build artifacts..."
if [ ! -f /app/dist/index.js ] || [ ! -f /app/dist/worker.js ]; then
  echo "[entrypoint] ERROR: compiled entrypoints missing under /app/dist"
  ls -la /app || true
  ls -la /app/dist || true
  exit 1
fi

echo "[entrypoint] Running Prisma migrations..."
npx prisma migrate deploy

echo "[entrypoint] Starting process: $*"
exec "$@"
