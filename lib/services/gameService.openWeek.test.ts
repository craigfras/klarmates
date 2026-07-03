/**
 * Tests for gameService.openWeek(weekId).
 *
 * CONTRACT DECISION — GameServiceData extensions for pairing:
 *
 *   Two optional fields are added to GameServiceData:
 *
 *   presentPlayerIds?: string[]
 *     The ids of players who are present for the current week. When absent,
 *     the service treats all players as present. openWeek() uses this list
 *     (not the full `players` array) as the `presentPlayerIds` input to
 *     computePairing().
 *
 *   pairingHistory?: {
 *     priorPairs: { a: string; b: string; weekIndex: number }[];
 *     priorByes:  { playerId: string; weekIndex: number }[];
 *   }
 *     The season's prior pairing history forwarded verbatim to computePairing()
 *     as `priorPairs` and `priorByes`. Defaults to empty arrays when absent.
 *
 * These are the minimal additions needed without changing the existing fields.
 * Matchups and byePlayerIds are WRITTEN by openWeek(), so they start empty
 * in the scenario and are populated after the call.
 *
 * Matchup ids produced by openWeek() follow the pattern:
 *   `matchup-${weekId}-${playerAId}-${playerBId}`
 * where playerAId and playerBId appear in the order returned by computePairing().
 */

import { describe, it, expect } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type { Player, Question, WeekStatus } from "@/lib/types";
import type { FixtureMatchup } from "@/lib/fixtures";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

const WEEK_ID = "week-open-1";
const OTHER_WEEK_ID = "week-other";

/** weekIndex values used to set up prior pairing history. */
const WEEK_PRIOR_OLDEST = 1;
const WEEK_PRIOR_RECENT = 2;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const makePlayer = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: `Player ${id}`,
  email: `${id}@example.com`,
  isAdmin: false,
  active: true,
  ...overrides,
});

const makeQuestion = (id: string, orderIndex: number): Question => ({
  id,
  orderIndex,
  text: `Question ${id}`,
});

type ServiceData = Parameters<typeof createMockGameService>[0];

/**
 * Baseline scenario: a week in the `open` status (required for openWeek to run)
 * with an empty matchup list and empty byePlayerIds. Tests override from here.
 */
const buildScenario = (overrides: Partial<ServiceData> = {}): ServiceData => ({
  players: [
    makePlayer("p1"),
    makePlayer("p2"),
    makePlayer("p3"),
    makePlayer("p4"),
  ],
  currentWeek: {
    id: WEEK_ID,
    status: "open" as WeekStatus,
    questions: [makeQuestion("q1", 0), makeQuestion("q2", 1)],
  },
  matchups: [],
  byePlayerIds: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Helper: collect all participant ids from matchups
// ---------------------------------------------------------------------------

const matchupParticipants = (matchups: FixtureMatchup[]): string[] =>
  matchups.flatMap((m) => [m.playerAId, m.playerBId]);

// ---------------------------------------------------------------------------
// interface presence
// ---------------------------------------------------------------------------

describe("gameService.openWeek: interface", () => {
  it("exposes openWeek on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof service.openWeek).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// rejection: wrong week
// ---------------------------------------------------------------------------

describe("gameService.openWeek: week guard", () => {
  it("rejects when weekId does not match the current week id", async () => {
    const service = createMockGameService(buildScenario());

    await expect(service.openWeek(OTHER_WEEK_ID)).rejects.toThrow();
  });

  it("resolves without throwing when weekId matches the current week", async () => {
    const service = createMockGameService(
      buildScenario({ presentPlayerIds: ["p1", "p2"] }),
    );

    await expect(service.openWeek(WEEK_ID)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// even present count — all players paired, no bye
// ---------------------------------------------------------------------------

describe("gameService.openWeek: even present count", () => {
  it("creates matchups that cover all present players when count is even", async () => {
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
    });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    const participants = matchupParticipants(data.matchups);
    expect(participants).toHaveLength(4);
    expect(new Set(participants)).toEqual(new Set(["p1", "p2", "p3", "p4"]));
  });

  it("leaves byePlayerIds empty for an even present count", async () => {
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
    });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    expect(data.byePlayerIds).toHaveLength(0);
  });

  it("creates exactly N/2 matchups for N even present players", async () => {
    const PRESENT_COUNT = 4;
    const EXPECTED_MATCHUP_COUNT = PRESENT_COUNT / 2;
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
    });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    expect(data.matchups).toHaveLength(EXPECTED_MATCHUP_COUNT);
  });

  it("creates matchups with the correct weekId, distinct playerIds, and empty answeredBy", async () => {
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2"],
    });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    expect(data.matchups).toHaveLength(1);
    const [m] = data.matchups;
    expect(m.weekId).toBe(WEEK_ID);
    expect(m.playerAId).not.toBe(m.playerBId);
    expect(m.answeredBy).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// odd present count — exactly one bye
// ---------------------------------------------------------------------------

describe("gameService.openWeek: odd present count", () => {
  it("records exactly one byePlayerId for an odd present count", async () => {
    const data = buildScenario({
      players: [
        makePlayer("p1"),
        makePlayer("p2"),
        makePlayer("p3"),
        makePlayer("p4"),
        makePlayer("p5"),
      ],
      presentPlayerIds: ["p1", "p2", "p3", "p4", "p5"],
    });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    expect(data.byePlayerIds).toHaveLength(1);
  });

  it("bye player does NOT appear as a participant in any matchup", async () => {
    const data = buildScenario({
      players: [
        makePlayer("p1"),
        makePlayer("p2"),
        makePlayer("p3"),
        makePlayer("p4"),
        makePlayer("p5"),
      ],
      presentPlayerIds: ["p1", "p2", "p3", "p4", "p5"],
    });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    const [byeId] = data.byePlayerIds;
    const participants = matchupParticipants(data.matchups);
    expect(participants).not.toContain(byeId);
  });

  it("pairs all non-bye present players in (N-1)/2 matchups", async () => {
    const PRESENT_COUNT = 5;
    const EXPECTED_MATCHUP_COUNT = (PRESENT_COUNT - 1) / 2;
    const data = buildScenario({
      players: [
        makePlayer("p1"),
        makePlayer("p2"),
        makePlayer("p3"),
        makePlayer("p4"),
        makePlayer("p5"),
      ],
      presentPlayerIds: ["p1", "p2", "p3", "p4", "p5"],
    });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    expect(data.matchups).toHaveLength(EXPECTED_MATCHUP_COUNT);
  });

  it("assigns the bye to the player with NO prior bye when others have bye records", async () => {
    // p1 and p2 had prior byes; p3 has never had one.
    // With presentPlayerIds = [p1, p2, p3], the bye must go to p3.
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3"],
      pairingHistory: {
        priorPairs: [],
        priorByes: [
          { playerId: "p1", weekIndex: WEEK_PRIOR_RECENT },
          { playerId: "p2", weekIndex: WEEK_PRIOR_OLDEST },
        ],
      },
    });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    expect(data.byePlayerIds).toEqual(["p3"]);
  });
});

// ---------------------------------------------------------------------------
// no created matchup pair repeats a prior pair when fresh matching exists
// ---------------------------------------------------------------------------

describe("gameService.openWeek: no repeat pairs when fresh matching available", () => {
  it("does not reproduce a prior pair when an all-fresh covering matching exists", async () => {
    // p1-p2 already paired. Fresh cross-pairs (p1-p3, p1-p4, p2-p3, p2-p4, p3-p4)
    // are available. The engine must choose from those.
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
      pairingHistory: {
        priorPairs: [{ a: "p1", b: "p2", weekIndex: WEEK_PRIOR_OLDEST }],
        priorByes: [],
      },
    });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    // Neither matchup should be the prior (p1, p2) pair.
    const reproduced = data.matchups.some(
      (m) =>
        (m.playerAId === "p1" && m.playerBId === "p2") ||
        (m.playerAId === "p2" && m.playerBId === "p1"),
    );
    expect(reproduced).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchup invariants
// ---------------------------------------------------------------------------

describe("gameService.openWeek: matchup structure", () => {
  it("each matchup has a non-empty string id", async () => {
    const data = buildScenario({ presentPlayerIds: ["p1", "p2", "p3", "p4"] });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    for (const m of data.matchups) {
      expect(typeof m.id).toBe("string");
      expect(m.id.length).toBeGreaterThan(0);
    }
  });

  it("matchup ids are unique across all created matchups", async () => {
    const data = buildScenario({ presentPlayerIds: ["p1", "p2", "p3", "p4"] });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    const ids = data.matchups.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("each matchup has two distinct playerIds", async () => {
    const data = buildScenario({ presentPlayerIds: ["p1", "p2", "p3", "p4"] });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    for (const m of data.matchups) {
      expect(m.playerAId).not.toBe(m.playerBId);
    }
  });

  it("each matchup starts with an empty answeredBy array", async () => {
    const data = buildScenario({ presentPlayerIds: ["p1", "p2", "p3", "p4"] });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    for (const m of data.matchups) {
      expect(m.answeredBy).toEqual([]);
    }
  });

  it("no player appears in more than one matchup (no duplicates across pairs)", async () => {
    const data = buildScenario({ presentPlayerIds: ["p1", "p2", "p3", "p4"] });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    const participants = matchupParticipants(data.matchups);
    expect(participants.length).toBe(new Set(participants).size);
  });
});

// ---------------------------------------------------------------------------
// getMyWeek reflects openWeek outcome (integration with existing read path)
// ---------------------------------------------------------------------------

describe("gameService.openWeek: reflected in getMyWeek", () => {
  it("getMyWeek returns isBye===true for the bye player after openWeek", async () => {
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3"],
      pairingHistory: {
        priorPairs: [],
        priorByes: [{ playerId: "p1", weekIndex: WEEK_PRIOR_RECENT }],
      },
    });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    // p3 has no prior bye — should be the bye player.
    const byeId = data.byePlayerIds[0];
    const view = await service.getMyWeek(byeId);
    expect(view.isBye).toBe(true);
  });

  it("getMyWeek returns a non-null opponent for a paired player after openWeek", async () => {
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2"],
    });
    const service = createMockGameService(data);

    await service.openWeek(WEEK_ID);

    const view = await service.getMyWeek("p1");
    expect(view.isBye).toBe(false);
    expect(view.opponent).not.toBeNull();
  });
});
