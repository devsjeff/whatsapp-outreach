# Backseat Network — WhatsApp Outreach Backend

Self-contained, Dockerized backend for advertiser WhatsApp outreach. No frontend, no media messages, no AI generation in this version.

## What it does

1. Connects a WhatsApp account via QR (Evolution API — free/open-source Baileys, no Cloud API per-message fees).
2. Imports advertiser leads from CSV or creates them via API.
3. Sends personalized **text-only** WhatsApp messages to approved/eligible leads.
4. Detects inbound replies and opt-outs (`STOP`, `UNSUBSCRIBE`, …).
5. Notifies the sales team on Telegram when a matched lead replies.
6. Persists leads, messages, queue state, and WhatsApp session data.
7. Exposes a documented REST API for other services.

### Scope vs full founder blueprint

| Phase | Status in this repo |
|---|---|
| Evolution API on Docker + QR connect | Implemented |
| CSV/API leads + text outreach + reply → Telegram | Implemented |
| Rate limits (~35/day, random 30–60s gaps) | Implemented |
| Personalized mockup **video** / `sendMedia` | **Not in v1** (explicitly deferred) |
| Gemini text personalization | Optional via `GEMINI_*` (falls back to template) |
| Google Maps / Justdial scraping | Not in v1 |
| Remotion/FFmpeg asset pipeline | Not in v1 |
| Auto PDF rate-card reply | Not in v1 |

Outbound remains **text-only** WhatsApp. Gemini (when enabled) only rewrites the pitch text; it does not send media.

## Architecture

| Service | Role |
|---|---|
| `backend` | Node.js + TypeScript + Fastify REST API |
| `worker` | BullMQ worker for outbound sends |
| `evolution-api` | WhatsApp Web bridge (`evoapicloud/evolution-api:v2.3.7`) |
| `postgres` | Persistent relational store (app + Evolution DBs) |
| `redis` | BullMQ queue + shared rate-limit state |

Only the backend HTTP port is published (`APP_PORT`, default `3000`). Postgres, Redis, and Evolution API stay on the internal Docker network.

Named volumes:

- `postgres_data`
- `redis_data`
- `evolution_instances` (WhatsApp session files under `/evolution/instances`)

## Quick start (Ubuntu VPS)

```bash
cp .env.example .env
# Edit .env — set strong credentials (see below)

docker compose up -d --build
docker compose ps
curl -s http://localhost:3000/health
curl -s http://localhost:3000/api/health/ready
```

Stop (keeps volumes / data):

```bash
docker compose down
```

Do **not** use `docker compose down -v` for routine stops — that deletes named volumes.

## Configure `.env`

Required:

| Variable | Purpose |
|---|---|
| `APP_AUTH_USERNAME` / `APP_AUTH_PASSWORD` | HTTP Basic auth for admin API |
| `POSTGRES_PASSWORD` | Postgres password |
| `DATABASE_URL` | App DB URL (must match Postgres creds) |
| `REDIS_URL` | Redis URL |
| `EVOLUTION_API_KEY` | Shared Evolution API key (≥16 chars) |
| `WHATSAPP_WEBHOOK_SECRET` | Shared secret for inbound webhooks |
| `APP_BASE_URL` | Public/base URL Evolution uses for webhooks (must reach `backend`) |

Optional:

| Variable | Purpose |
|---|---|
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Sales reply notifications |
| `OPENROUTER_API_KEY` / `OPENROUTER_MODEL` | Placeholder only — unused in v1 |

Generate strong values, for example:

```bash
openssl rand -hex 24   # passwords / API keys
openssl rand -hex 16   # webhook secret
```

Inside Docker, `APP_BASE_URL` for Evolution webhooks should be reachable from the `evolution-api` container. Prefer:

```env
APP_BASE_URL=http://backend:3000
```

If Evolution must call a public URL through a reverse proxy, set that HTTPS origin instead and ensure `/api/webhooks/whatsapp` is routed to the backend.

## Connect WhatsApp

Two equivalent paths (both use the same Evolution instance):

**A. Via our API (recommended for automation)**

```bash
curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  -X POST http://localhost:3000/api/whatsapp/connect

# Live QR from Evolution — never fabricated
curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  http://localhost:3000/api/whatsapp/qr

curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  http://localhost:3000/api/whatsapp/status
```

**B. Via Evolution manager (founder-style UI)**

With default `EVOLUTION_PORT=127.0.0.1:8080`, open on the VPS or over SSH tunnel:

- Manager: `http://127.0.0.1:8080/manager`
- Swagger: `http://127.0.0.1:8080/docs`

Create/connect instance `backseat-outreach` (or your `EVOLUTION_INSTANCE_NAME`) and scan the QR in WhatsApp → Linked Devices.

Session data survives container restarts via the `evolution_instances` volume.

## Optional: Gemini message personalization

Replaces the old OpenRouter placeholder. Static templates still work if Gemini is off.

```env
GEMINI_API_KEY=your_key_from_google_ai_studio
GEMINI_MODEL=gemini-flash-latest
GEMINI_MESSAGE_GENERATION=true
```

```bash
curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  http://localhost:3000/api/gemini/status

curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  -H 'Content-Type: application/json' \
  -d '{"businessName":"Acme Motors","contactPerson":"Riya","locality":"Saket","category":"Auto"}' \
  http://localhost:3000/api/gemini/preview
```

If Gemini fails (quota/network), the worker automatically falls back to `MESSAGE_TEMPLATE`.

**Security:** never commit API keys. If a key was pasted into chat, Slack, or a ticket — rotate it in Google AI Studio immediately.

## Configure Telegram

1. Create a bot with BotFather and copy the token.
2. Add the bot to your sales chat; set `TELEGRAM_CHAT_ID`.
3. Restart: `docker compose up -d backend worker`
4. Verify: `GET /api/telegram/status` (auth required; token/chat ID are never returned).

If Telegram credentials are missing, the API logs a warning and continues without notifications.

## Import leads (does not send messages)

CSV columns:

```text
business_name,contact_person,phone,locality,category
```

```bash
curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  -F "file=@leads.csv" \
  http://localhost:3000/api/leads/import
```

Or create one lead:

```bash
curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  -H 'Content-Type: application/json' \
  -d '{"businessName":"Acme Motors","contactPerson":"Riya","phone":"9876543210","locality":"Saket","category":"Auto"}' \
  http://localhost:3000/api/leads
```

## Start / pause / resume outreach

Starting a campaign requires auth **and** `"confirm": true`.

```bash
curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true,"name":"Delhi NCR week 1"}' \
  http://localhost:3000/api/outreach/start

curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  -X POST http://localhost:3000/api/outreach/pause

curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  -X POST http://localhost:3000/api/outreach/resume

curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  http://localhost:3000/api/outreach/stats
```

Operational defaults (configurable; aligned with founder anti-ban guidance):

- Timezone: `Asia/Kolkata`
- Window: 10:00–18:30
- Days: Mon–Sat
- Daily cap: 35 (stay in the ~30–50/day band)
- Delay: random **30–60 seconds** between sends

Caps/delays are enforced in Redis so multiple workers cannot bypass them. These are safeguards, not protection against WhatsApp account restrictions.

**Founder / ops rules (manual — not enforced in code):**

- Never use a primary personal SIM; use a dedicated secondary business number.
- Warm up the number (normal chats with the team) for 3–5 days before cold outreach.
- Prefer scanning QR via Evolution manager (`http://127.0.0.1:8080/manager` with SSH tunnel) or `GET /api/whatsapp/qr`.
- Only contact leads you are authorized to message under applicable policies and law.

## Inspect replies and history

```bash
curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  'http://localhost:3000/api/leads?status=REPLIED'

curl -u "$APP_AUTH_USERNAME:$APP_AUTH_PASSWORD" \
  http://localhost:3000/api/leads/<LEAD_ID>/messages
```

Inbound opt-out keywords (case-insensitive, configurable via `OPT_OUT_KEYWORDS`) mark the lead `OPTED_OUT` and block future sends. The system never auto-replies to advertisers.

## Back up and restore volumes

List volumes:

```bash
docker volume ls | grep backseat
```

Backup example (Postgres):

```bash
docker compose exec -T postgres pg_dump -U outreach outreach > backup-outreach.sql
docker compose exec -T postgres pg_dump -U outreach evolution > backup-evolution.sql
```

Backup Redis AOF/RDB and Evolution session volume:

```bash
docker run --rm -v backseat-outreach_redis_data:/data -v "$PWD:/backup" alpine \
  tar czf /backup/redis-data.tgz -C /data .
docker run --rm -v backseat-outreach_evolution_instances:/data -v "$PWD:/backup" alpine \
  tar czf /backup/evolution-instances.tgz -C /data .
```

Restore Postgres:

```bash
cat backup-outreach.sql | docker compose exec -T postgres psql -U outreach outreach
```

Restore a volume tarball into a stopped stack carefully (do not wipe production volumes accidentally).

## Local development

```bash
cp .env.example .env
npm install
npx prisma generate
npm test
npm run typecheck
```

Full stack still needs Docker for Postgres/Redis/Evolution.

## API documentation

- Frontend / EC2 integration: **[FRONTEND_API.md](./FRONTEND_API.md)**
- Full endpoint reference: [API.md](./API.md)

## Security notes

- Admin routes use HTTP Basic auth.
- Webhooks require `Authorization: Bearer <WHATSAPP_WEBHOOK_SECRET>` (or matching `x-webhook-secret` / `apikey`).
- Secrets are redacted from logs; never returned by API responses.
- Put TLS in front via nginx/Caddy/Traefik in production.
- This repository is production-**conscious**, not a claim of production certification. Run your own security review, load test, and WhatsApp policy compliance checks before real campaigns.

## License

Proprietary — Backseat Network.
