# 05 — Pairing Engine

**Type:** AFK
**Depends on:** 01-scaffold-and-this-week-home

## What this delivers

A pure, unit-tested pairing module that, given the present players and the season's prior matchups, produces this week's pairs with no in-season repeats, a least-recently-benched bye for odd counts, and a least-recently-matched fallback when no all-fresh matching exists.

## Layers touched

- `lib/pairing.ts` (pure functions)
- `lib/pairing.test.ts`
- `lib/types.ts` (pairing input/output types)

## Tasks

### Types
- [ ] `PairingInput = { presentPlayerIds: string[]; priorPairs: { a: string; b: string; weekIndex: number }[]; priorByes: { playerId: string; weekIndex: number }[] }`.
- [ ] `PairingResult = { pairs: [string, string][]; byePlayerId: string | null; usedFallback: boolean }`.

### Algorithm (`lib/pairing.ts`)
- [ ] Build allowed-edges graph: all present-player pairs **excluding** those in `priorPairs` (this season).
- [ ] Compute a maximum matching (blossom algorithm or a small dependency for general matching).
- [ ] If the matching covers all present players (or all but one when odd), use it.
  - Odd → bye = present player not covered; if multiple candidates, choose **least-recently-benched** (oldest/no entry in `priorByes`).
- [ ] **Fallback:** if no covering matching exists, progressively re-admit forbidden edges ordered by oldest prior `weekIndex` (least-recently-matched first) until a covering matching is found; set `usedFallback = true`.

### Wire into service
- [ ] `gameService.openWeek(weekId)` (mock) calls `computePairing(...)` and creates matchups + the bye participant.

## Verifiable outcome

- `lib/pairing.test.ts` passes for: even count all-fresh; odd count produces exactly one bye chosen by least-recently-benched; a fully-constrained set triggers the fallback with `usedFallback=true` and least-recent repeats; absences reducing the set still pair correctly.
- No pair in the output appears in `priorPairs` unless `usedFallback` is true.
- The engine never throws / never fails to produce a result for any non-empty present set.
