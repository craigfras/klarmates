# 12 — Slack DM Notifications

**Type:** HITL
**Depends on:** 09-db-backed-services

## What this delivers

A Slack bot that DMs players at the four key moments — new week / answer now, guessing unlocked, end-of-week reminder, and weekly results — using each player's Slack id (resolved by email).

## Human action required (why it can't be automated)

- **Create a Slack app** in the target workspace, add bot scopes (`chat:write`, `users:read`, `users:read.email`, `im:write`), install it, and copy the **Bot User OAuth token**. Requires Slack workspace admin approval; cannot be scripted.
- Set `SLACK_BOT_TOKEN`.

## Layers touched

- `lib/slack.ts` (Slack Web API client + send helpers)
- `lib/notifications.ts` (event → message mapping, called from service/jobs)
- `lib/services/dbGameService.ts` + job endpoints (emit notification events)
- `app/admin/roster/page.tsx` (action to resolve Slack ids from emails)
- `.env.example`

## Tasks

### Slack client
- [ ] Add `@slack/web-api`; `lib/slack.ts` exposes `dm(slackUserId, blocks)` via `chat.postMessage`.
- [ ] `resolveSlackIdByEmail(email)` using `users.lookupByEmail`; an admin action backfills `players.slack_user_id`.

### Notification triggers (`lib/notifications.ts`)
- [ ] `notifyNewWeek(player, weekLink)` — sent to all present players when a week opens (from `approveWeek`).
- [ ] `notifyGuessingUnlocked(player)` — sent when their matchup unlocks.
- [ ] `notifyEndOfWeekReminder(player)` — sent by the reminder job for outstanding answers/guesses.
- [ ] `notifyWeeklyResults(player, recap, rank)` — sent by the close job.
- [ ] No-op safely when `slack_user_id` is missing (log).

## Verifiable outcome

- Opening a week DMs every present player with a working link.
- When the second player in a pair answers, the first receives a "guessing unlocked" DM.
- The reminder and results DMs fire from their respective jobs (slice 13) with correct content.
- Players without a resolved Slack id are skipped without error.
