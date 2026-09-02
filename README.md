# Incident Triage Service

Receives incident alerts via webhook, triages them with Gemini (severity, category,
summary, recommended action), posts a structured summary to Slack, and shows incident
history on a dashboard with a manual resolve action.

## Architecture

```
webhook POST -> persist raw alert -> Gemini triage -> update record -> Slack notify
                                                              |
                                            React SPA <- REST API (list/detail/resolve)
```

- **Server**: Express + TypeScript (`src/`). `POST /api/webhook/incident` ingests
  alerts; `GET /api/incidents`, `GET /api/incidents/:id`, `PATCH /api/incidents/:id/resolve`
  serve the dashboard.
- **Triage**: [src/triage/triageIncident.ts](src/triage/triageIncident.ts) calls Gemini
  (`gemini-3.5-flash-lite`) for structured JSON output, validated against a Zod schema.
- **Key rotation**: [src/llm/keyRotation.ts](src/llm/keyRotation.ts) is a standalone,
  unit-tested module (`npm test`) that round-robins a pool of Gemini API keys and
  benches any key that comes back rate-limited (429) until its cooldown elapses.
- **Data**: Prisma + Postgres (Neon), one `Incident` table.
- **Dashboard**: Vite + React SPA (`client/`), built and served statically by Express
  in production — one deployable unit, no separate frontend host.

## Key design decisions

- **Persist before triage.** The incident is written to the DB immediately on webhook
  receipt, before calling Gemini or Slack. If triage or Slack fails, the alert is still
  captured (with `triageError` set) instead of being silently dropped — failure in a
  downstream step never costs the record of the alert itself.
- **Key rotation for Gemini.** Rate limits are per-key; a single-key setup means one
  noisy source of alerts can throttle triage for everyone. Rotating across a pool
  spreads load and keeps triage available under bursts, and it's built as a pure,
  I/O-free class so the rotation/cooldown logic is testable without hitting the API.
- **Slack Incoming Webhook, not a full Bolt app.** Resolve happens on the dashboard,
  not via Slack interactivity, so there's no need for OAuth, signing-secret
  verification, or a public request URL just to post a message — one webhook URL is
  the entire integration surface.
- **Prisma + Neon pooled connection.** Neon's pooled (`-pooler`) endpoint is required
  because the app opens short-lived connections per request/container; the direct
  (non-pooled) endpoint runs out of connections under normal traffic.

## Local development

```bash
# server
cp .env.example .env   # fill in DATABASE_URL, GEMINI_API_KEYS, SLACK_WEBHOOK_URL
npm install
npx prisma migrate dev --name init
npm run dev             # http://localhost:3000

# client (separate terminal)
cd client
npm install
npm run dev              # http://localhost:5173, proxies /api to :3000
```

Send a test alert:

```bash
curl -X POST http://localhost:3000/api/webhook/incident \
  -H "Content-Type: application/json" \
  -d '{"source":"datadog","title":"DB CPU at 95%","description":"Primary Postgres instance CPU sustained above 90% for 10 minutes"}'
```

## Docker

```bash
docker build -t incident-triage .
docker run -p 3000:3000 --env-file .env incident-triage
```

## Deploying

- **Render**: Web Service from this repo's Dockerfile, env vars `DATABASE_URL`
  (Neon pooled connection string), `GEMINI_API_KEYS`, `SLACK_WEBHOOK_URL`,
  `PUBLIC_BASE_URL`.
- **Fly.io**: `fly launch`, then `fly secrets set DATABASE_URL=... GEMINI_API_KEYS=...
  SLACK_WEBHOOK_URL=... PUBLIC_BASE_URL=...`.

The container runs `prisma migrate deploy` on startup before starting the server.

## Bugs found and fixed during setup

1. **OpenSSL missing on `node:20-slim`.** Prisma's query engine couldn't detect
   libssl at runtime and silently guessed a version (`prisma:warn ... Defaulting to
   "openssl-1.1.x"`) — a latent risk of the engine failing to load. Fixed by adding
   `RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*`
   to the Dockerfile's runtime stage.
2. **`docker run --env-file` doesn't strip quotes.** `.env` had quoted values
   (`DATABASE_URL="postgresql://..."`), which is fine for shells and `dotenv`, but
   Docker's `--env-file` passes the quotes through literally — Prisma then saw a URL
   starting with `"` and failed schema validation (`P1012`). Fixed by reformatting
   `.env` and `.env.example` to unquoted `KEY=value` lines, which both Docker and
   `dotenv` handle correctly.
