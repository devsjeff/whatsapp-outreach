#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

sed -i 's/\r$//' .env || true

USER="$(grep '^APP_AUTH_USERNAME=' .env | cut -d= -f2- | tr -d '\r')"
PASS="$(grep '^APP_AUTH_PASSWORD=' .env | cut -d= -f2- | tr -d '\r')"
TOKEN="$(printf '%s:%s' "$USER" "$PASS" | base64 -w0 2>/dev/null || printf '%s:%s' "$USER" "$PASS" | base64)"
AUTH_HEADER="Authorization: Basic ${TOKEN}"

echo "user_len=${#USER} pass_len=${#PASS} token_len=${#TOKEN}"

wait_healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS http://localhost:3000/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Backend never became healthy"
  docker compose ps
  docker compose logs --tail=40 backend worker
  exit 1
}

wait_healthy

echo "=== HEALTH ==="
curl -si http://localhost:3000/health
echo

echo "=== READY ==="
curl -si http://localhost:3000/api/health/ready
echo

echo "=== AUTH FAIL ==="
curl -si http://localhost:3000/api/whatsapp/status | head -15
echo

echo "=== WHATSAPP STATUS ==="
curl -si -H "$AUTH_HEADER" http://localhost:3000/api/whatsapp/status
echo

echo "=== STATS ==="
curl -si -H "$AUTH_HEADER" http://localhost:3000/api/outreach/stats
echo

echo "=== CREATE LEAD ==="
curl -si -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"businessName":"Test Motors","contactPerson":"Riya","phone":"9876543210","locality":"Saket","category":"Auto"}' \
  http://localhost:3000/api/leads
echo

echo "=== DUPLICATE ==="
curl -si -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{"businessName":"Test Motors","phone":"9876543210","locality":"Saket"}' \
  http://localhost:3000/api/leads
echo

echo "=== START NO CONFIRM ==="
curl -si -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d '{}' http://localhost:3000/api/outreach/start
echo

echo "=== CSV IMPORT ==="
curl -si -H "$AUTH_HEADER" -F "file=@samples/leads.example.csv" \
  http://localhost:3000/api/leads/import
echo

echo "=== TELEGRAM ==="
curl -si -H "$AUTH_HEADER" http://localhost:3000/api/telegram/status
echo

echo "=== GEMINI ==="
curl -si -H "$AUTH_HEADER" http://localhost:3000/api/gemini/status
echo

echo "=== PS ==="
docker compose ps

echo "=== RECENT LOGS ==="
docker compose logs --tail=15 backend worker
