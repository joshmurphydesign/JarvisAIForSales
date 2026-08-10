# Jarvis Briefing Service

A thin backend for Project Jarvis. It holds CRM credentials centrally (never
on an employee's laptop), pulls lead metrics on a schedule for every
configured salesperson, compiles the same briefing script the Chrome
extension speaks, and delivers it via Slack and/or email.

This is the "phase 1" of the backend route discussed alongside the Chrome
extension: computing and delivering the briefing as text/Slack now, with
the option to bolt on real audio later (a phone call via a TTS provider, or
a thin client that just plays back the text) without reworking anything
here — delivery is decoupled from script generation by design.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy the env template and fill in real values:
   ```
   cp .env.example .env
   ```
   At minimum, set `BACKEND_API_KEY` (e.g. `openssl rand -hex 32`) — every
   admin/trigger endpoint rejects requests without it.
3. Copy the team config template and add your real salespeople:
   ```
   cp config/team.example.json config/team.json
   ```
   `config/team.json` holds real CRM tokens — it's already gitignored. Do
   not commit it. In production, load it from a secrets manager or mount it
   as a secret file instead of shipping it with the deploy.
4. Configure at least one delivery channel per person:
   - **Slack**: either a per-person `delivery.slack.webhookUrl` (an
     [Incoming Webhook](https://api.slack.com/messaging/webhooks), no bot
     needed), or set `SLACK_BOT_TOKEN` in `.env` and a per-person
     `delivery.slack.userId` to DM them directly.
   - **Email**: set `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` in
     `.env`, and each person's `delivery.email.to`.
5. Start it:
   ```
   npm start
   ```

## What runs on a schedule

Two scheduler modes, set via `SCHEDULER_MODE`:

- **`internal`** (default) — `node-cron` fires inside this process on
  `BRIEFING_CRON` (default `0 8 * * 1-5`, 8am weekdays, server local time).
  Requires a host that stays running continuously — a free tier that spins
  down on inactivity will simply miss the trigger. On Render, this means at
  least the paid Starter tier ($7/mo as of writing).
- **`external`** — no in-process cron at all. Point an outside scheduler (a
  GitHub Actions scheduled workflow, a free service like cron-job.org, etc.)
  at `POST /trigger-all` on whatever cadence you want. This lets the app run
  on a host that spins down between requests — e.g. Render's free tier —
  since the external caller "wakes" it when it hits the endpoint.

Switching between them later is just changing the env var (and your host's
plan) — no code changes either direction. Either mode briefs every
configured salesperson in one batch; per-person/per-timezone scheduling
isn't implemented yet.

### Running `external` mode on a free host (e.g. Render's free tier)

A ready-made scheduler for this lives at
[`.github/workflows/daily-briefing.yml`](../.github/workflows/daily-briefing.yml)
in the repo root. It calls `POST /trigger-all` on a cron schedule (default
`0 12 * * 1-5` UTC — adjust to your timezone; GitHub Actions cron doesn't
follow DST), which both briefs the team and wakes a spun-down free instance.

To enable it, add two repo secrets (Settings -> Secrets and variables ->
Actions):
- `JARVIS_BACKEND_URL` — e.g. `https://your-service.onrender.com`
- `JARVIS_BACKEND_API_KEY` — must match `BACKEND_API_KEY` set on the backend

You can also trigger it manually from the Actions tab (`workflow_dispatch`,
with an `isTest` checkbox) to verify delivery before relying on the schedule.

## API

Every route except `/health` requires `Authorization: Bearer <BACKEND_API_KEY>`.

- `GET /health` — liveness check, no auth required.
- `POST /trigger` — body `{ "name": "Alex Reyes", "isTest": true }`. Runs
  the pipeline immediately for one person. `isTest: true` uses randomized
  mock metrics instead of hitting the real CRM (mirrors the extension's
  "Test Briefing Audio" button).
- `POST /trigger-all` — body `{ "isTest": true }` (optional). Runs the
  pipeline for every configured salesperson in one call. This is what an
  external scheduler should hit when `SCHEDULER_MODE=external`.
- `GET /briefings` — the latest briefing recorded for every salesperson.
- `GET /briefings/:name` — the latest briefing for one salesperson.

Example manual test:
```
curl -X POST http://localhost:3000/trigger \
  -H "Authorization: Bearer $BACKEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alex Reyes", "isTest": true}'
```

## Known limitations (MVP)

- Briefing history is in-memory only (`src/store.js`) — it resets on
  restart. Fine for "what's the latest briefing," not for historical
  reporting; swap in a real database if that's needed later.
- One shared cron schedule for the whole team, not per-person timezones.
- Monday.com metrics are a best-effort heuristic (see `src/crm/monday.js`)
  since Monday boards have no canonical "deal" object — the same caveat
  that applies in the Chrome extension.
