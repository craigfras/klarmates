# 09 — DB-Backed Services Replace Mocks

**Type:** AFK
**Depends on:** 08-postgres-provisioning-and-migrations

## What this delivers

A Postgres-backed implementation of the `GameService` interface so the entire player + admin loop (answer → unlock → guess → reveal → score → leaderboard → pairing → week open) persists across restarts, swapping out the in-memory mock.

## Layers touched

- `lib/services/dbGameService.ts` (real implementation of `GameService`)
- `lib/services/index.ts` (select impl via env: `USE_MOCK` flag)
- `lib/db/client.ts` (Prisma client singleton)
- `lib/db/seed.ts` (seed ~26 players + a current season)
- All `app/api/**` routes (point at the selected service — no signature changes)

## Tasks

### Repository
- [ ] Implement every `GameService` method against Prisma: `getMyWeek`, `submitAnswers`, `getGuessSheet`, `submitGuess`, `getLeaderboard`, `getMyHistory`, `getDraftQuestions`/`updateDraftQuestion`/`regenerateQuestion`/`approveWeek`, roster + absence methods, `openWeek`, `closeWeek`.
- [ ] Reuse pure modules unchanged: `lib/pairing.ts` and `lib/scoring.ts` (they take plain data, not the DB).
- [ ] Enforce the in-season no-repeat at write time using the uniqueness guard from slice 08; on conflict, the pairing engine's fallback already prevents it — assert/log if it ever fires.
- [ ] Set `matchups.guessing_unlocked_at` transactionally when the second player's answers land.

### Selection + seed
- [ ] `lib/services/index.ts` exports `gameService` = `USE_MOCK ? mockGameService : dbGameService`.
- [ ] `lib/db/seed.ts` seeds a season + sample players (mark `craig.f@getklar.com` as admin).

## Verifiable outcome

- With `USE_MOCK=false`, the full loop works end-to-end and **survives a server restart** (data is in Postgres).
- Seeded `craig.f@getklar.com` has admin access; seeded players appear in the roster.
- Scoring and pairing produce identical results to the mock-backed slices (same pure modules).
- No API route signatures changed — only the backing implementation.
