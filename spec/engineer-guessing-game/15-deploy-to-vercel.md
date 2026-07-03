# 15 — Deploy to Vercel

**Type:** HITL
**Depends on:** 14-season-rollover

## What this delivers

The game running live at a real URL: web app + Postgres + Google SSO + Slack DMs + Claude generation + cron jobs all wired in production, with a successful end-to-end smoke test.

## Human action required (why it can't be automated)

- **Connect the repo to a Vercel project**, set all production environment variables, enable Vercel Cron, and point the OAuth redirect / `NEXTAUTH_URL` at the production domain. Requires owning the Vercel account/project and the production secrets; cannot be scripted from the repo.

## Layers touched

- Vercel project settings (env vars, cron) — external
- `vercel.json` (confirm cron in prod)
- Google OAuth client (add production redirect URI) — external
- Slack app (confirm prod token) — external
- `README.md` (deploy + env runbook)

## Tasks

### Configure (human-gated)
- [ ] Create the Vercel project from the repo; set env: `DATABASE_URL`, `GOOGLE_CLIENT_ID/SECRET`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (prod), `ANTHROPIC_API_KEY`, `SLACK_BOT_TOKEN`, `CRON_SECRET`.
- [ ] Run migrations against the prod DB (`db:migrate`) and seed the real ~26-player roster (+ admin, + Slack ids).
- [ ] Add the production redirect URI to the Google OAuth client.
- [ ] Confirm Vercel Cron picks up `vercel.json` schedules.

### Code/runbook
- [ ] `README.md`: full env-var table and a "first season setup" runbook (seed roster → resolve Slack ids → approve week 1).

## Verifiable outcome

- The production URL loads; a `@getklar.com` user signs in.
- An admin can draft → approve a week in prod; present players receive "new week" Slack DMs.
- A full pair completes answer → guess → reveal, the close job scores it, and results DMs arrive.
- Cron jobs appear in the Vercel dashboard and fire on schedule.
