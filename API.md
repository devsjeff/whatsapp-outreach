# API Reference — Backseat WhatsApp Outreach

**Base URL (default):** `http://localhost:3000`  
**Production:** `https://<your-domain>` (TLS terminated at reverse proxy)

## Authentication

| Surface | Auth |
|---|---|
| `GET /health` | None |
| `GET /api/health/ready` | None |
| `POST /api/webhooks/whatsapp` | Shared webhook secret |
| All other `/api/*` routes | HTTP Basic (`APP_AUTH_USERNAME` / `APP_AUTH_PASSWORD`) |

Webhook secret accepted as:

- `Authorization: Bearer <WHATSAPP_WEBHOOK_SECRET>`
- `Authorization: <WHATSAPP_WEBHOOK_SECRET>`
- `x-webhook-secret: <WHATSAPP_WEBHOOK_SECRET>`
- `apikey: <WHATSAPP_WEBHOOK_SECRET>`

Admin responses never include API keys, bot tokens, or passwords.

---

## Health and setup

### `GET /health`

Application liveness.

**Response `200`**

```json
{
  "status": "ok",
  "service": "backseat-whatsapp-outreach",
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

```bash
curl -s http://localhost:3000/health
```

### `GET /api/health/ready`

Dependency readiness. Returns `503` if database or Redis is down.

**Response `200` / `503`**

```json
{
  "status": "ready",
  "checks": {
    "database": true,
    "redis": true,
    "evolution": true,
    "telegramConfigured": false
  },
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

```bash
curl -s http://localhost:3000/api/health/ready
```

### `GET /api/whatsapp/status`

**Auth:** Basic

```json
{
  "instanceConnected": false,
  "state": "close",
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

`state`: `open` | `connecting` | `close` | `unknown`

```bash
curl -u admin:password http://localhost:3000/api/whatsapp/status
```

### `POST /api/whatsapp/connect`

Creates the Evolution instance if missing, configures the webhook, and initiates pairing.

**Auth:** Basic

```bash
curl -u admin:password -X POST http://localhost:3000/api/whatsapp/connect
```

**Response `200`**

```json
{
  "created": true,
  "state": "connecting",
  "qr": {
    "available": true,
    "base64": "data:image/png;base64,...",
    "pairingCode": null
  },
  "message": "Scan the QR code from GET /api/whatsapp/qr"
}
```

### `GET /api/whatsapp/qr`

Returns the **live** QR from Evolution API. Never fabricates a QR.

**Auth:** Basic

```bash
curl -u admin:password http://localhost:3000/api/whatsapp/qr
```

**Response `200`**

```json
{
  "state": "connecting",
  "qr": {
    "base64": "data:image/png;base64,...",
    "pairingCode": null,
    "mimeType": "image/png"
  }
}
```

**Errors**

| Code | Meaning |
|---|---|
| `401` | Missing/invalid Basic auth |
| `503` | Evolution returned no QR (`qr_unavailable`) |
| `502` | Evolution API error |

### `POST /api/whatsapp/disconnect`

Logs out the WhatsApp session via Evolution (`DELETE /instance/logout/{instance}`).

**Auth:** Basic

```bash
curl -u admin:password -X POST http://localhost:3000/api/whatsapp/disconnect
```

---

## Lead management

### `POST /api/leads/import`

Multipart CSV upload. Field name: `file`.

Columns: `business_name,contact_person,phone,locality,category`

Does **not** send messages.

**Auth:** Basic

```bash
curl -u admin:password -F "file=@leads.csv" http://localhost:3000/api/leads/import
```

**Response `200`**

```json
{
  "message": "CSV processed. No messages were sent.",
  "summary": {
    "total": 10,
    "successful": 8,
    "skipped": 1,
    "invalid": 1,
    "details": []
  }
}
```

Duplicate phones are skipped (profile fields may refresh). `OPTED_OUT` is preserved on re-import.

### `POST /api/leads`

**Auth:** Basic

```json
{
  "businessName": "Acme Motors",
  "contactPerson": "Riya",
  "phone": "9876543210",
  "locality": "Saket",
  "category": "Auto",
  "notes": null
}
```

```bash
curl -u admin:password -H 'Content-Type: application/json' \
  -d '{"businessName":"Acme Motors","contactPerson":"Riya","phone":"9876543210","locality":"Saket","category":"Auto"}' \
  http://localhost:3000/api/leads
```

**Errors:** `400` validation/phone, `409` duplicate phone.

### `GET /api/leads`

**Auth:** Basic  
Query: `page`, `pageSize`, `status`, `search`

Statuses: `PENDING`, `QUEUED`, `SENT`, `FAILED`, `REPLIED`, `OPTED_OUT`, `CONVERTED`

```bash
curl -u admin:password 'http://localhost:3000/api/leads?status=PENDING&page=1&pageSize=20'
```

### `GET /api/leads/:id`

**Auth:** Basic

```bash
curl -u admin:password http://localhost:3000/api/leads/<id>
```

### `PATCH /api/leads/:id`

**Auth:** Basic — partial update of lead fields / status.

```bash
curl -u admin:password -X PATCH -H 'Content-Type: application/json' \
  -d '{"locality":"Hauz Khas"}' \
  http://localhost:3000/api/leads/<id>
```

### `GET /api/leads/:id/messages`

**Auth:** Basic — message history (`page`, `pageSize`).

```bash
curl -u admin:password http://localhost:3000/api/leads/<id>/messages
```

### `POST /api/leads/:id/opt-out`

**Auth:** Basic — manually blocks future outreach.

```bash
curl -u admin:password -X POST http://localhost:3000/api/leads/<id>/opt-out
```

---

## Outreach management

### `POST /api/outreach/start`

**Auth:** Basic  
Requires `"confirm": true`.

```json
{
  "confirm": true,
  "name": "Delhi NCR week 1",
  "leadIds": ["optional", "subset"],
  "statuses": ["PENDING", "FAILED"],
  "messageTemplate": "optional override",
  "dailyLimit": 35,
  "minDelaySeconds": 60
}
```

```bash
curl -u admin:password -H 'Content-Type: application/json' \
  -d '{"confirm":true,"name":"Week 1"}' \
  http://localhost:3000/api/outreach/start
```

**Errors:** `400` if `confirm` missing or no eligible leads; `401` unauthorized.

### `POST /api/outreach/pause`

```bash
curl -u admin:password -X POST http://localhost:3000/api/outreach/pause
```

### `POST /api/outreach/resume`

```bash
curl -u admin:password -X POST http://localhost:3000/api/outreach/resume
```

### `GET /api/outreach/stats`

```bash
curl -u admin:password http://localhost:3000/api/outreach/stats
```

Returns campaign/queue/sent/failed/reply counts plus daily cap usage.

### `GET /api/outreach/campaigns`

```bash
curl -u admin:password 'http://localhost:3000/api/outreach/campaigns?page=1'
```

### `GET /api/outreach/campaigns/:id`

```bash
curl -u admin:password http://localhost:3000/api/outreach/campaigns/<id>
```

---

## Gemini (optional message personalization)

### `GET /api/gemini/status`

**Auth:** Basic — reports whether Gemini is configured/enabled. Never returns the API key.

```bash
curl -u admin:password http://localhost:3000/api/gemini/status
```

### `POST /api/gemini/preview`

**Auth:** Basic — generate a sample outreach message for a lead (uses Gemini when enabled).

```bash
curl -u admin:password -H 'Content-Type: application/json' \
  -d '{"businessName":"Acme Motors","contactPerson":"Riya","locality":"Saket","category":"Auto"}' \
  http://localhost:3000/api/gemini/preview
```

### `POST /api/gemini/raw`

**Auth:** Basic — raw `generateContent` probe (`{ "prompt": "..." }`).

---

## Telegram

### `GET /api/telegram/status`

**Auth:** Basic

```json
{
  "configured": true,
  "operational": true,
  "detail": "bot:@your_bot",
  "timestamp": "2026-03-29T12:00:00.000Z"
}
```

Never returns bot token or chat ID.

```bash
curl -u admin:password http://localhost:3000/api/telegram/status
```

---

## Incoming webhook

### `POST /api/webhooks/whatsapp`

Receives Evolution API events. Verifies shared secret. Idempotent on duplicate event keys.

```bash
curl -X POST http://localhost:3000/api/webhooks/whatsapp \
  -H 'Authorization: Bearer <WHATSAPP_WEBHOOK_SECRET>' \
  -H 'Content-Type: application/json' \
  -d '{"event":"MESSAGES_UPSERT","instance":"backseat-outreach","data":{}}'
```

**Response `200`**

```json
{ "accepted": true, "duplicate": false, "processed": 1 }
```

**Errors:** `401` invalid secret, `500` processing failure.

Inbound handling:

1. Ignore `fromMe` and group JIDs.
2. Match sender phone to a lead.
3. Persist inbound message.
4. Opt-out keywords → `OPTED_OUT`; otherwise → `REPLIED`.
5. Telegram notify for matched replies.
6. Never auto-reply on WhatsApp.

---

## Common error codes

| HTTP | Meaning |
|---|---|
| `400` | Validation / business rule |
| `401` | Auth failure |
| `404` | Resource not found |
| `409` | Conflict (duplicate phone) |
| `502` | Upstream Evolution failure |
| `503` | Dependency / QR unavailable |
| `500` | Unexpected server error |
