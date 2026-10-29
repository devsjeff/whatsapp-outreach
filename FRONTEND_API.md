# Frontend API Guide — Backseat WhatsApp Outreach (EC2)

Use this doc when wiring a separate frontend (React/Next/Vite/etc.) to the backend running on EC2.

Full low-level reference: [API.md](./API.md)

---

## 1. Base URL

After `docker compose up` on EC2, the API listens on **port 3000** (or `APP_PORT`).

| Environment | Base URL |
|---|---|
| Local | `http://localhost:3000` |
| EC2 (HTTP, open SG) | `http://<EC2_PUBLIC_IP>:3000` |
| EC2 + domain + TLS (recommended) | `https://api.yourdomain.com` |

**Frontend env example**

```env
VITE_API_BASE_URL=http://<EC2_PUBLIC_IP>:3000
# or
NEXT_PUBLIC_API_BASE_URL=https://api.yourdomain.com
```

**Health check (no auth)**

```http
GET {BASE_URL}/health
```

```bash
curl -s http://<EC2_PUBLIC_IP>:3000/health
```

Expected:

```json
{ "status": "ok", "service": "backseat-whatsapp-outreach" }
```

Ready check (DB/Redis):

```http
GET {BASE_URL}/api/health/ready
```

---

## 2. Authentication

Almost all admin endpoints use **HTTP Basic Auth**.

| Header | Value |
|---|---|
| `Authorization` | `Basic base64(username:password)` |

Credentials come from the server `.env`:

- `APP_AUTH_USERNAME`
- `APP_AUTH_PASSWORD`

**Browser / fetch example**

```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL; // e.g. http://3.x.x.x:3000
const username = import.meta.env.VITE_API_USER;
const password = import.meta.env.VITE_API_PASSWORD;

function authHeaders(extra: HeadersInit = {}): HeadersInit {
  const token = btoa(`${username}:${password}`);
  return {
    Authorization: `Basic ${token}`,
    ...extra,
  };
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}

export async function apiJson<T>(
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json();
}
```

> Do **not** ship real admin passwords in a public frontend build if the UI is internet-facing. Prefer a small BFF / server route that holds credentials, or restrict the UI to VPN / internal users.

---

## 3. CORS

Backend supports CORS via `CORS_ORIGIN` in `.env`.

```env
# Temporary / demos
CORS_ORIGIN=*

# Production — list your frontend origins
CORS_ORIGIN=https://app.yourdomain.com,http://localhost:5173
```

Rebuild/restart backend after changing CORS:

```bash
docker compose up -d --build backend
```

---

## 4. EC2 checklist for frontend access

1. Security Group inbound:
   - `3000/tcp` from your IP / frontend host (or `443` if behind nginx/ALB)
2. Confirm API:

```bash
curl -s http://<EC2_PUBLIC_IP>:3000/health
```

3. Set frontend `VITE_API_BASE_URL` / `NEXT_PUBLIC_API_BASE_URL` to that base.
4. Prefer HTTPS + reverse proxy for production (nginx/Caddy/ALB).

Webhook note: Evolution calls `APP_BASE_URL` internally. On Docker Compose keep:

```env
APP_BASE_URL=http://backend:3000
```

That is for container networking, **not** the URL the browser uses.

---

## 5. Endpoint map for UI screens

All paths below are relative to `{BASE_URL}`.

### Public (no auth)

| Method | Path | UI use |
|---|---|---|
| `GET` | `/health` | Liveness badge |
| `GET` | `/api/health/ready` | Dependency status |

### WhatsApp connection

| Method | Path | Auth | UI use |
|---|---|---|---|
| `GET` | `/api/whatsapp/status` | Basic | Connection badge |
| `POST` | `/api/whatsapp/connect` | Basic | Start pairing |
| `GET` | `/api/whatsapp/qr` | Basic | Show QR image (`qr.base64` data URL) |
| `POST` | `/api/whatsapp/disconnect` | Basic | Logout session |

**QR example**

```ts
const data = await apiGet<{
  state: string;
  qr: { base64: string | null } | null;
}>('/api/whatsapp/qr');

// <img src={data.qr?.base64 ?? ''} />
```

### Leads

| Method | Path | Auth | UI use |
|---|---|---|---|
| `POST` | `/api/leads/import` | Basic | CSV upload (`multipart`, field `file`) |
| `POST` | `/api/leads` | Basic | Add one lead |
| `GET` | `/api/leads?page=1&pageSize=20&status=PENDING&search=` | Basic | Lead table |
| `GET` | `/api/leads/:id` | Basic | Lead detail |
| `PATCH` | `/api/leads/:id` | Basic | Edit lead |
| `GET` | `/api/leads/:id/messages` | Basic | Message timeline |
| `POST` | `/api/leads/:id/opt-out` | Basic | Manual opt-out |

**Create lead body**

```json
{
  "businessName": "Acme Motors",
  "contactPerson": "Riya",
  "phone": "9876543210",
  "locality": "Saket",
  "category": "Auto"
}
```

**CSV columns**

```text
business_name,contact_person,phone,locality,category
```

**CSV upload example**

```ts
const form = new FormData();
form.append('file', fileInput.files[0]);

const res = await fetch(`${API_BASE}/api/leads/import`, {
  method: 'POST',
  headers: authHeaders(), // do not set Content-Type manually for FormData
  body: form,
});
```

Lead statuses: `PENDING` | `QUEUED` | `SENT` | `FAILED` | `REPLIED` | `OPTED_OUT` | `CONVERTED`

### Outreach / campaigns

| Method | Path | Auth | UI use |
|---|---|---|---|
| `POST` | `/api/outreach/start` | Basic | Start campaign (**requires** `"confirm": true`) |
| `POST` | `/api/outreach/pause` | Basic | Pause sending |
| `POST` | `/api/outreach/resume` | Basic | Resume sending |
| `GET` | `/api/outreach/stats` | Basic | Dashboard counters |
| `GET` | `/api/outreach/campaigns` | Basic | Campaign list |
| `GET` | `/api/outreach/campaigns/:id` | Basic | Campaign detail |

**Start campaign body**

```json
{
  "confirm": true,
  "name": "Delhi NCR week 1"
}
```

Optional fields: `leadIds`, `statuses`, `messageTemplate`, `dailyLimit`, `minDelaySeconds`.

### Telegram

| Method | Path | Auth | UI use |
|---|---|---|---|
| `GET` | `/api/telegram/status` | Basic | “Notifications OK?” badge |

Never returns bot token / chat ID.

### Gemini (optional text personalization)

| Method | Path | Auth | UI use |
|---|---|---|---|
| `GET` | `/api/gemini/status` | Basic | Gemini enabled? |
| `POST` | `/api/gemini/preview` | Basic | Preview AI pitch text |
| `POST` | `/api/gemini/raw` | Basic | Raw prompt probe |

**Preview body**

```json
{
  "businessName": "Acme Motors",
  "contactPerson": "Riya",
  "locality": "Saket",
  "category": "Auto"
}
```

### Webhook (backend ↔ Evolution only — not for UI)

| Method | Path | Auth |
|---|---|---|
| `POST` | `/api/webhooks/whatsapp` | Webhook secret |

Do not call this from the frontend.

---

## 6. Suggested frontend screens → APIs

1. **Setup / WhatsApp**
   - `GET /api/whatsapp/status`
   - `POST /api/whatsapp/connect`
   - `GET /api/whatsapp/qr` (poll every 3–5s until `state === "open"`)
2. **Leads**
   - `GET /api/leads`
   - `POST /api/leads` / `POST /api/leads/import`
   - `GET /api/leads/:id/messages`
3. **Campaign controls**
   - `GET /api/outreach/stats`
   - `POST /api/outreach/start|pause|resume`
   - `GET /api/outreach/campaigns`
4. **Replies**
   - `GET /api/leads?status=REPLIED`
   - Telegram handles live notify; UI can refresh the list

---

## 7. Common HTTP errors

| Code | Meaning |
|---|---|
| `400` | Validation / missing `confirm: true` / bad CSV |
| `401` | Bad/missing Basic auth |
| `404` | Lead/campaign not found |
| `409` | Duplicate phone |
| `502` | Evolution / Gemini upstream failure |
| `503` | Dependency down / QR unavailable / Gemini not configured |

---

## 8. Quick smoke test from your laptop

Replace IP + credentials:

```bash
export API=http://<EC2_PUBLIC_IP>:3000
export USER=admin
export PASS='<APP_AUTH_PASSWORD>'

curl -s $API/health
curl -s -u "$USER:$PASS" $API/api/whatsapp/status
curl -s -u "$USER:$PASS" $API/api/outreach/stats
curl -s -u "$USER:$PASS" "$API/api/leads?page=1&pageSize=10"
```

---

## 9. What the frontend should NOT do

- Do not talk to Evolution (`:8080`) from the browser — use `/api/whatsapp/*`.
- Do not call `/api/webhooks/whatsapp`.
- Do not store Gemini / Evolution / Telegram secrets in frontend env.
- Uploading leads must never auto-send; only `POST /api/outreach/start` with `confirm: true` starts outreach.
