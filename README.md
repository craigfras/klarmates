# Engineer Guessing Game

A weekly, turn-based "how well do you know your coworker" game for the Klar
engineering roster. Each week the system pairs everyone present, generates four
AI icebreaker questions (admin-approved), and has each pair answer about
themselves and then guess each other's answers from multiple choice. Correct
guesses and participation feed season + all-time leaderboards. Slack DMs drive
the loop; Vercel Cron runs it on schedule.

Stack: Next.js (App Router) · Postgres (Neon) via Prisma · Auth.js v5 (Google
SSO, locked to `getklar.com`) · Google Gemini · Slack Web API · Vercel Cron.

## Getting started (local)

```bash
npm install
cp .env.example .env.local   # then fill in real values (see the table below)
npm run db:generate          # generate the Prisma client
npm run db:migrate           # apply migrations to your dev DB (also runs the seed)
npm run dev                  # http://localhost:3000
```

By default the app runs against an **in-memory mock** (`USE_MOCK` unset). To run
against Postgres locally, set `USE_MOCK=false` and a `DATABASE_URL`.

In non-production the app skips real sign-in and uses a **dev actor** cookie, so
you can click through every screen without Google OAuth configured.

### Useful scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Vitest (unit only). Full run: `npx vitest run --no-file-parallelism` |
| `npx tsc --noEmit` | Typecheck (tests are in the `next build` path — keep them tsc-clean) |
| `npm run db:generate` | `prisma generate` |
| `npm run db:migrate` | `prisma migrate dev` (dev) — also runs the seed |
| `npm run db:deploy` | `prisma migrate deploy` (prod/CI — no seed, no prompts) |
| `npm run db:seed` | Seed the current season + ~26-player roster (idempotent) |

## Environment variables

Copy `.env.example` → `.env.local` for local dev; set the same keys in the
Vercel project for production. Full descriptions live in `.env.example`.

| Variable | Required | Used by | Notes |
|----------|----------|---------|-------|
| `DATABASE_URL` | prod / DB mode | app + seed (`lib/db/client.ts`) | Neon **pooled** (`-pooler`) host, `sslmode=require`. |
| `DIRECT_URL` | migrations | Prisma migrate (`prisma.config.ts`) | Neon **direct** (unpooled) host. Falls back to `DATABASE_URL` if unset. |
| `USE_MOCK` | **prod** | service selection (`lib/services`) | Must be **`false`** in production, or the app serves in-memory mock data. Any other value keeps the mock on. |
| `AUTH_GOOGLE_ID` | prod | Auth.js Google provider | OAuth 2.0 client id (Google Cloud Console). |
| `AUTH_GOOGLE_SECRET` | prod | Auth.js Google provider | OAuth 2.0 client secret. |
| `AUTH_SECRET` | prod | Auth.js (JWT) | Generate: `npx auth secret`. (`NEXTAUTH_SECRET` also accepted.) |
| `NEXTAUTH_URL` | prod | Auth.js + Slack deep-links (`dbGameService`) | The production origin, e.g. `https://your-app.vercel.app`. Also used to build the "this week" link inside DMs. |
| `GEMINI_API_KEY` | optional | question + distractor generation (`lib/ai.ts`) | Google AI Studio key. If unset/invalid, generation falls back to canned stubs (logged warning; game still works). Server-only. |
| `SLACK_BOT_TOKEN` | optional | DMs (`lib/slack.ts`) | Bot User OAuth token (`xoxb-…`). If unset, all DMs no-op safely. Server-only. |
| `CRON_SECRET` | prod | cron auth (`lib/cronAuth.ts`) | Long random string. Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>`. Routes **fail closed** — every `/api/cron/*` request is rejected when this is unset. |

> Note: the codebase uses **Auth.js v5** (`AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`
> / `AUTH_SECRET`) and **Google Gemini** (`GEMINI_API_KEY`) — not the
> `GOOGLE_CLIENT_ID` / `ANTHROPIC_API_KEY` names in the original spec.

## Deploy to Vercel (human-gated)

These steps require owning the Vercel account/project and the production
secrets, so they can't be scripted from the repo.

1. **Create the Vercel project** from this repo (framework auto-detected as
   Next.js).
2. **Set the production env vars** (Project → Settings → Environment Variables)
   for every row above marked "prod". Set `USE_MOCK=false`.
3. **Provision Postgres** (Neon). Put the pooled URL in `DATABASE_URL` and the
   direct URL in `DIRECT_URL`.
4. **Run migrations against the prod DB** and seed it (see runbook below).
5. **Google OAuth**: in the Google Cloud OAuth client, add the production
   redirect URI `https://<your-domain>/api/auth/callback/google`, and set
   `NEXTAUTH_URL` to `https://<your-domain>`.
6. **Slack**: confirm the prod `SLACK_BOT_TOKEN` (bot needs `chat:write` and
   `users:read.email` for id resolution).
7. **Cron**: Vercel reads `vercel.json` on deploy and registers the schedules
   automatically. It injects `CRON_SECRET` as the bearer, which the routes
   verify. Confirm the four jobs appear under Project → Cron.

### Cron schedule (`vercel.json`, UTC)

| Path | Schedule | When |
|------|----------|------|
| `/api/cron/draft-week` | `0 12 * * 6` | Sat 12:00 — draft next week's questions → awaiting approval |
| `/api/cron/reminder` | `0 18 * * 6` | Sat 18:00 — nudge players with outstanding answers/guesses |
| `/api/cron/close-week` | `59 23 * * 0` | Sun 23:59 — score, recap, results DMs, advance to next draft |
| `/api/cron/season-rollover` | `0 0 1 1,4,7,10 *` | Quarter start — reset season points + pairing history |

## First-season setup runbook

Run once, against the **production** database, after env vars are set.

1. **Migrate + seed the roster.** With prod `DATABASE_URL` / `DIRECT_URL` in the
   environment:
   ```bash
   npm run db:deploy    # apply migrations (no dev prompts, no auto-seed)
   npm run db:seed      # current season + ~26-player roster (idempotent)
   ```
   Edit `lib/db/seed.ts` first to reflect the real roster and admin(s). The seed
   upserts by email, so it's safe to re-run after edits.
2. **Resolve Slack ids.** Sign in as the admin, open **/admin/roster**, and run
   **Resolve Slack ids** (POST `/api/admin/roster` with `action: "resolve_slack"`).
   This looks each roster email up in Slack and backfills `slackUserId`. Players
   without a resolvable id simply won't receive DMs.
3. **Approve week 1.** Either wait for the Saturday `draft-week` cron or trigger
   it manually (below), then open **/admin/questions**, review/edit/regenerate
   the 4 questions, and **Approve**. Approval opens the week, generates pairings,
   and sends the "new week" DMs to present players.

### Triggering a cron job manually

```bash
curl -X POST https://<your-domain>/api/cron/draft-week \
  -H "Authorization: Bearer $CRON_SECRET"
```

## Smoke test (verifiable outcome)

1. The production URL loads and a `@getklar.com` user can sign in via Google.
2. Admin drafts → approves a week; present players receive "new week" Slack DMs.
3. A full pair completes answer → guess → reveal; the `close-week` job scores it
   and results DMs arrive.
4. The four cron jobs appear in the Vercel dashboard and fire on schedule.

## Architecture

Clean Architecture, four layers per feature — see `CLAUDE.md`:

- `views/` — UI only
- `services/` — pure business logic (mock + Postgres implementations behind one interface)
- `use-cases/` — orchestration, event handlers
- `data/` — Prisma / API / transformers
