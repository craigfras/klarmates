/**
 * Tests for gameService.getAdminMatchups().
 *
 * CONTRACT DECISIONS (for code-writer):
 *
 *   getAdminMatchups(): Promise<AdminWeekOverview>
 *
 *   Returns a pure derivation from data — no I/O. Specifically:
 *   - weekId  = data.currentWeek.id
 *   - weekStatus = data.currentWeek.status
 *   - matchups: one AdminMatchupRow per entry in data.matchups, in order.
 *       For each matchup:
 *         playerA.id   = matchup.playerAId
 *         playerA.name = resolved from data.players (fallback: the id string)
 *         playerA.answered = matchup.answeredBy.includes(matchup.playerAId)
 *         playerB.id   = matchup.playerBId
 *         playerB.name = resolved from data.players (fallback: the id string)
 *         playerB.answered = matchup.answeredBy.includes(matchup.playerBId)
 *         status:
 *           "guessing_unlocked" when answeredBy.length >= 2 (both answered)
 *           "awaiting_one"      when answeredBy.length === 1 (exactly one answered)
 *           "awaiting_both"     when answeredBy.length === 0 (neither answered)
 *   - byePlayers: data.byePlayerIds mapped to { id, name }
 *       name resolved from data.players, fallback to the id string.
 *
 *   The method must be added to the GameService interface and to the object
 *   returned by createMockGameService(). It must not mutate data.matchups,
 *   data.players, or data.byePlayerIds.
 */

import { describe, it, expect } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type { Player, WeekStatus } from "@/lib/types";
import type { FixtureMatchup } from "@/lib/fixtures";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

const WEEK_ID = "week-admin-1";
const OTHER_WEEK_STATUS: WeekStatus = "closed";

/** ISO start date plumbed onto currentWeek so the overview can surface it. */
const WEEK_STARTS_AT = "2026-06-22T00:00:00.000Z";

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

type ServiceData = Parameters<typeof createMockGameService>[0];

const buildScenario = (overrides: Partial<ServiceData> = {}): ServiceData => ({
  players: [makePlayer("p1"), makePlayer("p2"), makePlayer("p3")],
  currentWeek: {
    id: WEEK_ID,
    status: "open" as WeekStatus,
    questions: [],
  },
  matchups: [],
  byePlayerIds: [],
  ...overrides,
});

const matchup = (
  id: string,
  playerAId: string,
  playerBId: string,
  answeredBy: string[] = [],
): FixtureMatchup => ({ id, weekId: WEEK_ID, playerAId, playerBId, answeredBy });

// ---------------------------------------------------------------------------
// weekId + weekStatus from currentWeek
// ---------------------------------------------------------------------------

describe("gameService.getAdminMatchups: week metadata", () => {
  it("returns weekId from data.currentWeek.id", async () => {
    const service = createMockGameService(
      buildScenario({
        currentWeek: { id: "week-specific-42", status: "open", questions: [] },
      }),
    );

    const overview = await service.getAdminMatchups();

    expect(overview.weekId).toBe("week-specific-42");
  });

  it("returns weekStatus from data.currentWeek.status", async () => {
    const service = createMockGameService(
      buildScenario({
        currentWeek: { id: WEEK_ID, status: OTHER_WEEK_STATUS, questions: [] },
      }),
    );

    const overview = await service.getAdminMatchups();

    expect(overview.weekStatus).toBe(OTHER_WEEK_STATUS);
  });

  it("returns startsAt from data.currentWeek.startsAt (ISO date for the caption)", async () => {
    const service = createMockGameService(
      buildScenario({
        currentWeek: {
          id: WEEK_ID,
          startsAt: WEEK_STARTS_AT,
          status: "open",
          questions: [],
        },
      }),
    );

    const overview = await service.getAdminMatchups();

    expect(overview.startsAt).toBe(WEEK_STARTS_AT);
    expect(Number.isNaN(new Date(overview.startsAt).getTime())).toBe(false);
  });

  it("returns startsAt as '' when the current week has no start date", async () => {
    const service = createMockGameService(
      buildScenario({
        currentWeek: { id: WEEK_ID, status: "open", questions: [] },
      }),
    );

    const overview = await service.getAdminMatchups();

    expect(overview.startsAt).toBe("");
  });
});

// ---------------------------------------------------------------------------
// matchup rows — ordering and name resolution
// ---------------------------------------------------------------------------

describe("gameService.getAdminMatchups: matchup rows", () => {
  it("returns one row per matchup, preserving data.matchups order", async () => {
    const service = createMockGameService(
      buildScenario({
        matchups: [
          matchup("m1", "p1", "p2"),
          matchup("m2", "p3", "p1"),
        ],
      }),
    );

    const overview = await service.getAdminMatchups();

    expect(overview.matchups).toHaveLength(2);
    expect(overview.matchups[0].matchupId).toBe("m1");
    expect(overview.matchups[1].matchupId).toBe("m2");
  });

  it("resolves playerA and playerB names from the roster", async () => {
    const service = createMockGameService(
      buildScenario({
        players: [
          makePlayer("p1", { name: "Ada Lovelace" }),
          makePlayer("p2", { name: "Linus Bytes" }),
        ],
        matchups: [matchup("m1", "p1", "p2")],
      }),
    );

    const overview = await service.getAdminMatchups();
    const [row] = overview.matchups;

    expect(row.playerA.id).toBe("p1");
    expect(row.playerA.name).toBe("Ada Lovelace");
    expect(row.playerB.id).toBe("p2");
    expect(row.playerB.name).toBe("Linus Bytes");
  });

  it("falls back to the player id as name when the player is not in the roster", async () => {
    const service = createMockGameService(
      buildScenario({
        players: [],
        matchups: [matchup("m1", "unknown-a", "unknown-b")],
      }),
    );

    const overview = await service.getAdminMatchups();
    const [row] = overview.matchups;

    expect(row.playerA.name).toBe("unknown-a");
    expect(row.playerB.name).toBe("unknown-b");
  });
});

// ---------------------------------------------------------------------------
// status matrix
// ---------------------------------------------------------------------------

describe("gameService.getAdminMatchups: status derivation", () => {
  it("returns 'awaiting_both' when neither participant has answered", async () => {
    const service = createMockGameService(
      buildScenario({
        matchups: [matchup("m1", "p1", "p2", [])],
      }),
    );

    const overview = await service.getAdminMatchups();

    expect(overview.matchups[0].status).toBe("awaiting_both");
  });

  it("returns 'awaiting_one' and correct answered flags when only playerA has answered", async () => {
    const service = createMockGameService(
      buildScenario({
        matchups: [matchup("m1", "p1", "p2", ["p1"])],
      }),
    );

    const overview = await service.getAdminMatchups();
    const [row] = overview.matchups;

    expect(row.status).toBe("awaiting_one");
    expect(row.playerA.answered).toBe(true);
    expect(row.playerB.answered).toBe(false);
  });

  it("returns 'awaiting_one' and correct answered flags when only playerB has answered", async () => {
    const service = createMockGameService(
      buildScenario({
        matchups: [matchup("m1", "p1", "p2", ["p2"])],
      }),
    );

    const overview = await service.getAdminMatchups();
    const [row] = overview.matchups;

    expect(row.status).toBe("awaiting_one");
    expect(row.playerA.answered).toBe(false);
    expect(row.playerB.answered).toBe(true);
  });

  it("returns 'guessing_unlocked' when both participants have answered", async () => {
    const service = createMockGameService(
      buildScenario({
        matchups: [matchup("m1", "p1", "p2", ["p1", "p2"])],
      }),
    );

    const overview = await service.getAdminMatchups();
    const [row] = overview.matchups;

    expect(row.status).toBe("guessing_unlocked");
    expect(row.playerA.answered).toBe(true);
    expect(row.playerB.answered).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// byePlayers
// ---------------------------------------------------------------------------

describe("gameService.getAdminMatchups: byePlayers", () => {
  it("returns an empty array when byePlayerIds is empty", async () => {
    const service = createMockGameService(
      buildScenario({ byePlayerIds: [] }),
    );

    const overview = await service.getAdminMatchups();

    expect(overview.byePlayers).toEqual([]);
  });

  it("maps a single bye player id to { id, name } using the roster", async () => {
    const service = createMockGameService(
      buildScenario({
        players: [makePlayer("p1", { name: "Grace Hopper" })],
        byePlayerIds: ["p1"],
      }),
    );

    const overview = await service.getAdminMatchups();

    expect(overview.byePlayers).toEqual([{ id: "p1", name: "Grace Hopper" }]);
  });

  it("maps multiple bye player ids in order", async () => {
    const service = createMockGameService(
      buildScenario({
        players: [
          makePlayer("p1", { name: "Grace Hopper" }),
          makePlayer("p2", { name: "Dennis Ritchie" }),
        ],
        byePlayerIds: ["p1", "p2"],
      }),
    );

    const overview = await service.getAdminMatchups();

    expect(overview.byePlayers).toHaveLength(2);
    expect(overview.byePlayers[0]).toEqual({ id: "p1", name: "Grace Hopper" });
    expect(overview.byePlayers[1]).toEqual({ id: "p2", name: "Dennis Ritchie" });
  });

  it("falls back to the id as name for a bye player not in the roster", async () => {
    const service = createMockGameService(
      buildScenario({
        players: [],
        byePlayerIds: ["ghost-player"],
      }),
    );

    const overview = await service.getAdminMatchups();

    expect(overview.byePlayers).toEqual([{ id: "ghost-player", name: "ghost-player" }]);
  });
});

// ---------------------------------------------------------------------------
// empty matchups
// ---------------------------------------------------------------------------

describe("gameService.getAdminMatchups: empty matchups", () => {
  it("returns matchups: [] without throwing when data.matchups is empty", async () => {
    const service = createMockGameService(
      buildScenario({ matchups: [] }),
    );

    await expect(service.getAdminMatchups()).resolves.toMatchObject({
      matchups: [],
    });
  });
});

// ---------------------------------------------------------------------------
// purity — no mutation of source data
// ---------------------------------------------------------------------------

describe("gameService.getAdminMatchups: purity", () => {
  it("does not mutate data.matchups", async () => {
    const originalMatchups = [matchup("m1", "p1", "p2", ["p1"])];
    const matchupsBefore = JSON.stringify(originalMatchups);

    const service = createMockGameService(
      buildScenario({ matchups: originalMatchups }),
    );

    await service.getAdminMatchups();

    expect(JSON.stringify(originalMatchups)).toBe(matchupsBefore);
  });

  it("does not mutate data.players", async () => {
    const players = [makePlayer("p1"), makePlayer("p2")];
    const playersBefore = JSON.stringify(players);

    const service = createMockGameService(
      buildScenario({
        players,
        matchups: [matchup("m1", "p1", "p2")],
      }),
    );

    await service.getAdminMatchups();

    expect(JSON.stringify(players)).toBe(playersBefore);
  });

  it("does not mutate data.byePlayerIds", async () => {
    const byePlayerIds = ["p1", "p2"];
    const byeBefore = JSON.stringify(byePlayerIds);

    const service = createMockGameService(
      buildScenario({ byePlayerIds }),
    );

    await service.getAdminMatchups();

    expect(JSON.stringify(byePlayerIds)).toBe(byeBefore);
  });
});
