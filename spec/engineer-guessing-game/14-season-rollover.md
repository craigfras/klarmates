# 14 — Season Rollover

**Type:** AFK
**Depends on:** 13-scheduled-jobs

## What this delivers

Quarterly season boundaries: when a season ends, season points reset to zero and in-season pairing history clears (so old matchups can recur fresh), while all-time totals persist — and a new current season begins.

## Layers touched

- `lib/jobs.ts` (add `rolloverSeasonIfDue`)
- `app/api/cron/season-rollover/route.ts`
- `vercel.json` (rollover schedule)
- `lib/services/dbGameService.ts` (`getLeaderboard` season scope reads current season; pairing reads current-season matchups only)
- `lib/season.test.ts`

## Tasks

### Rollover logic
- [ ] `rolloverSeasonIfDue(today)` — if the current season's `ends_on` has passed, mark it not-current and create the next quarterly season (`is_current = true`).
- [ ] Confirm season-scoped reads are **derived**, not destructive: `weekly_scores` carry `season_id`; the season leaderboard sums only the current season; all-time sums everything. No rows are deleted on rollover.
- [ ] Pairing's `priorPairs` query is already filtered to the current season (slice 09), so a new season starts with an empty pairing history automatically — verify and lock with a test.
- [ ] Cron route (UTC) verifies secret and calls `rolloverSeasonIfDue`; idempotent.

## Verifiable outcome

- `lib/season.test.ts` shows: after rollover, the season leaderboard resets to 0, all-time is unchanged, and pairing treats all matchups as fresh.
- Crossing a quarter boundary creates exactly one new current season (no duplicates on re-run).
- Historical `weekly_scores` and matchups remain in the DB after rollover.
