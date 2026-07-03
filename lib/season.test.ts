/**
 * Tests for Slice 14 — Season Rollover.
 *
 * ===========================================================================
 * WHAT THIS COVERS (TDD — written BEFORE any implementation exists)
 * ===========================================================================
 *
 * Two intended new exports, plus derived-read locks on the existing
 * dbGameService:
 *
 *   1. lib/season.ts (NEW pure module — no Prisma imports, UTC math):
 *        - nextQuarterAfter(endsOn: Date): SeasonWindow
 *        - isSeasonExpired(today: Date, endsOn: Date): boolean
 *        - QUARTER_MONTHS constant
 *
 *   2. lib/jobs.ts (NEW export):
 *        - rolloverSeasonIfDue(today, deps?) — orchestration tested via
 *          INJECTED fake deps (never hits a DB), mirroring lib/jobs.test.ts.
 *
 *   3. Derived-read locks on lib/services/dbGameService.ts, tested with a
 *      stateful in-memory Prisma fake + vi.mock("@/lib/db/client"), mirroring
 *      lib/services/dbGameService.pairing.test.ts:
 *        - season leaderboard resets to 0 after rollover; all-time unchanged
 *        - getLeaderboard performs NO destructive deletes (pure aggregation)
 *        - pairing history for a new season is fresh (scoped to current season)
 *
 * ===========================================================================
 * WHY THESE FAIL PRE-IMPLEMENTATION
 * ===========================================================================
 *
 *   - `@/lib/season` does not exist yet → the import fails to resolve, so every
 *     pure-helper and rolloverSeasonIfDue test fails at module-load time.
 *   - `rolloverSeasonIfDue` is not exported from `@/lib/jobs` yet → the named
 *     import is undefined, so those tests fail for the missing-export reason.
 *
 * The derived-read locks import from the ALREADY-implemented dbGameService;
 * they document and pin the behaviour rollover depends on. They live here (the
 * spec names lib/season.test.ts as the single verifiable-outcome file).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SeasonWindow } from "@/lib/season";
import {
  QUARTER_MONTHS,
  nextQuarterAfter,
  isSeasonExpired,
} from "@/lib/season";
import { rolloverSeasonIfDue } from "@/lib/jobs";

// ===========================================================================
// Shared constants (no magic numbers / repeated literals)
// ===========================================================================

const CALLED_ONCE = 1;
const NEVER_CALLED = 0;

/** UTC midnight for a given ISO calendar day (no time component). */
const utcDay = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);

// ===========================================================================
// lib/season.ts — QUARTER_MONTHS constant
// ===========================================================================

describe("season: QUARTER_MONTHS", () => {
  it("is 3 (a quarter spans three calendar months)", () => {
    const MONTHS_IN_A_QUARTER = 3;
    expect(QUARTER_MONTHS).toBe(MONTHS_IN_A_QUARTER);
  });
});

// ===========================================================================
// lib/season.ts — nextQuarterAfter (pure UTC quarter math)
//
// Returns the quarter STRICTLY AFTER the quarter containing `endsOn`:
//   startsOn = first UTC calendar day of that next quarter
//   endsOn   = last  UTC calendar day of that next quarter
//   name     = `${year} Q${n}` where n is 1..4
// ===========================================================================

describe("season: nextQuarterAfter", () => {
  it("Q3 end (2026-09-30) → 2026 Q4 (Oct 1 .. Dec 31)", () => {
    const window = nextQuarterAfter(utcDay("2026-09-30"));

    expect(window.name).toBe("2026 Q4");
    expect(window.startsOn.toISOString()).toBe(
      utcDay("2026-10-01").toISOString(),
    );
    expect(window.endsOn.toISOString()).toBe(
      utcDay("2026-12-31").toISOString(),
    );
  });

  it("Q4 end (2026-12-31) → 2027 Q1 (Jan 1 .. Mar 31) — year rolls over", () => {
    const window = nextQuarterAfter(utcDay("2026-12-31"));

    expect(window.name).toBe("2027 Q1");
    expect(window.startsOn.toISOString()).toBe(
      utcDay("2027-01-01").toISOString(),
    );
    expect(window.endsOn.toISOString()).toBe(
      utcDay("2027-03-31").toISOString(),
    );
  });

  it("Q1 end (2026-03-31) → 2026 Q2 (Apr 1 .. Jun 30)", () => {
    const window = nextQuarterAfter(utcDay("2026-03-31"));

    expect(window.name).toBe("2026 Q2");
    expect(window.startsOn.toISOString()).toBe(
      utcDay("2026-04-01").toISOString(),
    );
    expect(window.endsOn.toISOString()).toBe(
      utcDay("2026-06-30").toISOString(),
    );
  });

  it("Q2 end (2026-06-30) → 2026 Q3 (Jul 1 .. Sep 30)", () => {
    const window = nextQuarterAfter(utcDay("2026-06-30"));

    expect(window.name).toBe("2026 Q3");
    expect(window.startsOn.toISOString()).toBe(
      utcDay("2026-07-01").toISOString(),
    );
    expect(window.endsOn.toISOString()).toBe(
      utcDay("2026-09-30").toISOString(),
    );
  });

  it("uses the quarter CONTAINING endsOn, not the exact date (mid-quarter end)", () => {
    // Aug 15 lives in Q3; the next quarter is still Q4 2026.
    const window = nextQuarterAfter(utcDay("2026-08-15"));

    expect(window.name).toBe("2026 Q4");
    expect(window.startsOn.toISOString()).toBe(
      utcDay("2026-10-01").toISOString(),
    );
    expect(window.endsOn.toISOString()).toBe(
      utcDay("2026-12-31").toISOString(),
    );
  });

  it("produces UTC-midnight boundaries (no stray time-of-day component)", () => {
    const window = nextQuarterAfter(utcDay("2026-09-30"));

    expect(window.startsOn.getUTCHours()).toBe(0);
    expect(window.startsOn.getUTCMinutes()).toBe(0);
    expect(window.startsOn.getUTCSeconds()).toBe(0);
    expect(window.startsOn.getUTCMilliseconds()).toBe(0);
    expect(window.endsOn.getUTCHours()).toBe(0);
    expect(window.endsOn.getUTCMinutes()).toBe(0);
    expect(window.endsOn.getUTCSeconds()).toBe(0);
    expect(window.endsOn.getUTCMilliseconds()).toBe(0);
  });
});

// ===========================================================================
// lib/season.ts — isSeasonExpired (UTC calendar-day comparison)
//
// True IFF the UTC calendar day of `today` is STRICTLY AFTER the UTC calendar
// day of `endsOn`. Same day = still in season.
// ===========================================================================

describe("season: isSeasonExpired", () => {
  it("is true when today's UTC day is after endsOn (2026-10-01 09:00Z vs 2026-09-30)", () => {
    const today = new Date("2026-10-01T09:00:00.000Z");
    expect(isSeasonExpired(today, utcDay("2026-09-30"))).toBe(true);
  });

  it("is false on the LAST day of the season (2026-09-30 23:59Z vs 2026-09-30)", () => {
    const today = new Date("2026-09-30T23:59:00.000Z");
    expect(isSeasonExpired(today, utcDay("2026-09-30"))).toBe(false);
  });

  it("is false the day before the season ends (2026-09-29 vs 2026-09-30)", () => {
    const today = utcDay("2026-09-29");
    expect(isSeasonExpired(today, utcDay("2026-09-30"))).toBe(false);
  });

  it("is true the day after the season ends (2026-10-01 00:00Z vs 2026-09-30)", () => {
    const today = utcDay("2026-10-01");
    expect(isSeasonExpired(today, utcDay("2026-09-30"))).toBe(true);
  });

  it("compares CALENDAR days, not exact instants (00:00Z start-of-endsOn day is not expired)", () => {
    const today = new Date("2026-09-30T00:00:00.000Z");
    expect(isSeasonExpired(today, utcDay("2026-09-30"))).toBe(false);
  });
});

// ===========================================================================
// lib/jobs.ts — rolloverSeasonIfDue (orchestration via INJECTED fake deps)
//
// Contract:
//   type RolloverDeps = {
//     getCurrentSeason: () => Promise<{ id: string; endsOn: Date } | null>;
//     rollover: (currentSeasonId: string, next: SeasonWindow)
//       => Promise<{ id: string }>;
//   };
//   rolloverSeasonIfDue(today, deps?)
//     => Promise<{ rolledOver: boolean; newSeasonId?: string }>
//
// No DB is ever touched — fakes are injected exactly like lib/jobs.test.ts.
// ===========================================================================

const CURRENT_SEASON_ID = "season-current";
const NEW_SEASON_ID = "season-new";

/** A "today" that is strictly after the Q3-2026 season end. */
const TODAY_AFTER_Q3 = new Date("2026-10-01T09:00:00.000Z");

/** Season windows referenced by the orchestration tests. */
const Q3_2026_ENDS_ON = utcDay("2026-09-30");
const Q4_2026_STARTS_ON = utcDay("2026-10-01");
const Q4_2026_ENDS_ON = utcDay("2026-12-31");
const Q4_2026_NAME = "2026 Q4";

describe("jobs: rolloverSeasonIfDue", () => {
  it("no current season → { rolledOver: false } and rollover is never called", async () => {
    const getCurrentSeason = vi.fn().mockResolvedValue(null);
    const rollover = vi.fn();

    const result = await rolloverSeasonIfDue(TODAY_AFTER_Q3, {
      getCurrentSeason,
      rollover,
    });

    expect(result).toEqual({ rolledOver: false });
    expect(rollover).toHaveBeenCalledTimes(NEVER_CALLED);
  });

  it("current season NOT expired → { rolledOver: false } and rollover is never called", async () => {
    // today is BEFORE the season end, so isSeasonExpired is false.
    const notYet = utcDay("2026-09-15");
    const getCurrentSeason = vi.fn().mockResolvedValue({
      id: CURRENT_SEASON_ID,
      endsOn: Q3_2026_ENDS_ON,
    });
    const rollover = vi.fn();

    const result = await rolloverSeasonIfDue(notYet, {
      getCurrentSeason,
      rollover,
    });

    expect(result).toEqual({ rolledOver: false });
    expect(rollover).toHaveBeenCalledTimes(NEVER_CALLED);
  });

  it("current season expired → rolls over once with the correct id + next SeasonWindow", async () => {
    const getCurrentSeason = vi.fn().mockResolvedValue({
      id: CURRENT_SEASON_ID,
      endsOn: Q3_2026_ENDS_ON,
    });
    const rollover = vi.fn().mockResolvedValue({ id: NEW_SEASON_ID });

    const result = await rolloverSeasonIfDue(TODAY_AFTER_Q3, {
      getCurrentSeason,
      rollover,
    });

    // Exactly one rollover.
    expect(rollover).toHaveBeenCalledTimes(CALLED_ONCE);

    // It received the CURRENT season id.
    const [passedCurrentId, passedWindow] = rollover.mock.calls[0] as [
      string,
      SeasonWindow,
    ];
    expect(passedCurrentId).toBe(CURRENT_SEASON_ID);

    // It received the correct next SeasonWindow (the quarter after Q3 → Q4).
    expect(passedWindow.name).toBe(Q4_2026_NAME);
    expect(passedWindow.startsOn.toISOString()).toBe(
      Q4_2026_STARTS_ON.toISOString(),
    );
    expect(passedWindow.endsOn.toISOString()).toBe(
      Q4_2026_ENDS_ON.toISOString(),
    );

    // It surfaces the newly-created season id.
    expect(result).toEqual({ rolledOver: true, newSeasonId: NEW_SEASON_ID });
  });

  it("is idempotent across a quarter boundary — a second run no-ops (rollover called exactly once)", async () => {
    // STATEFUL fake: rollover mutates the "current season" so the SECOND call to
    // getCurrentSeason returns the NEW season, whose endsOn (Q4 end) is in the
    // FUTURE relative to today → not expired → no second rollover. This locks
    // "crossing a quarter boundary creates exactly one new current season".
    type SeasonState = { id: string; endsOn: Date };
    let currentSeason: SeasonState = {
      id: CURRENT_SEASON_ID,
      endsOn: Q3_2026_ENDS_ON,
    };

    const getCurrentSeason = vi.fn(async () => currentSeason);
    const rollover = vi.fn(async (_currentId: string, next: SeasonWindow) => {
      // Persist the new current season derived from the computed window.
      currentSeason = { id: NEW_SEASON_ID, endsOn: next.endsOn };
      return { id: NEW_SEASON_ID };
    });

    const first = await rolloverSeasonIfDue(TODAY_AFTER_Q3, {
      getCurrentSeason,
      rollover,
    });
    const second = await rolloverSeasonIfDue(TODAY_AFTER_Q3, {
      getCurrentSeason,
      rollover,
    });

    // First run rolls over; second run sees the fresh (future-ending) season.
    expect(first).toEqual({ rolledOver: true, newSeasonId: NEW_SEASON_ID });
    expect(second).toEqual({ rolledOver: false });

    // The core no-duplicates lock: rollover ran exactly ONCE across both calls.
    expect(rollover).toHaveBeenCalledTimes(CALLED_ONCE);
  });
});

// ===========================================================================
// Derived-read locks on dbGameService (stateful in-memory Prisma fake)
//
// Approach mirrors lib/services/dbGameService.pairing.test.ts: a minimal
// stateful fake implementing exactly the Prisma surface each method touches,
// installed via vi.mock("@/lib/db/client"). The REAL rankPlayers / computePairing
// run (mocking them would defeat the point). createDbGameService is imported
// AFTER the mock is registered.
// ===========================================================================

// ---------------------------------------------------------------------------
// Fixture constants
// ---------------------------------------------------------------------------

/** Two seasons: an OLD (rolled-off) season and the NEW current season. */
const OLD_SEASON_ID = "season-old";
const CURRENT_SEASON_ID_DB = "season-current-db";

/** Active players in the leaderboard fixture. */
const LB_PLAYER_IDS = ["p1", "p2", "p3"] as const;

/** Old-season totals seeded as WeeklyScore rows (used by all-time). */
const OLD_TOTAL_P1 = 7;
const OLD_TOTAL_P2 = 4;
const OLD_TOTAL_P3 = 2;
const OLD_CORRECT_P1 = 5;
const OLD_CORRECT_P2 = 3;
const OLD_CORRECT_P3 = 1;

/** Fresh-season expectation: every player totals zero. */
const FRESH_TOTAL = 0;

const SEASON_SCOPE = "season" as const;
const ALL_TIME_SCOPE = "all_time" as const;

// ---------------------------------------------------------------------------
// Fake row shapes
// ---------------------------------------------------------------------------

type WeeklyScoreRow = {
  weekId: string;
  playerId: string;
  seasonId: string;
  participationPoints: number;
  correctGuesses: number;
  totalPoints: number;
};

type PlayerRow = {
  id: string;
  name: string;
  email: string;
  slackUserId: string | null;
  isAdmin: boolean;
  active: boolean;
};

// ---------------------------------------------------------------------------
// Leaderboard fake — supports the exact groupBy / findFirst / findMany surface
// getLeaderboard touches.
// ---------------------------------------------------------------------------

type GroupByArgs = {
  by: string[];
  where?: { seasonId?: string };
  _sum: { totalPoints?: boolean; correctGuesses?: boolean };
};

/**
 * Tracks any destructive call so we can assert getLeaderboard NEVER deletes.
 * A read-only aggregation must not touch deleteMany at all.
 */
type DeleteSpy = { calls: number };

const makeLeaderboardFake = (deleteSpy: DeleteSpy) => {
  // Old season has scored rows for every player; the NEW current season has NONE.
  const weeklyScores: WeeklyScoreRow[] = [
    {
      weekId: "old-w1",
      playerId: "p1",
      seasonId: OLD_SEASON_ID,
      participationPoints: 1,
      correctGuesses: OLD_CORRECT_P1,
      totalPoints: OLD_TOTAL_P1,
    },
    {
      weekId: "old-w1",
      playerId: "p2",
      seasonId: OLD_SEASON_ID,
      participationPoints: 1,
      correctGuesses: OLD_CORRECT_P2,
      totalPoints: OLD_TOTAL_P2,
    },
    {
      weekId: "old-w1",
      playerId: "p3",
      seasonId: OLD_SEASON_ID,
      participationPoints: 1,
      correctGuesses: OLD_CORRECT_P3,
      totalPoints: OLD_TOTAL_P3,
    },
  ];

  const players: PlayerRow[] = LB_PLAYER_IDS.map((id) => ({
    id,
    name: id.toUpperCase(),
    email: `${id}@getklar.com`,
    slackUserId: null,
    isAdmin: false,
    active: true,
  }));

  /** Sum grouped by playerId, optionally filtered to one season. */
  const groupBy = async (args: GroupByArgs) => {
    const filtered = args.where?.seasonId
      ? weeklyScores.filter((r) => r.seasonId === args.where?.seasonId)
      : weeklyScores;

    const byPlayer = new Map<
      string,
      { totalPoints: number; correctGuesses: number }
    >();
    for (const row of filtered) {
      const acc = byPlayer.get(row.playerId) ?? {
        totalPoints: 0,
        correctGuesses: 0,
      };
      acc.totalPoints += row.totalPoints;
      acc.correctGuesses += row.correctGuesses;
      byPlayer.set(row.playerId, acc);
    }

    return [...byPlayer.entries()].map(([playerId, sums]) => ({
      playerId,
      _sum: {
        totalPoints: sums.totalPoints,
        correctGuesses: sums.correctGuesses,
      },
    }));
  };

  return {
    _weeklyScores: weeklyScores,

    season: {
      // requireCurrentSeason: { where: { isCurrent: true } } → the NEW season.
      findFirst: async () => ({
        id: CURRENT_SEASON_ID_DB,
        isCurrent: true,
      }),
    },

    player: {
      // getLeaderboard: { where: { active: true } }
      findMany: async (args: { where?: { active?: boolean } }) => {
        if (args.where?.active === true) {
          return players.filter((p) => p.active);
        }
        return players;
      },
    },

    weeklyScore: {
      groupBy,
      // Presence of this spy lets the test assert it is NEVER called by reads.
      deleteMany: async () => {
        deleteSpy.calls += 1;
        return { count: 0 };
      },
    },

    matchup: {
      // A read-only aggregation must never delete matchups either.
      deleteMany: async () => {
        deleteSpy.calls += 1;
        return { count: 0 };
      },
    },
  };
};

// ---------------------------------------------------------------------------
// Pairing fake — records the `where` passed to matchup.findMany so we can
// assert prior-pairing history is scoped to the CURRENT season only.
//
// Mirrors dbGameService.pairing.test.ts: openWeek(weekId) is the public trigger;
// the target week is already `open` and is the current week, so the guard
// passes cleanly and runPairingForWeek runs against the new current season.
// ---------------------------------------------------------------------------

const PAIRING_SEASON_ID = "season-current-pairing";
const PAIRING_PRIOR_SEASON_ID = "season-prior-pairing";
const PAIRING_OPEN_WEEK_ID = "week-new-open";
const PAIRING_PLAYER_IDS = ["a1", "a2"] as const;

type MatchupRow = {
  weekId: string;
  playerAId: string;
  playerBId: string;
  seasonId: string;
  pairKey: string;
  guessingUnlockedAt: Date | null;
};

type MatchupFindManyArgs = {
  where: { seasonId?: string; weekId?: { not?: string } | string };
  select?: unknown;
};

const makePairingFake = (recordedWheres: MatchupFindManyArgs["where"][]) => {
  const matchups: MatchupRow[] = [
    // A matchup from a PRIOR season — must be EXCLUDED from the new season's
    // pairing history (the seasonId filter drops it → fresh history).
    {
      weekId: "prior-week",
      playerAId: "a1",
      playerBId: "a2",
      seasonId: PAIRING_PRIOR_SEASON_ID,
      pairKey: "a1:a2",
      guessingUnlockedAt: null,
    },
  ];

  const weekParticipants: {
    weekId: string;
    playerId: string;
    absent: boolean;
    isBye: boolean;
  }[] = [];

  const players = PAIRING_PLAYER_IDS.map((id) => ({ id, active: true }));

  const weeks = [
    {
      id: PAIRING_OPEN_WEEK_ID,
      seasonId: PAIRING_SEASON_ID,
      status: "open" as const,
      startsAt: new Date("2026-10-05T00:00:00.000Z"),
    },
  ];

  const fake = {
    _matchups: matchups,

    season: {
      findFirst: async () => ({ id: PAIRING_SEASON_ID, isCurrent: true }),
    },

    week: {
      findFirst: async (args: {
        where: { seasonId: string; status?: string };
      }) => {
        if (args.where.status === "open") {
          return weeks.find((w) => w.status === "open") ?? null;
        }
        return null;
      },
      findMany: async () => weeks.map((w) => ({ id: w.id })),
      update: async (args: {
        where: { id: string };
        data: { status?: string };
      }) => {
        const week = weeks.find((w) => w.id === args.where.id);
        if (week && args.data.status) {
          week.status = args.data.status as typeof week.status;
        }
        return week;
      },
    },

    player: {
      findMany: async (args: { where?: { active?: boolean } }) => {
        if (args.where?.active === true) {
          return players.filter((p) => p.active).map((p) => ({ id: p.id }));
        }
        return players.map((p) => ({ id: p.id }));
      },
    },

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
        if (where.absent === true) return [];
        if (where.isBye === true) return [];
        return weekParticipants.filter((wp) =>
          where.weekId === undefined ? true : wp.weekId === where.weekId,
        );
      },
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
      createMany: async (args: {
        data: {
          weekId: string;
          playerId: string;
          absent: boolean;
          isBye: boolean;
        }[];
      }) => {
        weekParticipants.push(...args.data);
        return { count: args.data.length };
      },
    },

    matchup: {
      // RECORD every history query's `where` so the test can assert its
      // seasonId is the NEW current season (prior-season matchups excluded).
      findMany: async (args: MatchupFindManyArgs) => {
        recordedWheres.push(args.where);
        return matchups.filter((m) => {
          if (
            args.where.seasonId !== undefined &&
            m.seasonId !== args.where.seasonId
          ) {
            return false;
          }
          if (args.where.weekId !== undefined) {
            if (typeof args.where.weekId === "string") {
              if (m.weekId !== args.where.weekId) return false;
            } else if (args.where.weekId.not !== undefined) {
              if (m.weekId === args.where.weekId.not) return false;
            }
          }
          return true;
        });
      },
      createMany: async (args: { data: MatchupRow[] }) => {
        matchups.push(...args.data);
        return { count: args.data.length };
      },
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

    $transaction: async (
      fn: (tx: unknown) => Promise<unknown>,
      _opts?: unknown,
    ) => fn(fake),
  };

  return fake;
};

// ---------------------------------------------------------------------------
// Mock the DB client seam. A module-level holder lets each test install a fresh
// fake while the hoisted vi.mock factory closes over the holder.
// ---------------------------------------------------------------------------

let fakePrisma: unknown;

vi.mock("@/lib/db/client", () => ({
  getPrisma: () => fakePrisma,
}));

// ===========================================================================
// Derived read #1 + #2 — leaderboard reset + all-time persistence + no deletes
// ===========================================================================

describe("dbGameService.getLeaderboard: season resets, all-time persists (derived, non-destructive)", () => {
  let deleteSpy: DeleteSpy;

  beforeEach(() => {
    deleteSpy = { calls: NEVER_CALLED };
    fakePrisma = makeLeaderboardFake(deleteSpy);
  });

  it("season scope sums ONLY the current (fresh) season → every player totals 0", async () => {
    const { createDbGameService } = await import(
      "@/lib/services/dbGameService"
    );
    const service = createDbGameService();

    const rows = await service.getLeaderboard(SEASON_SCOPE);

    expect(rows).toHaveLength(LB_PLAYER_IDS.length);
    for (const row of rows) {
      expect(row.total).toBe(FRESH_TOTAL);
      expect(row.correctGuesses).toBe(FRESH_TOTAL);
    }
  });

  it("all_time scope sums ACROSS all seasons → old-season totals are unchanged", async () => {
    const { createDbGameService } = await import(
      "@/lib/services/dbGameService"
    );
    const service = createDbGameService();

    const rows = await service.getLeaderboard(ALL_TIME_SCOPE);
    const totalById = new Map(rows.map((r) => [r.playerId, r.total]));
    const correctById = new Map(
      rows.map((r) => [r.playerId, r.correctGuesses]),
    );

    expect(totalById.get("p1")).toBe(OLD_TOTAL_P1);
    expect(totalById.get("p2")).toBe(OLD_TOTAL_P2);
    expect(totalById.get("p3")).toBe(OLD_TOTAL_P3);
    expect(correctById.get("p1")).toBe(OLD_CORRECT_P1);
    expect(correctById.get("p2")).toBe(OLD_CORRECT_P2);
    expect(correctById.get("p3")).toBe(OLD_CORRECT_P3);
  });

  it("performs NO destructive deletes — reads are pure aggregations (no rows removed on rollover)", async () => {
    const { createDbGameService } = await import(
      "@/lib/services/dbGameService"
    );
    const service = createDbGameService();

    await service.getLeaderboard(SEASON_SCOPE);
    await service.getLeaderboard(ALL_TIME_SCOPE);

    // Neither weeklyScore nor matchup deleteMany may fire during a read.
    expect(deleteSpy.calls).toBe(NEVER_CALLED);
    // The seeded old-season history is still present after reading.
    const fake = fakePrisma as ReturnType<typeof makeLeaderboardFake>;
    expect(fake._weeklyScores).toHaveLength(LB_PLAYER_IDS.length);
  });
});

// ===========================================================================
// Derived read #3 — pairing treats a new season as fresh (empty history)
// ===========================================================================

describe("dbGameService pairing: new season starts with fresh (current-season-scoped) history", () => {
  let recordedWheres: MatchupFindManyArgs["where"][];

  beforeEach(() => {
    recordedWheres = [];
    fakePrisma = makePairingFake(recordedWheres);
  });

  it("scopes the prior-pairing history query to the NEW current season (prior-season matchups excluded)", async () => {
    const { createDbGameService } = await import(
      "@/lib/services/dbGameService"
    );
    const service = createDbGameService();

    // openWeek runs pairing for the week in the new current season.
    await service.openWeek(PAIRING_OPEN_WEEK_ID);

    // The history read must be scoped to the CURRENT season, not the prior one.
    const historyWheres = recordedWheres.filter(
      (w) => w.seasonId !== undefined,
    );
    expect(historyWheres.length).toBeGreaterThan(NEVER_CALLED);
    for (const where of historyWheres) {
      expect(where.seasonId).toBe(PAIRING_SEASON_ID);
      expect(where.seasonId).not.toBe(PAIRING_PRIOR_SEASON_ID);
    }
  });

  it("the prior-season matchup contributes NO pairing history to the new season", async () => {
    const { createDbGameService } = await import(
      "@/lib/services/dbGameService"
    );
    const service = createDbGameService();

    await service.openWeek(PAIRING_OPEN_WEEK_ID);

    // The recorded current-season history query returns nothing for the new
    // season (the only seeded matchup belongs to PAIRING_PRIOR_SEASON_ID), so
    // the new season's pairing history is fresh/empty.
    const fake = fakePrisma as ReturnType<typeof makePairingFake>;
    const currentSeasonMatchupsBeforeThisWeek = fake._matchups.filter(
      (m) =>
        m.seasonId === PAIRING_SEASON_ID && m.weekId !== PAIRING_OPEN_WEEK_ID,
    );
    expect(currentSeasonMatchupsBeforeThisWeek).toHaveLength(NEVER_CALLED);
  });
});
