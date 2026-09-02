# Incident Triage Service

Receives incident alerts via webhook, triages them with Gemini, posts a structured
summary to Slack, and shows incident history on a dashboard.

Triage calls go through a key-rotation module ([src/llm/keyRotation.ts](src/llm/keyRotation.ts))
that round-robins across a pool of Gemini API keys and benches any key that comes back
rate-limited. Run its unit tests with `npm test`.

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

## Sending a test alert

```bash
curl -X POST http://localhost:3000/api/webhook/incident \
  -H "Content-Type: application/json" \
  -d '{"source":"datadog","title":"DB CPU at 95%","description":"Primary Postgres instance CPU sustained above 90% for 10 minutes"}'
```

## Production build

```bash
npm run build            # server -> dist/
cd client && npm run build  # client -> client/dist/
NODE_ENV=production node dist/index.js
```

## Docker

```bash
docker build -t incident-triage .
docker run -p 3000:3000 --env-file .env incident-triage
```

## Deploying

- **Render**: create a Web Service from this repo's Dockerfile, set env vars
  `DATABASE_URL` (Neon pooled connection string), `GEMINI_API_KEYS`,
  `SLACK_WEBHOOK_URL`, `PUBLIC_BASE_URL`.
- **Fly.io**: `fly launch` (accept the detected Dockerfile), then
  `fly secrets set DATABASE_URL=... GEMINI_API_KEYS=... SLACK_WEBHOOK_URL=... PUBLIC_BASE_URL=...`.

The container runs `prisma migrate deploy` on startup before starting the server.
