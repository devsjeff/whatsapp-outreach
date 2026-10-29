#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

sed -i 's/\r$//' .env || true
USER="$(grep '^APP_AUTH_USERNAME=' .env | cut -d= -f2- | tr -d '\r')"
PASS="$(grep '^APP_AUTH_PASSWORD=' .env | cut -d= -f2- | tr -d '\r')"
AUTH=(-u "${USER}:${PASS}")

echo "=== COMPOSE PS ==="
docker compose ps

echo
echo "=== HEALTH ==="
curl -si http://localhost:3000/health
echo

echo "=== READY ==="
curl -si http://localhost:3000/api/health/ready
echo

echo "=== AUTH FAIL (expect 401) ==="
curl -si http://localhost:3000/api/whatsapp/status | head -20
echo

echo "=== WHATSAPP STATUS ==="
curl -si "${AUTH[@]}" http://localhost:3000/api/whatsapp/status
echo

echo "=== OUTREACH STATS ==="
curl -si "${AUTH[@]}" http://localhost:3000/api/outreach/stats
echo

echo "=== CREATE LEAD ==="
curl -si "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"businessName":"Test Motors","contactPerson":"Riya","phone":"9876543210","locality":"Saket","category":"Auto"}' \
  http://localhost:3000/api/leads
echo

echo "=== LIST LEADS ==="
curl -si "${AUTH[@]}" 'http://localhost:3000/api/leads?page=1&pageSize=5'
echo

echo "=== DUPLICATE LEAD (expect 409) ==="
curl -si "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{"businessName":"Test Motors","phone":"9876543210","locality":"Saket"}' \
  http://localhost:3000/api/leads
echo

echo "=== START WITHOUT CONFIRM (expect 400) ==="
curl -si "${AUTH[@]}" -H 'Content-Type: application/json' \
  -d '{}' http://localhost:3000/api/outreach/start
echo

echo "=== TELEGRAM STATUS ==="
curl -si "${AUTH[@]}" http://localhost:3000/api/telegram/status
echo

echo "=== GEMINI STATUS ==="
curl -si "${AUTH[@]}" http://localhost:3000/api/gemini/status
echo

echo "=== CSV IMPORT ==="
curl -si "${AUTH[@]}" -F "file=@samples/leads.example.csv" http://localhost:3000/api/leads/import
echo

echo "=== PORT MAPPING ==="
docker compose port backend 3000
echo

echo "=== WORKER LOGS (tail) ==="
docker compose logs --tail=20 worker
