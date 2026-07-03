# 04 — Scoring, Leaderboard & Recap (Mocked)

**Type:** AFK
**Depends on:** 03-guess-flow-and-reveal

## What this delivers

Weekly scores are computed (correct guesses + participation, with bye and silent-opponent rules), a `/leaderboard` page shows season and all-time rankings with the most-correct-guesses tiebreak, and a head-to-head recap appears after the week closes.

## Layers touched

- `lib/scoring.ts` (pure scoring functions + unit tests)
- `lib/services/gameService.ts` (add `getLeaderboard`, `getMyHistory`, `closeWeek` mock)
- `app/api/leaderboard/route.ts` (GET), `app/api/me/history/route.ts` (GET)
- `app/leaderboard/page.tsx`, `app/history/page.tsx`
- `components/LeaderboardTable.tsx`, `components/RecapCard.tsx`
- `lib/scoring.test.ts`

## Tasks

### Scoring (`lib/scoring.ts`)
- [ ] `scoreWeekForPlayer({ submittedOwnAnswers, correctGuesses, isBye }): { participation: 0|1; correctGuesses: number; total: number }`.
  - Bye → all zero. Otherwise participation = 1 if `submittedOwnAnswers`. `total = participation + correctGuesses`. Max 5 (4 + 1).
- [ ] Silent-opponent case is implicit: if guessing never unlocked, `correctGuesses = 0` but participation still 1.
- [ ] `rankPlayers(rows)` sorts by `total` desc, tiebreak by `correctGuesses` desc, then equal rank for true ties.

### Service
- [ ] `getLeaderboard(scope: 'season'|'all_time')` returns ranked rows.
- [ ] `closeWeek(weekId)` (mock) materializes weekly scores and builds `Recap` per matchup.
- [ ] `getMyHistory(playerId)` returns past matchups + recaps.

### API + UI
- [ ] `GET /api/leaderboard?scope=` and `GET /api/me/history`.
- [ ] `LeaderboardTable` with a season/all-time toggle; show rank, name, points, correct-guesses.
- [ ] `RecapCard` ("You 3/4, Alex 4/4") shown on home/history once the week is closed.

## Verifiable outcome

- `lib/scoring.test.ts` passes for: normal play, perfect 4/4 (=5 total), bye (=0), silent opponent (participation only =1), and a tie resolved by correct-guesses.
- `/leaderboard` renders season and all-time views with correct ordering and the tiebreak applied.
- After `closeWeek`, a head-to-head recap card shows the correct X/4 for both players.
