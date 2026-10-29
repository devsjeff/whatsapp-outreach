#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

sed -i 's/\r$//' docker/entrypoint.sh || true

echo "[e2e] Building backend/worker..."
docker compose build backend worker

echo "[e2e] Starting stack..."
docker compose up -d
sleep 15

echo "[e2e] Status:"
docker compose ps

echo "[e2e] Waiting for /health..."
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo "=== HEALTH ==="
curl -si http://127.0.0.1:3000/health
echo

echo "=== READY ==="
curl -si http://127.0.0.1:3000/api/health/ready
echo

USER="$(tr -d '\r' < .env | sed -n 's/^APP_AUTH_USERNAME=//p' | head -1)"
PASS="$(tr -d '\r' < .env | sed -n 's/^APP_AUTH_PASSWORD=//p' | head -1)"
TOKEN="$(printf '%s:%s' "$USER" "$PASS" | base64 -w0 2>/dev/null || printf '%s:%s' "$USER" "$PASS" | base64)"
HDR=(-H "Authorization: Basic ${TOKEN}")

echo "user_len=${#USER} pass_len=${#PASS}"

echo "=== AUTH FAIL ==="
curl -si http://127.0.0.1:3000/api/whatsapp/status | head -12
echo

echo "=== WHATSAPP STATUS ==="
curl -si "${HDR[@]}" http://127.0.0.1:3000/api/whatsapp/status
echo

echo "=== STATS ==="
curl -si "${HDR[@]}" http://127.0.0.1:3000/api/outreach/stats
echo

echo "=== CREATE LEAD ==="
curl -si "${HDR[@]}" -H 'Content-Type: application/json' \
  -d '{"businessName":"Verify Co","contactPerson":"A","phone":"9988776655","locality":"Saket","category":"Test"}' \
  http://127.0.0.1:3000/api/leads
echo

echo "=== DUPLICATE ==="
curl -si "${HDR[@]}" -H 'Content-Type: application/json' \
  -d '{"businessName":"Verify Co","phone":"9988776655","locality":"Saket"}' \
  http://127.0.0.1:3000/api/leads
echo

echo "=== START WITHOUT CONFIRM ==="
curl -si "${HDR[@]}" -H 'Content-Type: application/json' \
  -d '{}' http://127.0.0.1:3000/api/outreach/start
echo

echo "=== CSV IMPORT ==="
curl -si "${HDR[@]}" -F "file=@samples/leads.example.csv" \
  http://127.0.0.1:3000/api/leads/import
echo

echo "=== TELEGRAM ==="
curl -si "${HDR[@]}" http://127.0.0.1:3000/api/telegram/status
echo

echo "=== GEMINI ==="
curl -si "${HDR[@]}" http://127.0.0.1:3000/api/gemini/status
echo

echo "=== PORT ==="
docker compose port backend 3000

echo "=== FINAL PS ==="
docker compose ps

echo "=== LOGS ==="
docker compose logs --tail=20 backend worker
