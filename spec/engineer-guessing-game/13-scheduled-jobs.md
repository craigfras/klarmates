# 13 — Scheduled Jobs (Draft / Reminder / Close)

**Type:** AFK
**Depends on:** 09-db-backed-services

## What this delivers

The clockwork that drives the rolling Mon–Sun (UTC) week without manual steps (except the admin approval gate): auto-draft next week's questions, send an end-of-week reminder, and close the week (score, recap, results DMs, advance).

## Layers touched

- `app/api/cron/draft-week/route.ts`
- `app/api/cron/reminder/route.ts`
- `app/api/cron/close-week/route.ts`
- `lib/jobs.ts` (job bodies, callable from cron routes and tests)
- `vercel.json` (cron schedules)
- `lib/cronAuth.ts` (verify `CRON_SECRET` / Vercel cron header)

## Tasks

### Job bodies (`lib/jobs.ts`)
- [ ] `draftNextWeek()` — create the upcoming week in `awaiting_approval` with 4 Claude questions (slice 11). Does **not** open it (admin approves). Optionally DM admin that a draft is ready.
- [ ] `sendEndOfWeekReminders()` — for the open week, DM players with unanswered questions or unused unlocked guesses.
- [ ] `closeOpenWeek()` — for any `open` week past `ends_at`: materialize `weekly_scores` (using `lib/scoring.ts`), build recaps, send results DMs (slice 12), set status `closed`.

### Cron endpoints + schedule
- [ ] Each `app/api/cron/*` route verifies the cron secret/header, then calls its job body.
- [ ] `vercel.json` schedules (UTC): draft (e.g. Sat), reminder (e.g. Sat later), close (Sun 23:59). Document the cron expressions.
- [ ] Jobs are idempotent (safe to re-run; guard on status/`ends_at`).

## Verifiable outcome

- Hitting each cron endpoint locally (with the secret) runs its job: a draft week appears `awaiting_approval`; reminders DM only players with outstanding work; closing scores the week, writes recaps, and flips status to `closed`.
- Re-invoking a job does not double-score or double-DM.
- Unauthorized calls (missing secret) are rejected.
