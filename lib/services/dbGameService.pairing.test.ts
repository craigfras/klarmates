/**
 * REGRESSION TEST — runPairingForWeek is not idempotent per week.
 *
 * ============================================================
 * THE BUG (confirmed against the live DB)
 * ============================================================
 *
 * `runPairingForWeek` in lib/services/dbGameService.ts is NOT idempotent for a
 * single week. When pairing runs a SECOND time on the same week (e.g. an admin
 * re-opens the already-open current week, or approveWeek opens+pairs a draft and
 * a later openWeek re-pairs the now-current week), it APPENDS a second, disjoint
 * set of matchups instead of REPLACING the first set. Two root causes:
 *
 *   1. It deletes the week's WeekParticipant rows before re-creating them, but
 *      NEVER deletes the week's existing Matchup rows before `matchup.createMany`.
 *      The new pairs are simply appended.
 *
 *   2. Its prior-pairing history query uses `where: { seasonId }`, which INCLUDES
 *      the week currently being paired. So on the second run the engine treats
 *      the week's own current pairs as "history to avoid" and produces a
 *      completely DISJOINT second matching.
 *
 * Net effect after two runs: the week has 2x the matchups, and every player
 * appears in two different (non-reciprocal) pairs. Verified live: an open week
 * held 26 matchups for 26 players.
 *
 * ============================================================
 * THE FIX (what makes these tests pass)
 * ============================================================
 *
 *   - Delete the week's existing Matchup rows before createMany
 *     (`tx.matchup.deleteMany({ where: { weekId } })`), AND
 *   - Exclude the week being paired from the history query
 *     (`where: { seasonId, weekId: { not: weekId } }`).
 *
 * ============================================================
 * APPROACH
 * ============================================================
 *
 * There is no existing dbGameService test and no prisma-mocking precedent. We
 * establish a minimal one: a small STATEFUL in-memory fake implementing exactly
 * the Prisma surface that openWeek -> runPairingForWeek touches. The DB client
 * seam (`getPrisma` from @/lib/db/client) is mocked to return the fake. The REAL
 * `computePairing` from @/lib/pairing is used (it is correct and already tested
 * — mocking it would defeat the point).
 *
 * `openWeek(weekId)` is the chosen public trigger: its guard requires the target
 * week to be the current week, and getCurrentWeek prefers the open week, so a
 * week that is already `open` and is the current week passes the guard cleanly on
 * BOTH calls. Each call runs pairing on the same open week — exactly the
 * double-pairing scenario the bug describes.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** Number of active players in the fixture. Even, so there is no bye. */
const ACTIVE_PLAYER_COUNT = 4;

/** floor(ACTIVE_PLAYER_COUNT / 2) — the correct matchup count for one week. */
const EXPECTED_MATCHUPS = 2;

/** Each player must appear in at most one matchup (reciprocity holds). */
const MAX_MATCHUPS_PER_PLAYER = 1;

/** Fixture ids. */
const SEASON_ID = "season-1";
const OPEN_WEEK_ID = "week-open-1";
const PLAYER_IDS = ["p1", "p2", "p3", "p4"] as const;

const STATUS_OPEN = "open" as const;

// ---------------------------------------------------------------------------
// In-memory stateful Prisma fake
//
// Implements ONLY the surface openWeek -> runPairingForWeek touches. Mutable
// arrays for matchup and weekParticipant rows model the persisted state across
// the two pairing runs. Player / week / season are fixed reference data.
// ---------------------------------------------------------------------------

type MatchupRow = {
  weekId: string;
  playerAId: string;
  playerBId: string;
  seasonId: string;
  pairKey: string;
  guessingUnlockedAt: Date | null;
};

type WeekParticipantRow = {
  weekId: string;
  playerId: string;
  absent: boolean;
  isBye: boolean;
};

type WeekRow = {
  id: string;
  seasonId: string;
  status: string;
  startsAt: Date;
};

/**
 * Builds a fresh stateful fake for one test run. The matchup/weekParticipant
 * stores start empty; player/week/season are fixed.
 */
const makeFakePrisma = () => {
  const matchups: MatchupRow[] = [];
  const weekParticipants: WeekParticipantRow[] = [];

  const players = PLAYER_IDS.map((id) => ({ id, active: true }));

  const weeks: WeekRow[] = [
    {
      id: OPEN_WEEK_ID,
      seasonId: SEASON_ID,
      status: STATUS_OPEN,
      startsAt: new Date("2026-06-01T00:00:00.000Z"),
    },
  ];

  const fake = {
    // --- exposed stores for assertions ---
    _matchups: matchups,
    _weekParticipants: weekParticipants,

    // --- season ---
    season: {
      // requireCurrentSeason: { where: { isCurrent: true } }
      findFirst: async () => ({ id: SEASON_ID, isCurrent: true }),
    },

    // --- week ---
    week: {
      // getCurrentWeek: { where: { seasonId, status } }
      findFirst: async (args: { where: { seasonId: string; status?: string } }) => {
        const { status } = args.where;
        if (status === STATUS_OPEN) {
          return weeks.find((w) => w.status === STATUS_OPEN) ?? null;
        }
        // No closed / draft weeks in this fixture.
        return null;
      },
      // buildWeekIndexMap: { where: { seasonId }, orderBy: { startsAt: "asc" }, select }
      findMany: async () =>
        [...weeks]
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
          .map((w) => ({ id: w.id })),
      // openWeek tx: set status to open (already open — keep it open).
      update: async (args: { where: { id: string }; data: { status?: string } }) => {
        const week = weeks.find((w) => w.id === args.where.id);
        if (week && args.data.status) week.status = args.data.status;
        return week;
      },
    },

    // --- player ---
    player: {
      // resolvePresentPlayerIds: { where: { active: true }, select: { id: true } }
      findMany: async (args: { where?: { active?: boolean } }) => {
        if (args.where?.active === true) {
          return players.filter((p) => p.active).map((p) => ({ id: p.id }));
        }
        return players.map((p) => ({ id: p.id }));
      },
    },

    // --- weekParticipant ---
    weekParticipant: {
      findMany: async (args: {
        where: {
          weekId?: string;
          absent?: boolean;
          isBye?: boolean;
          week?: { seasonId?: string };
        };
      }) => {
        const { where } = args;
        // Absent-lookup ({ weekId, absent: true }) — nobody is absent.
        if (where.absent === true) return [];
        // Bye-history lookup ({ week: { seasonId }, isBye: true }) — no byes yet.
        if (where.isBye === true) return [];
        return weekParticipants.filter((wp) =>
          where.weekId === undefined ? true : wp.weekId === where.weekId,
        );
      },
      // runPairingForWeek: deleteMany({ where: { weekId } })
      deleteMany: async (args: { where: { weekId?: string } }) => {
        const { weekId } = args.where;
        let count = 0;
        for (let i = weekParticipants.length - 1; i >= 0; i -= 1) {
          if (weekId === undefined || weekParticipants[i].weekId === weekId) {
            weekParticipants.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      },
      // runPairingForWeek: createMany({ data })
      createMany: async (args: { data: WeekParticipantRow[] }) => {
        weekParticipants.push(...args.data);
        return { count: args.data.length };
      },
    },

    // --- matchup ---
    matchup: {
      // runPairingForWeek history read: { where: { seasonId, weekId?: { not } } }
      //
      // Must honour BOTH a seasonId filter AND an optional `weekId: { not: ... }`
      // filter. The CURRENT (buggy) code passes only { seasonId } — so on the
      // second run this returns the week's own freshly-created pairs as history.
      // The FIX adds `weekId: { not: weekId }`, which this fake honours so the
      // same test passes once implemented.
      findMany: async (args: {
        where: { seasonId?: string; weekId?: { not?: string } | string };
      }) => {
        const { where } = args;
        return matchups.filter((m) => {
          if (where.seasonId !== undefined && m.seasonId !== where.seasonId) {
            return false;
          }
          if (where.weekId !== undefined) {
            if (typeof where.weekId === "string") {
              if (m.weekId !== where.weekId) return false;
            } else if (where.weekId.not !== undefined) {
              if (m.weekId === where.weekId.not) return false;
            }
          }
          return true;
        });
      },
      // runPairingForWeek persist: createMany({ data }).
      // We deliberately do NOT enforce @@unique([seasonId, pairKey]) — honouring
      // it would mask the accumulation bug. We simply append, exactly as the DB
      // would for DISJOINT pairs (the second run produces a disjoint matching).
      createMany: async (args: { data: MatchupRow[] }) => {
        matchups.push(...args.data);
        return { count: args.data.length };
      },
      // The FIX calls this before createMany; the current code never does.
      // Implemented so it works the moment the fix invokes it.
      deleteMany: async (args: { where: { weekId?: string } }) => {
        const { weekId } = args.where;
        let count = 0;
        for (let i = matchups.length - 1; i >= 0; i -= 1) {
          if (weekId === undefined || matchups[i].weekId === weekId) {
            matchups.splice(i, 1);
            count += 1;
          }
        }
        return { count };
      },
    },

    // --- transaction: pass the same fake as `tx` ---
    $transaction: async (
      fn: (tx: unknown) => Promise<unknown>,
      _opts?: unknown,
    ) => fn(fake),
  };

  return fake;
};

// ---------------------------------------------------------------------------
// Mock the DB client seam.
//
// A module-level holder lets each test install a fresh fake (via beforeEach)
// while the mock factory — hoisted by vi.mock — closes over the holder.
// ---------------------------------------------------------------------------

let fakePrisma: ReturnType<typeof makeFakePrisma>;

vi.mock("@/lib/db/client", () => ({
  getPrisma: () => fakePrisma,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dbGameService.runPairingForWeek: idempotency regression", () => {
  beforeEach(() => {
    fakePrisma = makeFakePrisma();
  });

  it("a SINGLE pairing run yields exactly EXPECTED_MATCHUPS (baseline — isolates the bug to the second run)", async () => {
    // Import after vi.mock so the mocked getPrisma is in place.
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await service.openWeek(OPEN_WEEK_ID);

    expect(fakePrisma._matchups).toHaveLength(EXPECTED_MATCHUPS);
  });

  it("a SECOND pairing run REPLACES (not appends) — the matchup store holds exactly EXPECTED_MATCHUPS", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    // Run pairing twice on the same open/current week.
    await service.openWeek(OPEN_WEEK_ID);
    await service.openWeek(OPEN_WEEK_ID);

    // CORE ACCUMULATION ASSERTION.
    // Current (buggy) code: 4 matchups (2 from each disjoint run).
    // Fixed code: 2 matchups (the second run replaced the first).
    expect(fakePrisma._matchups).toHaveLength(EXPECTED_MATCHUPS);
  });

  it("a SECOND pairing run keeps reciprocity — every player appears in at most one matchup", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await service.openWeek(OPEN_WEEK_ID);
    await service.openWeek(OPEN_WEEK_ID);

    // Build a player -> matchup-count map across all persisted matchup rows.
    const appearanceCount = new Map<string, number>();
    for (const m of fakePrisma._matchups) {
      for (const playerId of [m.playerAId, m.playerBId]) {
        appearanceCount.set(playerId, (appearanceCount.get(playerId) ?? 0) + 1);
      }
    }

    // Current (buggy) code: every player appears twice (two disjoint pairings).
    // Fixed code: each player appears exactly once.
    for (const [playerId, count] of appearanceCount) {
      expect(
        count,
        `player "${playerId}" appears in ${count} matchups`,
      ).toBeLessThanOrEqual(MAX_MATCHUPS_PER_PLAYER);
    }

    // Sanity: all ACTIVE_PLAYER_COUNT players should be covered exactly once.
    expect(appearanceCount.size).toBe(ACTIVE_PLAYER_COUNT);
  });

  it("a SECOND pairing run is STABLE — it reproduces the first run's exact pairs (pins the history-exclusion change)", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    // Snapshot the pair set after the first run.
    await service.openWeek(OPEN_WEEK_ID);
    const firstPairKeys = new Set(fakePrisma._matchups.map((m) => m.pairKey));

    // Snapshot again after the second run.
    await service.openWeek(OPEN_WEEK_ID);
    const secondPairKeys = new Set(fakePrisma._matchups.map((m) => m.pairKey));

    // The deleteMany change alone keeps the COUNT correct even if the history
    // filter is reverted — but then the second run would treat the week's own
    // pairs as history and produce a DISJOINT matching (different pairKeys).
    // Asserting set equality pins `weekId: { not: weekId }` independently:
    // with the filter, run 2 sees no history for this week and deterministically
    // reproduces the same matching.
    expect([...secondPairKeys].sort()).toEqual([...firstPairKeys].sort());
  });
});
