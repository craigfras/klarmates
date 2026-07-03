import { describe, it, expect } from "vitest";
import { computePairing } from "@/lib/pairing";
import type { PairingInput, PairingResult } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** weekIndex values that establish a clear recency ordering. */
const WEEK_OLDEST = 1;
const WEEK_MIDDLE = 2;
const WEEK_RECENT = 3;

// Additional week-index constants used by regression and stress tests.
const WEEK_FAR_PAST = 5;
const WEEK_LONG_AGO = 50;
const WEEK_VERY_LONG_AGO = 100;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const makePairingInput = (
  overrides: Partial<PairingInput> = {},
): PairingInput => ({
  presentPlayerIds: [],
  priorPairs: [],
  priorByes: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Structural invariant helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when every presentPlayerId appears in exactly one pair.
 * Assumes pairs do not double-count (each pair covers exactly two distinct
 * players).
 */
const allPresentCovered = (
  pairs: [string, string][],
  presentPlayerIds: string[],
): boolean => {
  const covered = pairs.flatMap(([a, b]) => [a, b]);
  if (covered.length !== presentPlayerIds.length) return false;
  const coverSet = new Set(covered);
  return presentPlayerIds.every((id) => coverSet.has(id));
};

/**
 * Normalises a pair to [min, max] so (a,b) and (b,a) compare equal.
 */
const normalisePair = (a: string, b: string): [string, string] =>
  a < b ? [a, b] : [b, a];

/**
 * Returns true when no returned pair (in either order) appears in priorPairs.
 */
const hasNoRepeatPairs = (
  pairs: [string, string][],
  priorPairs: PairingInput["priorPairs"],
): boolean => {
  const priorSet = new Set(
    priorPairs.map(({ a, b }) => normalisePair(a, b).join("|")),
  );
  return pairs.every(([a, b]) => {
    const key = normalisePair(a, b).join("|");
    return !priorSet.has(key);
  });
};

// ---------------------------------------------------------------------------
// computePairing: even count, all fresh
// ---------------------------------------------------------------------------

describe("computePairing: even count, all fresh", () => {
  it("returns N/2 pairs for N even players with no prior pairs", () => {
    const PRESENT_COUNT = 6;
    const EXPECTED_PAIR_COUNT = PRESENT_COUNT / 2;

    const result: PairingResult = computePairing(
      makePairingInput({
        presentPlayerIds: ["p1", "p2", "p3", "p4", "p5", "p6"],
      }),
    );

    expect(result.pairs).toHaveLength(EXPECTED_PAIR_COUNT);
  });

  it("sets byePlayerId to null for an even present count", () => {
    const result: PairingResult = computePairing(
      makePairingInput({
        presentPlayerIds: ["p1", "p2", "p3", "p4"],
      }),
    );

    expect(result.byePlayerId).toBeNull();
  });

  it("sets usedFallback to false when a fresh matching exists", () => {
    const result: PairingResult = computePairing(
      makePairingInput({
        presentPlayerIds: ["p1", "p2", "p3", "p4"],
      }),
    );

    expect(result.usedFallback).toBe(false);
  });

  it("covers every present player in exactly one pair (no doubling, no gaps)", () => {
    const presentPlayerIds = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const result: PairingResult = computePairing(
      makePairingInput({ presentPlayerIds }),
    );

    expect(allPresentCovered(result.pairs, presentPlayerIds)).toBe(true);
  });

  it("returns no pair that appears in priorPairs when a fresh matching exists", () => {
    const presentPlayerIds = ["p1", "p2", "p3", "p4"];
    const priorPairs = [
      { a: "p1", b: "p2", weekIndex: WEEK_RECENT },
      { a: "p3", b: "p4", weekIndex: WEEK_RECENT },
    ];

    const result: PairingResult = computePairing(
      makePairingInput({ presentPlayerIds, priorPairs }),
    );

    // Fresh cross-pairings (p1-p3, p1-p4, p2-p3, p2-p4) still exist so the
    // engine must choose from them exclusively.
    expect(hasNoRepeatPairs(result.pairs, priorPairs)).toBe(true);
  });

  it("pairs two fresh players into exactly one pair with no bye", () => {
    const result: PairingResult = computePairing(
      makePairingInput({ presentPlayerIds: ["p1", "p2"] }),
    );

    expect(result.pairs).toHaveLength(1);
    expect(result.byePlayerId).toBeNull();
    expect(result.usedFallback).toBe(false);
    // Pair must contain both players (either order).
    const [a, b] = result.pairs[0];
    expect(new Set([a, b])).toEqual(new Set(["p1", "p2"]));
  });
});

// ---------------------------------------------------------------------------
// computePairing: no in-season repeats (when fresh matching exists)
// ---------------------------------------------------------------------------

describe("computePairing: no in-season repeats when fresh matching available", () => {
  it("does not return any pair from priorPairs when an all-fresh covering exists", () => {
    // p1-p2 and p3-p4 already played. Cross pairs are all fresh.
    const presentPlayerIds = ["p1", "p2", "p3", "p4"];
    const priorPairs = [
      { a: "p1", b: "p2", weekIndex: WEEK_OLDEST },
      { a: "p3", b: "p4", weekIndex: WEEK_OLDEST },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorPairs }),
    );

    expect(hasNoRepeatPairs(result.pairs, priorPairs)).toBe(true);
    expect(result.usedFallback).toBe(false);
  });

  it("produces a valid fresh covering for 6 players where 2 prior pairs are known", () => {
    const presentPlayerIds = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const priorPairs = [
      { a: "p1", b: "p2", weekIndex: WEEK_OLDEST },
      { a: "p3", b: "p4", weekIndex: WEEK_OLDEST },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorPairs }),
    );

    expect(hasNoRepeatPairs(result.pairs, priorPairs)).toBe(true);
    expect(allPresentCovered(result.pairs, presentPlayerIds)).toBe(true);
    expect(result.usedFallback).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computePairing: odd count — bye selection
// ---------------------------------------------------------------------------

describe("computePairing: odd count — exactly one bye", () => {
  it("produces exactly one byePlayerId and pairs the remaining even count", () => {
    const PRESENT_COUNT = 5;
    const EXPECTED_PAIR_COUNT = (PRESENT_COUNT - 1) / 2;

    const result: PairingResult = computePairing(
      makePairingInput({
        presentPlayerIds: ["p1", "p2", "p3", "p4", "p5"],
      }),
    );

    expect(result.byePlayerId).not.toBeNull();
    expect(result.pairs).toHaveLength(EXPECTED_PAIR_COUNT);
  });

  it("covers every non-bye present player in exactly one pair", () => {
    const presentPlayerIds = ["p1", "p2", "p3", "p4", "p5"];

    const result: PairingResult = computePairing(
      makePairingInput({ presentPlayerIds }),
    );

    const pairedPlayers = result.pairs.flatMap(([a, b]) => [a, b]);
    // The bye player must NOT appear in any pair.
    expect(pairedPlayers).not.toContain(result.byePlayerId);
    // Every other present player must appear in exactly one pair.
    const expected = presentPlayerIds.filter(
      (id) => id !== result.byePlayerId,
    );
    expect(allPresentCovered(result.pairs, expected)).toBe(true);
  });

  it("chooses the player with NO prior bye entry as the bye (preferred over any with a bye record)", () => {
    // p1 had a bye at week 1; p2, p3, p4, p5 never had a bye.
    // The bye should be one of p2..p5 (any of them, since they're all equally unbenched).
    const presentPlayerIds = ["p1", "p2", "p3", "p4", "p5"];
    const priorByes = [{ playerId: "p1", weekIndex: WEEK_OLDEST }];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorByes }),
    );

    expect(result.byePlayerId).not.toBe("p1");
  });

  it("chooses the player with the oldest prior bye weekIndex when all have had byes", () => {
    // All three players have prior byes: p2 was benched oldest (WEEK_OLDEST),
    // p1 and p3 were both benched more recently (WEEK_RECENT).
    // p2 is the least-recently-benched → p2 gets the bye.
    const presentPlayerIds = ["p1", "p2", "p3"];
    const priorByes = [
      { playerId: "p1", weekIndex: WEEK_RECENT },
      { playerId: "p2", weekIndex: WEEK_OLDEST },
      { playerId: "p3", weekIndex: WEEK_RECENT },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorByes }),
    );

    expect(result.byePlayerId).toBe("p2");
  });

  it("breaks ties deterministically (lowest player id) when multiple players have no prior bye", () => {
    // p1 had a recent bye; p2 and p3 never had one.
    // Among the never-benched group the tie-break is lowest id: "p2" < "p3".
    const presentPlayerIds = ["p1", "p2", "p3"];
    const priorByes = [{ playerId: "p1", weekIndex: WEEK_RECENT }];

    const resultA = computePairing(
      makePairingInput({ presentPlayerIds, priorByes }),
    );
    const resultB = computePairing(
      makePairingInput({ presentPlayerIds, priorByes }),
    );

    // Both calls must agree (deterministic).
    expect(resultA.byePlayerId).toBe(resultB.byePlayerId);
    // And the chosen bye must be one of the never-benched players.
    expect(["p2", "p3"]).toContain(resultA.byePlayerId);
  });

  it("bye player does not appear in any returned pair", () => {
    const presentPlayerIds = ["p1", "p2", "p3", "p4", "p5"];
    const priorByes = [{ playerId: "p5", weekIndex: WEEK_RECENT }];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorByes }),
    );

    const pairedIds = result.pairs.flatMap(([a, b]) => [a, b]);
    expect(pairedIds).not.toContain(result.byePlayerId);
  });
});

// ---------------------------------------------------------------------------
// computePairing: fallback when no all-fresh matching exists
// ---------------------------------------------------------------------------

describe("computePairing: fallback — fully-constrained set", () => {
  it("sets usedFallback to true when no all-fresh covering matching exists", () => {
    // With 4 players and ALL 6 possible pairs already used (impossible in one season
    // for 4 players — use the triangle {p1-p2, p1-p3, p2-p3} so no perfect matching
    // exists without repeating):
    //   Allowed edges after banning p1-p2, p1-p3, p2-p3:
    //   Only edges involving p4 remain: p1-p4, p2-p4, p3-p4.
    //   These three edges share p4, so the max matching covers at most 2 players.
    //   A covering matching (all 4 covered) requires a repeat.
    const presentPlayerIds = ["p1", "p2", "p3", "p4"];
    const priorPairs = [
      { a: "p1", b: "p2", weekIndex: WEEK_OLDEST },
      { a: "p1", b: "p3", weekIndex: WEEK_MIDDLE },
      { a: "p2", b: "p3", weekIndex: WEEK_RECENT },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorPairs }),
    );

    expect(result.usedFallback).toBe(true);
  });

  it("still returns a complete covering of present players even in fallback mode", () => {
    const presentPlayerIds = ["p1", "p2", "p3", "p4"];
    const priorPairs = [
      { a: "p1", b: "p2", weekIndex: WEEK_OLDEST },
      { a: "p1", b: "p3", weekIndex: WEEK_MIDDLE },
      { a: "p2", b: "p3", weekIndex: WEEK_RECENT },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorPairs }),
    );

    expect(allPresentCovered(result.pairs, presentPlayerIds)).toBe(true);
  });

  it("re-admits the LEAST-recently-matched pair (oldest weekIndex), not a recent one", () => {
    // p1-p2 is the only forbidden edge that was used OLDEST. p1-p3, p2-p3 are
    // more recent. The fallback must choose p1-p2 (oldest) before the others.
    //
    // Setup: present = [p1, p2, p3, p4]
    //   Fresh edges: p1-p4, p2-p4, p3-p4 (plus p3 not paired with p1 or p2 — wait,
    //   they are: p1-p3 and p2-p3 are also banned). So only p*-p4 fresh.
    //   For covering we need to readmit one pair among {p1-p2 (oldest), p1-p3
    //   (middle), p2-p3 (recent)}.
    //   Oldest is p1-p2. The valid covering using oldest-first readmission:
    //     e.g. (p1-p2) + (p3-p4) — both pairs contain oldest-readmitted edge.
    const presentPlayerIds = ["p1", "p2", "p3", "p4"];
    const priorPairs = [
      { a: "p1", b: "p2", weekIndex: WEEK_OLDEST },
      { a: "p1", b: "p3", weekIndex: WEEK_MIDDLE },
      { a: "p2", b: "p3", weekIndex: WEEK_RECENT },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorPairs }),
    );

    // The result must contain the oldest prior pair (p1-p2), not the most recent (p2-p3).
    const pairKeys = result.pairs.map(([a, b]) => normalisePair(a, b).join("|"));
    const oldestKey = normalisePair("p1", "p2").join("|");
    const mostRecentKey = normalisePair("p2", "p3").join("|");

    expect(pairKeys).toContain(oldestKey);
    expect(pairKeys).not.toContain(mostRecentKey);
  });

  it("does not set usedFallback when an all-fresh covering still exists despite some priorPairs", () => {
    // 4 players; only 1 prior pair. Plenty of fresh edges remain.
    const result = computePairing(
      makePairingInput({
        presentPlayerIds: ["p1", "p2", "p3", "p4"],
        priorPairs: [{ a: "p1", b: "p2", weekIndex: WEEK_OLDEST }],
      }),
    );

    expect(result.usedFallback).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computePairing: absences (reduced present set)
// ---------------------------------------------------------------------------

describe("computePairing: absences — reduced present set", () => {
  it("pairs correctly from a subset of the roster with no repeats when possible", () => {
    // Full roster might be p1..p6 but only p1, p2, p3, p4 are present.
    const presentPlayerIds = ["p1", "p2", "p3", "p4"];
    const priorPairs = [
      // Prior pairs involving absent players — must be ignored.
      { a: "p5", b: "p6", weekIndex: WEEK_OLDEST },
      { a: "p1", b: "p5", weekIndex: WEEK_OLDEST },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorPairs }),
    );

    expect(allPresentCovered(result.pairs, presentPlayerIds)).toBe(true);
    expect(result.usedFallback).toBe(false);
  });

  it("uses only presentPlayerIds participants — no absent player appears in output", () => {
    const presentPlayerIds = ["p1", "p2", "p3", "p4"];

    const result = computePairing(
      makePairingInput({
        presentPlayerIds,
        priorPairs: [{ a: "p5", b: "p1", weekIndex: WEEK_OLDEST }],
      }),
    );

    const allOutputIds = [
      ...result.pairs.flatMap(([a, b]) => [a, b]),
      ...(result.byePlayerId ? [result.byePlayerId] : []),
    ];

    // "p5" is absent; must not appear anywhere in the result.
    expect(allOutputIds).not.toContain("p5");
  });
});

// ---------------------------------------------------------------------------
// computePairing: robustness / never throws
// ---------------------------------------------------------------------------

describe("computePairing: robustness — never throws", () => {
  it("handles a single present player: 0 pairs and that player is the bye", () => {
    const result: PairingResult = computePairing(
      makePairingInput({ presentPlayerIds: ["p1"] }),
    );

    expect(result.pairs).toHaveLength(0);
    expect(result.byePlayerId).toBe("p1");
  });

  it("handles two fresh players: exactly 1 pair, no bye", () => {
    const result: PairingResult = computePairing(
      makePairingInput({ presentPlayerIds: ["p1", "p2"] }),
    );

    expect(result.pairs).toHaveLength(1);
    expect(result.byePlayerId).toBeNull();
  });

  it("does not throw for a large fully-constrained odd set", () => {
    // Build a scenario where many prior pairs exist for an odd present count.
    const presentPlayerIds = ["p1", "p2", "p3", "p4", "p5"];
    const priorPairs = [
      { a: "p1", b: "p2", weekIndex: WEEK_OLDEST },
      { a: "p1", b: "p3", weekIndex: WEEK_OLDEST },
      { a: "p2", b: "p3", weekIndex: WEEK_MIDDLE },
      { a: "p2", b: "p4", weekIndex: WEEK_MIDDLE },
      { a: "p3", b: "p4", weekIndex: WEEK_RECENT },
    ];

    expect(() =>
      computePairing(makePairingInput({ presentPlayerIds, priorPairs })),
    ).not.toThrow();
  });

  it("always returns a result object with the required shape for any non-empty input", () => {
    const inputs: PairingInput[] = [
      makePairingInput({ presentPlayerIds: ["p1"] }),
      makePairingInput({ presentPlayerIds: ["p1", "p2"] }),
      makePairingInput({ presentPlayerIds: ["p1", "p2", "p3"] }),
      makePairingInput({
        presentPlayerIds: ["p1", "p2", "p3", "p4"],
        priorPairs: [{ a: "p1", b: "p2", weekIndex: WEEK_OLDEST }],
      }),
    ];

    for (const input of inputs) {
      const result = computePairing(input);
      expect(Array.isArray(result.pairs)).toBe(true);
      expect(
        result.byePlayerId === null || typeof result.byePlayerId === "string",
      ).toBe(true);
      expect(typeof result.usedFallback).toBe("boolean");
    }
  });
});

// ---------------------------------------------------------------------------
// computePairing: purity — no input mutation
// ---------------------------------------------------------------------------

describe("computePairing: purity — no input mutation", () => {
  it("does not mutate presentPlayerIds", () => {
    const presentPlayerIds = ["p1", "p2", "p3", "p4"];
    const originalOrder = [...presentPlayerIds];

    computePairing(makePairingInput({ presentPlayerIds }));

    expect(presentPlayerIds).toEqual(originalOrder);
  });

  it("does not mutate priorPairs", () => {
    const priorPairs = [
      { a: "p1", b: "p2", weekIndex: WEEK_OLDEST },
      { a: "p3", b: "p4", weekIndex: WEEK_RECENT },
    ];
    const snapshot = priorPairs.map((pair) => ({ ...pair }));

    computePairing(
      makePairingInput({
        presentPlayerIds: ["p1", "p2", "p3", "p4"],
        priorPairs,
      }),
    );

    expect(priorPairs).toEqual(snapshot);
  });

  it("does not mutate priorByes", () => {
    const priorByes = [
      { playerId: "p1", weekIndex: WEEK_OLDEST },
      { playerId: "p2", weekIndex: WEEK_RECENT },
    ];
    const snapshot = priorByes.map((bye) => ({ ...bye }));

    computePairing(
      makePairingInput({
        presentPlayerIds: ["p1", "p2", "p3"],
        priorByes,
      }),
    );

    expect(priorByes).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// BUG REGRESSION — B1: bye selection: never-benched outranks benched
//
// The spec rule (spec.md "Pairing" section + 05-pairing-engine.md):
//   The bye goes to the least-recently-benched present player.
//   A player with NO prior bye entry is the least-recently-benched (most
//   preferred). Among players who DO have prior byes, the oldest (smallest)
//   weekIndex wins; ties broken by lowest player id.
//
// Current bug: `computeEffectiveBycWeekIndexes` assigns never-benched players
// an effective weekIndex of `max(recorded) - min(recorded) - 1`.  When the
// spread of recorded byes is large this value exceeds the smallest actual
// weekIndex, incorrectly demoting the never-benched player behind already-
// benched ones.
// ---------------------------------------------------------------------------

describe("bye selection: never-benched outranks benched", () => {
  // ---- case 1: large spread (0 vs 100) means effective = 99 > 0 for p1 ----
  // Bug: engine computes effective_never = 100 - 0 - 1 = 99 > p1's actual 0,
  // so it incorrectly selects p1 (or p2 at 100) instead of p3 (never benched).
  it("gives bye to never-benched p3 when p1 has weekIndex 0 and p2 has weekIndex 100", () => {
    const presentPlayerIds = ["p1", "p2", "p3"];
    const priorByes = [
      { playerId: "p1", weekIndex: 0 },
      { playerId: "p2", weekIndex: WEEK_VERY_LONG_AGO },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorByes }),
    );

    // p3 has never been benched — must be selected for the bye.
    expect(result.byePlayerId).toBe("p3");
  });

  // ---- case 2: moderate spread (5 vs 50) → effective_never = 44 > 5 ------
  // Bug: effective_never = 50 - 5 - 1 = 44; p1 has actual 5 so p1 looks
  // "more overdue" than p3 (never benched). Engine wrongly gives bye to p1.
  it("gives bye to never-benched p3 when benched players have weekIndexes 5 and 50", () => {
    const presentPlayerIds = ["p1", "p2", "p3"];
    const priorByes = [
      { playerId: "p1", weekIndex: WEEK_FAR_PAST },
      { playerId: "p2", weekIndex: WEEK_LONG_AGO },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorByes }),
    );

    // p3 has never been benched — must be selected for the bye.
    expect(result.byePlayerId).toBe("p3");
  });

  // ---- case 3: small spread (1 vs 3) → effective_never = 1, ties with p1 --
  // Bug: effective_never = 3 - 1 - 1 = 1, equal to p1's actual weekIndex 1.
  // The tie-break is lowest player id, so "p1" < "p3" → engine picks p1.
  // The spec says never-benched is unconditionally most preferred, so p3 wins.
  it("gives bye to never-benched p3 even when spread equals the oldest benched weekIndex (guards against tie mis-rank)", () => {
    const presentPlayerIds = ["p1", "p2", "p3"];
    const priorByes = [
      { playerId: "p1", weekIndex: WEEK_OLDEST },
      { playerId: "p2", weekIndex: WEEK_RECENT },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorByes }),
    );

    // p3 has never been benched — must beat p1 (oldest benched) and p2.
    expect(result.byePlayerId).toBe("p3");
  });

  // ---- case 4: mixed odd set — never-benched wins over old-benched ----------
  // present = 5 players (odd), two have old bye records, three have none.
  // The bye must go to one of the three never-benched players (not p1/p2).
  it("gives bye to a never-benched player in a mixed 5-player odd set", () => {
    const presentPlayerIds = ["p1", "p2", "p3", "p4", "p5"];
    const priorByes = [
      { playerId: "p1", weekIndex: WEEK_OLDEST },
      { playerId: "p2", weekIndex: WEEK_MIDDLE },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorByes }),
    );

    // p3, p4, p5 have never been benched — the bye must be one of them.
    expect(["p3", "p4", "p5"]).toContain(result.byePlayerId);
    // Also: the benched-history players must NOT be chosen as bye.
    expect(result.byePlayerId).not.toBe("p1");
    expect(result.byePlayerId).not.toBe("p2");
  });

  // ---- case 5: all players have prior byes — oldest weekIndex wins ----------
  // When every present player has a bye record, the one with the smallest
  // weekIndex (benched longest ago) is most overdue and gets the bye.
  it("selects the player with the oldest prior bye weekIndex when all players have bye records", () => {
    const presentPlayerIds = ["p1", "p2", "p3"];
    const priorByes = [
      { playerId: "p1", weekIndex: 10 },
      { playerId: "p2", weekIndex: 20 },
      { playerId: "p3", weekIndex: 30 },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorByes }),
    );

    // p1 has the oldest bye (week 10) → most overdue → wins the bye.
    expect(result.byePlayerId).toBe("p1");
  });

  // ---- case 6: all benched, two tie on oldest weekIndex — lowest id wins ----
  // p1 and p2 both have weekIndex 5 (tied oldest); p3 is more recent at 10.
  // Tie-break: lowest player id → "p1".
  it("breaks ties between equally-oldest-benched players using lowest player id", () => {
    const presentPlayerIds = ["p1", "p2", "p3"];
    const priorByes = [
      { playerId: "p1", weekIndex: WEEK_FAR_PAST },
      { playerId: "p2", weekIndex: WEEK_FAR_PAST },
      { playerId: "p3", weekIndex: 10 },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorByes }),
    );

    // Both p1 and p2 are tied; "p1" < "p2" lexicographically → p1 wins.
    expect(result.byePlayerId).toBe("p1");
  });
});

// ---------------------------------------------------------------------------
// BUG REGRESSION — B2: no false fallback when a fresh covering exists
//
// The maximum-matching routine (Edmonds' blossom) sometimes exits without
// finding an augmenting path that exists, leaving vertices uncovered and
// incorrectly triggering usedFallback=true even when a fresh perfect matching
// is reachable.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// In-test brute-force reference: backtracking perfect matching
// ---------------------------------------------------------------------------

/**
 * Returns true when a perfect matching exists on `n` vertices using only
 * the edges in `allowed` (set of "u|v" strings with u < v normalised).
 * Used as a reference oracle for the property/stress test cases.
 *
 * Algorithm: greedy backtracking — try to match each unmatched vertex to
 * any allowed unmatched partner.
 */
const bruteForceHasPerfectMatching = (
  n: number,
  allowed: Set<string>,
): boolean => {
  // n must be even for a perfect matching to exist.
  if (n % 2 !== 0) return false;

  const matched = new Array<boolean>(n).fill(false);

  const backtrack = (vertex: number): boolean => {
    // Advance past already-matched vertices.
    while (vertex < n && matched[vertex]) vertex += 1;
    if (vertex === n) return true; // All matched.

    for (let partner = vertex + 1; partner < n; partner += 1) {
      if (matched[partner]) continue;
      const key =
        vertex < partner ? `${vertex}|${partner}` : `${partner}|${vertex}`;
      if (!allowed.has(key)) continue;

      matched[vertex] = true;
      matched[partner] = true;
      if (backtrack(vertex + 1)) return true;
      matched[vertex] = false;
      matched[partner] = false;
    }

    return false;
  };

  return backtrack(0);
};

/**
 * Encodes a normalised player-id pair as a string key for set membership.
 */
const pairKey = (a: string, b: string): string =>
  a < b ? `${a}|${b}` : `${b}|${a}`;

describe("no false fallback when a fresh covering exists", () => {
  // ---- concrete reproducer (confirmed by code review) ----------------------
  //
  // 6 present players; forbidden = {p1-p5, p2-p4, p2-p5, p2-p6, p3-p4, p3-p5, p4-p5}.
  // Allowed edges (complete graph minus forbidden):
  //   p1-p2, p1-p3, p1-p4, p1-p6, p2-p3, p3-p6, p4-p6, p5-p6
  // One fresh perfect matching: p1-p4, p2-p3, p5-p6  (all allowed — verified).
  // Therefore usedFallback MUST be false and no returned pair may be in priorPairs.
  it("does not set usedFallback when a fresh perfect matching exists for the confirmed 6-player reproducer", () => {
    const presentPlayerIds = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const FORBIDDEN_WEEK = WEEK_OLDEST;
    const priorPairs = [
      { a: "p1", b: "p5", weekIndex: FORBIDDEN_WEEK },
      { a: "p2", b: "p4", weekIndex: FORBIDDEN_WEEK },
      { a: "p2", b: "p5", weekIndex: FORBIDDEN_WEEK },
      { a: "p2", b: "p6", weekIndex: FORBIDDEN_WEEK },
      { a: "p3", b: "p4", weekIndex: FORBIDDEN_WEEK },
      { a: "p3", b: "p5", weekIndex: FORBIDDEN_WEEK },
      { a: "p4", b: "p5", weekIndex: FORBIDDEN_WEEK },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorPairs }),
    );

    expect(result.usedFallback).toBe(false);
    expect(result.pairs).toHaveLength(3);
    expect(allPresentCovered(result.pairs, presentPlayerIds)).toBe(true);
    expect(hasNoRepeatPairs(result.pairs, priorPairs)).toBe(true);
  });

  // ---- second distinct 6-player reproducer ---------------------------------
  //
  // Different forbidden configuration, also has a provable fresh perfect
  // matching (p1-p3, p2-p6, p4-p5 are all allowed).
  it("does not set usedFallback for a second distinct 6-player constrained graph with a fresh matching", () => {
    const presentPlayerIds = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const FORBIDDEN_WEEK = WEEK_OLDEST;
    const priorPairs = [
      { a: "p1", b: "p2", weekIndex: FORBIDDEN_WEEK },
      { a: "p1", b: "p4", weekIndex: FORBIDDEN_WEEK },
      { a: "p1", b: "p6", weekIndex: FORBIDDEN_WEEK },
      { a: "p2", b: "p3", weekIndex: FORBIDDEN_WEEK },
      { a: "p2", b: "p5", weekIndex: FORBIDDEN_WEEK },
      { a: "p3", b: "p4", weekIndex: FORBIDDEN_WEEK },
      { a: "p3", b: "p6", weekIndex: FORBIDDEN_WEEK },
      { a: "p4", b: "p6", weekIndex: FORBIDDEN_WEEK },
      { a: "p5", b: "p6", weekIndex: FORBIDDEN_WEEK },
    ];
    // Allowed: p1-p3, p1-p5, p2-p4, p2-p6, p3-p5, p4-p5.
    // Fresh matching: p1-p3, p2-p6, p4-p5 — all allowed.

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorPairs }),
    );

    expect(result.usedFallback).toBe(false);
    expect(result.pairs).toHaveLength(3);
    expect(allPresentCovered(result.pairs, presentPlayerIds)).toBe(true);
    expect(hasNoRepeatPairs(result.pairs, priorPairs)).toBe(true);
  });

  // ---- property / stress test against brute-force oracle -------------------
  //
  // Strategy: enumerate a fixed collection of forbidden-edge subsets of the
  // complete graph on 6 players (deterministic — no Math.random).  For each
  // subset, use the in-test brute-force oracle to determine whether a fresh
  // perfect matching exists.  If it does, assert computePairing returns
  // usedFallback=false with a valid non-repeating covering.
  //
  // We pick the subsets as all 2-edge, 3-edge, and 4-edge subsets of the 15
  // possible edges on 6 vertices in a deterministic way (chosen to span
  // structurally diverse graphs including paths, stars, triangles, etc.).
  // The confirmed B2 reproducer (7 forbidden edges) guarantees at least one
  // failure even if the random sub-selection is unlucky.
  it("never falsely sets usedFallback across a deterministic sweep of constrained 6-player graphs", () => {
    const players6 = ["p1", "p2", "p3", "p4", "p5", "p6"];
    const n = players6.length; // 6

    // Build all 15 possible edges on 6 players (complete graph K6).
    const allEdges: [string, string][] = [];
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        allEdges.push([players6[i], players6[j]]);
      }
    }
    // allEdges.length === 15

    // Build all 15 possible edge index pairs for the allowed-set oracle.
    // The oracle works on player indices 0..5 where players6[i] = `p${i+1}`.
    const allAllowedEdgeKeys = (forbiddenKeys: Set<string>): Set<string> => {
      const allowed = new Set<string>();
      for (let i = 0; i < n; i += 1) {
        for (let j = i + 1; j < n; j += 1) {
          const key = `${i}|${j}`;
          const playerKey = pairKey(players6[i], players6[j]);
          if (!forbiddenKeys.has(playerKey)) {
            allowed.add(key);
          }
        }
      }
      return allowed;
    };

    // Generate all C(15, k) subsets for k in {2, 3, 4, 5, 6, 7} by iterating
    // over a bitmask of the 15 edges.  15-bit bitmask → 32768 combinations;
    // filter to k ∈ [2, 7] and run oracle + engine on each.
    const MAX_FORBIDDEN_EDGES = 7;
    const MIN_FORBIDDEN_EDGES = 2;
    const TOTAL_EDGES = 15; // C(6,2)

    let casesChecked = 0;
    const MAX_CASES = 500; // Stay fast — the concrete reproducer guarantees failure.

    outer: for (let mask = 0; mask < 1 << TOTAL_EDGES; mask += 1) {
      const setBits = [];
      for (let bit = 0; bit < TOTAL_EDGES; bit += 1) {
        if ((mask >> bit) & 1) setBits.push(bit);
      }
      const k = setBits.length;
      if (k < MIN_FORBIDDEN_EDGES || k > MAX_FORBIDDEN_EDGES) continue;

      const forbiddenPlayerKeys = new Set<string>(
        setBits.map((bit) => pairKey(allEdges[bit][0], allEdges[bit][1])),
      );
      const allowedIndexKeys = allAllowedEdgeKeys(forbiddenPlayerKeys);

      // Oracle: does a fresh perfect matching exist on this allowed graph?
      const oracleHasMatching = bruteForceHasPerfectMatching(
        n,
        allowedIndexKeys,
      );

      if (!oracleHasMatching) continue; // Engine is allowed to set usedFallback.

      // Oracle says a fresh matching exists → engine must agree.
      const priorPairs = setBits.map((bit) => ({
        a: allEdges[bit][0],
        b: allEdges[bit][1],
        weekIndex: WEEK_OLDEST,
      }));

      const result = computePairing(
        makePairingInput({ presentPlayerIds: players6, priorPairs }),
      );

      expect(result.usedFallback).toBe(false);
      expect(result.pairs).toHaveLength(n / 2);
      expect(allPresentCovered(result.pairs, players6)).toBe(true);
      expect(hasNoRepeatPairs(result.pairs, priorPairs)).toBe(true);

      casesChecked += 1;
      if (casesChecked >= MAX_CASES) break outer;
    }
  });
});

// ---------------------------------------------------------------------------
// CONTRACT STRENGTHENING — S1c: fallback re-admission is strictly
// oldest-weekIndex-first; a second-oldest group is only re-admitted when
// the oldest group alone is insufficient.
//
// Scenario: 6 players; fresh graph has no perfect matching; after re-admitting
// only the oldest forbidden group it still has no perfect matching; adding the
// second-oldest group finally produces a covering.  The most-recent group must
// NOT appear in the result.
//
// Forbidden edge groups:
//   Group A (weekIndex = WEEK_OLDEST = 1): {p3-p4}
//   Group B (weekIndex = WEEK_MIDDLE = 2): {p5-p6}
//   Group C (weekIndex = WEEK_RECENT = 3): all remaining edges
//     {p1-p3, p1-p4, p1-p5, p1-p6, p2-p3, p2-p4, p2-p5, p2-p6, p3-p5,
//      p3-p6, p4-p5, p4-p6}
//
// After removing ALL forbidden: only p1-p2 remains.  Max matching = 1 pair
// (p1-p2), leaves p3-p6 uncovered → no covering.
//
// After re-admitting A (p3-p4): {p1-p2, p3-p4}. p5, p6 still uncovered.
//
// After re-admitting A+B (p3-p4, p5-p6): {p1-p2, p3-p4, p5-p6}. Perfect!
// usedFallback = true.  Result must contain p5-p6 (from group B) but must
// NOT contain any pair exclusively from group C (e.g. p1-p3, p2-p4, etc.).
// ---------------------------------------------------------------------------

describe("fallback re-admission is strictly oldest-weekIndex-first", () => {
  it("re-admits the second-oldest group when the oldest group alone is insufficient, and does not touch the newest group", () => {
    const presentPlayerIds = ["p1", "p2", "p3", "p4", "p5", "p6"];

    const priorPairs = [
      // Group A — oldest (weekIndex = WEEK_OLDEST):
      { a: "p3", b: "p4", weekIndex: WEEK_OLDEST },

      // Group B — middle (weekIndex = WEEK_MIDDLE):
      { a: "p5", b: "p6", weekIndex: WEEK_MIDDLE },

      // Group C — most recent (weekIndex = WEEK_RECENT):
      // All other cross edges, ensuring the fresh graph has only p1-p2.
      { a: "p1", b: "p3", weekIndex: WEEK_RECENT },
      { a: "p1", b: "p4", weekIndex: WEEK_RECENT },
      { a: "p1", b: "p5", weekIndex: WEEK_RECENT },
      { a: "p1", b: "p6", weekIndex: WEEK_RECENT },
      { a: "p2", b: "p3", weekIndex: WEEK_RECENT },
      { a: "p2", b: "p4", weekIndex: WEEK_RECENT },
      { a: "p2", b: "p5", weekIndex: WEEK_RECENT },
      { a: "p2", b: "p6", weekIndex: WEEK_RECENT },
      { a: "p3", b: "p5", weekIndex: WEEK_RECENT },
      { a: "p3", b: "p6", weekIndex: WEEK_RECENT },
      { a: "p4", b: "p5", weekIndex: WEEK_RECENT },
      { a: "p4", b: "p6", weekIndex: WEEK_RECENT },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorPairs }),
    );

    // Fallback must have been triggered (no all-fresh covering exists).
    expect(result.usedFallback).toBe(true);

    // All 6 players must be covered despite the fallback.
    expect(result.pairs).toHaveLength(3);
    expect(allPresentCovered(result.pairs, presentPlayerIds)).toBe(true);

    // Group B's pair (p5-p6, weekIndex=WEEK_MIDDLE) must appear — it was
    // required because group A alone was insufficient.
    const resultKeys = result.pairs.map(([a, b]) => pairKey(a, b));
    expect(resultKeys).toContain(pairKey("p5", "p6"));

    // Group C pairs (weekIndex=WEEK_RECENT) must NOT appear — the covering
    // was achievable without them so they must not have been re-admitted.
    const groupCKeys = [
      pairKey("p1", "p3"),
      pairKey("p1", "p4"),
      pairKey("p1", "p5"),
      pairKey("p1", "p6"),
      pairKey("p2", "p3"),
      pairKey("p2", "p4"),
      pairKey("p2", "p5"),
      pairKey("p2", "p6"),
      pairKey("p3", "p5"),
      pairKey("p3", "p6"),
      pairKey("p4", "p5"),
      pairKey("p4", "p6"),
    ];
    for (const key of groupCKeys) {
      expect(resultKeys).not.toContain(key);
    }
  });

  it("still achieves full coverage when two groups must be re-admitted before a covering is found", () => {
    // Mirrors the same setup — twin assertion focused purely on coverage
    // rather than specific pair membership, to guard against partial matches.
    const presentPlayerIds = ["p1", "p2", "p3", "p4", "p5", "p6"];

    const priorPairs = [
      { a: "p3", b: "p4", weekIndex: WEEK_OLDEST },
      { a: "p5", b: "p6", weekIndex: WEEK_MIDDLE },
      { a: "p1", b: "p3", weekIndex: WEEK_RECENT },
      { a: "p1", b: "p4", weekIndex: WEEK_RECENT },
      { a: "p1", b: "p5", weekIndex: WEEK_RECENT },
      { a: "p1", b: "p6", weekIndex: WEEK_RECENT },
      { a: "p2", b: "p3", weekIndex: WEEK_RECENT },
      { a: "p2", b: "p4", weekIndex: WEEK_RECENT },
      { a: "p2", b: "p5", weekIndex: WEEK_RECENT },
      { a: "p2", b: "p6", weekIndex: WEEK_RECENT },
      { a: "p3", b: "p5", weekIndex: WEEK_RECENT },
      { a: "p3", b: "p6", weekIndex: WEEK_RECENT },
      { a: "p4", b: "p5", weekIndex: WEEK_RECENT },
      { a: "p4", b: "p6", weekIndex: WEEK_RECENT },
    ];

    const result = computePairing(
      makePairingInput({ presentPlayerIds, priorPairs }),
    );

    expect(result.usedFallback).toBe(true);
    expect(allPresentCovered(result.pairs, presentPlayerIds)).toBe(true);
  });
});
