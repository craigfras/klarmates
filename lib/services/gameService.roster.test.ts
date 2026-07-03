/**
 * Tests for the roster + absence methods on GameService (slice 07).
 *
 * ============================================================
 * CONTRACT DECISIONS (code-writer must match exactly)
 * ============================================================
 *
 * 1. GameServiceData shape extension — `weekAbsences`:
 *
 *      weekAbsences?: Record<string, string[]>
 *
 *    Maps a weekId to the array of player ids flagged absent for that week.
 *    When absent from the record (or the key is missing entirely) the week
 *    has no absences recorded. The field is optional on GameServiceData so
 *    existing scenarios that omit it continue to compile and behave correctly.
 *
 * 2. Present-player resolution rule (inside buildPairingForWeek and
 *    getPresentPlayers):
 *
 *    presentPlayerIds =
 *      data.presentPlayerIds                    // explicit override wins
 *      ?? (active players in data.players)      // all where active === true
 *           .filter(p => !weekAbsences[weekId]?.includes(p.id))
 *                                               // minus those flagged absent
 *
 *    Inactive players (active === false) are ALWAYS excluded regardless of
 *    absences. An absence entry for an already-inactive player has no effect.
 *
 * 3. New methods on GameService interface + createMockGameService:
 *
 *    listRoster(): Promise<Player[]>
 *      Returns data.players (ALL players, active and inactive).
 *
 *    upsertPlayer(player: Player): Promise<Player[]>
 *      If a player with player.id already exists, update its fields IN PLACE
 *      (do not splice / do not append a duplicate). Otherwise APPEND the new
 *      player. Returns the full roster (data.players) after the mutation.
 *
 *    deactivatePlayer(playerId: string): Promise<Player[]>
 *      Sets data.players[i].active = false for the matching player.
 *      Throws when no player with that id exists.
 *      Returns the full roster after the mutation.
 *
 *    setWeekAbsences(weekId: string, absentPlayerIds: string[]): Promise<void>
 *      Records data.weekAbsences[weekId] = absentPlayerIds.
 *      THROWS when data.currentWeek.id === weekId AND
 *              data.currentWeek.status === "open" OR "closed".
 *      (Absences can only be set before the week opens or while in
 *      awaiting_approval — i.e. only when status is "awaiting_approval"
 *      or the weekId doesn't match the current week at all.)
 *      Does NOT modify anything on throw.
 *
 *    getPresentPlayers(weekId: string): Promise<Player[]>
 *      Applies the present-player resolution rule above (active minus absent)
 *      and returns the resolved Player[] (not just ids).
 *      NOTE: does NOT consult data.presentPlayerIds — that override is only
 *      used by buildPairingForWeek, not by getPresentPlayers directly.
 *
 * 4. buildPairingForWeek integration change:
 *    When data.presentPlayerIds is absent, present ids =
 *      active players minus weekAbsences[weekId] (same rule as above).
 *    When data.presentPlayerIds IS set, it is used verbatim (back-compat).
 *
 * 5. setWeekAbsences guard semantics:
 *    - status "open"   → throw (week is live, no more changes)
 *    - status "closed" → throw (week is finished, no changes)
 *    - status "awaiting_approval" with same weekId → ALLOW (admin still editing)
 *    - weekId not matching currentWeek.id at all → ALLOW (future week)
 *
 * ============================================================
 */

import { describe, it, expect, vi } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type { Player, Question, WeekStatus } from "@/lib/types";
import { WEEKLY_QUESTION_COUNT, UPCOMING_WEEK_ID } from "@/lib/types";
import type { QuestionGenerator } from "@/lib/ai";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** A week id used as the "current" open week in baseline scenarios. */
const CURRENT_WEEK_ID = "week-current-2026-25";

/** A week id for a draft / upcoming week distinct from the current one. */
const DRAFT_WEEK_ID = UPCOMING_WEEK_ID;

/** A week id that exists only as a future placeholder (never currentWeek). */
const FUTURE_WEEK_ID = "week-future-2026-99";

/** Roster size for the baseline scenario. */
const BASELINE_PLAYER_COUNT = 4;

/** Expected roster size after adding one new player to the baseline. */
const BASELINE_PLUS_ONE = BASELINE_PLAYER_COUNT + 1;

/** Exact number of active non-absent players expected as present in the
 *  three-way present/absent/inactive scenario. */
const EXPECTED_PRESENT_COUNT = 2;

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

const makeQuestion = (
  id: string,
  orderIndex: number,
  text = `Question ${id}`,
): Question => ({
  id,
  orderIndex,
  text,
});

type ServiceData = Parameters<typeof createMockGameService>[0];

/**
 * Baseline scenario: a current open week with BASELINE_PLAYER_COUNT active
 * players, no draft, empty matchups/byes.
 *
 * Tests override individual fields as needed.
 */
const buildScenario = (overrides: Partial<ServiceData> = {}): ServiceData => ({
  players: [
    makePlayer("p1"),
    makePlayer("p2"),
    makePlayer("p3"),
    makePlayer("p4"),
  ],
  currentWeek: {
    id: CURRENT_WEEK_ID,
    status: "open" as WeekStatus,
    questions: [
      makeQuestion("q1", 0),
      makeQuestion("q2", 1),
      makeQuestion("q3", 2),
      makeQuestion("q4", 3),
    ],
  },
  matchups: [],
  byePlayerIds: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// Deterministic fake question generator (mirrors adminWeek tests)
// ---------------------------------------------------------------------------

/**
 * Returns a QuestionGenerator that emits "Fake question N" strings
 * deterministically, wrapped in vi.fn() so call counts are observable.
 */
const makeFakeGenerator = (): QuestionGenerator & {
  generateQuestions: ReturnType<typeof vi.fn>;
} => {
  const FAKE_POOL = Array.from(
    { length: 20 },
    (_, i) => `Fake question ${i}`,
  );
  return {
    generateQuestions: vi.fn(async (count: number): Promise<string[]> =>
      FAKE_POOL.slice(0, count),
    ),
  };
};

// ---------------------------------------------------------------------------
// listRoster
// ---------------------------------------------------------------------------

describe("gameService.listRoster: interface", () => {
  it("exposes listRoster on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof (service as any).listRoster).toBe("function");
  });
});

describe("gameService.listRoster: returns all players including inactive", () => {
  it("returns exactly data.players.length entries when all are active", async () => {
    const service = createMockGameService(buildScenario());

    const roster = await (service as any).listRoster();

    expect(roster).toHaveLength(BASELINE_PLAYER_COUNT);
  });

  it("includes an inactive player in the returned roster", async () => {
    const data = buildScenario({
      players: [
        makePlayer("p1"),
        makePlayer("p2"),
        makePlayer("p3"),
        makePlayer("p4", { active: false }),
      ],
    });
    const service = createMockGameService(data);

    const roster = await (service as any).listRoster();

    expect(roster).toHaveLength(BASELINE_PLAYER_COUNT);
  });

  it("returned roster ids match data.players ids exactly", async () => {
    const data = buildScenario({
      players: [
        makePlayer("p1"),
        makePlayer("p2"),
        makePlayer("p3", { active: false }),
        makePlayer("p4"),
      ],
    });
    const service = createMockGameService(data);

    const roster = await (service as any).listRoster();
    const returnedIds = new Set(roster.map((p: Player) => p.id));

    expect(returnedIds).toEqual(new Set(["p1", "p2", "p3", "p4"]));
  });

  it("inactive player appears with active===false in the returned list", async () => {
    const data = buildScenario({
      players: [
        makePlayer("p1"),
        makePlayer("p2"),
        makePlayer("p3"),
        makePlayer("p4", { active: false }),
      ],
    });
    const service = createMockGameService(data);

    const roster = await (service as any).listRoster();
    const inactiveEntry = roster.find((p: Player) => p.id === "p4");

    expect(inactiveEntry).toBeDefined();
    expect(inactiveEntry!.active).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// upsertPlayer — add (new id)
// ---------------------------------------------------------------------------

describe("gameService.upsertPlayer: interface", () => {
  it("exposes upsertPlayer on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof (service as any).upsertPlayer).toBe("function");
  });
});

describe("gameService.upsertPlayer: add — brand-new player", () => {
  it("returns a roster of length BASELINE_PLUS_ONE after adding a new player", async () => {
    const service = createMockGameService(buildScenario());
    const newPlayer = makePlayer("p-new");

    const roster = await (service as any).upsertPlayer(newPlayer);

    expect(roster).toHaveLength(BASELINE_PLUS_ONE);
  });

  it("returned roster contains the new player's id", async () => {
    const service = createMockGameService(buildScenario());
    const newPlayer = makePlayer("p-new");

    const roster = await (service as any).upsertPlayer(newPlayer);
    const returnedIds = roster.map((p: Player) => p.id);

    expect(returnedIds).toContain("p-new");
  });

  it("listRoster reflects the newly added player", async () => {
    const service = createMockGameService(buildScenario());
    const newPlayer = makePlayer("p-new");

    await (service as any).upsertPlayer(newPlayer);
    const roster = await (service as any).listRoster();

    const returnedIds = roster.map((p: Player) => p.id);
    expect(returnedIds).toContain("p-new");
  });

  it("new player's fields in the roster match what was passed in", async () => {
    const service = createMockGameService(buildScenario());
    const newPlayer: Player = {
      id: "p-new",
      name: "New Person",
      email: "new@example.com",
      slackUserId: "U_NEW",
      isAdmin: true,
      active: true,
    };

    const roster = await (service as any).upsertPlayer(newPlayer);
    const entry = roster.find((p: Player) => p.id === "p-new");

    expect(entry).toMatchObject(newPlayer);
  });
});

// ---------------------------------------------------------------------------
// upsertPlayer — edit (existing id)
// ---------------------------------------------------------------------------

describe("gameService.upsertPlayer: edit — existing player", () => {
  it("does NOT increase the roster length when updating an existing player", async () => {
    const service = createMockGameService(buildScenario());
    const updated = makePlayer("p2", {
      name: "Updated Name",
      email: "updated@example.com",
    });

    const roster = await (service as any).upsertPlayer(updated);

    expect(roster).toHaveLength(BASELINE_PLAYER_COUNT);
  });

  it("updates the matching player's name field", async () => {
    const service = createMockGameService(buildScenario());
    const updated = makePlayer("p2", { name: "Updated Name" });

    const roster = await (service as any).upsertPlayer(updated);
    const entry = roster.find((p: Player) => p.id === "p2");

    expect(entry!.name).toBe("Updated Name");
  });

  it("updates the matching player's email field", async () => {
    const service = createMockGameService(buildScenario());
    const updated = makePlayer("p2", { email: "newemail@example.com" });

    const roster = await (service as any).upsertPlayer(updated);
    const entry = roster.find((p: Player) => p.id === "p2");

    expect(entry!.email).toBe("newemail@example.com");
  });

  it("updates the matching player's slackUserId field", async () => {
    const service = createMockGameService(buildScenario());
    const updated = makePlayer("p2", { slackUserId: "U_EDITED" });

    const roster = await (service as any).upsertPlayer(updated);
    const entry = roster.find((p: Player) => p.id === "p2");

    expect(entry!.slackUserId).toBe("U_EDITED");
  });

  it("updates the matching player's isAdmin field", async () => {
    const service = createMockGameService(buildScenario());
    const updated = makePlayer("p2", { isAdmin: true });

    const roster = await (service as any).upsertPlayer(updated);
    const entry = roster.find((p: Player) => p.id === "p2");

    expect(entry!.isAdmin).toBe(true);
  });

  it("updates the matching player's active field", async () => {
    const service = createMockGameService(buildScenario());
    const updated = makePlayer("p2", { active: false });

    const roster = await (service as any).upsertPlayer(updated);
    const entry = roster.find((p: Player) => p.id === "p2");

    expect(entry!.active).toBe(false);
  });

  it("leaves all OTHER players unchanged after an edit", async () => {
    const data = buildScenario();
    const originalOthers = data.players
      .filter((p) => p.id !== "p2")
      .map((p) => ({ ...p }));
    const service = createMockGameService(data);

    const updated = makePlayer("p2", { name: "Updated" });
    const roster = await (service as any).upsertPlayer(updated);

    const others = roster.filter((p: Player) => p.id !== "p2");
    expect(others).toEqual(originalOthers);
  });
});

// ---------------------------------------------------------------------------
// deactivatePlayer
// ---------------------------------------------------------------------------

describe("gameService.deactivatePlayer: interface", () => {
  it("exposes deactivatePlayer on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof (service as any).deactivatePlayer).toBe("function");
  });
});

describe("gameService.deactivatePlayer: happy path", () => {
  it("sets active===false for the target player", async () => {
    const service = createMockGameService(buildScenario());

    const roster = await (service as any).deactivatePlayer("p3");
    const entry = roster.find((p: Player) => p.id === "p3");

    expect(entry!.active).toBe(false);
  });

  it("does NOT change the roster length", async () => {
    const service = createMockGameService(buildScenario());

    const roster = await (service as any).deactivatePlayer("p3");

    expect(roster).toHaveLength(BASELINE_PLAYER_COUNT);
  });

  it("leaves all OTHER players unchanged after deactivation", async () => {
    const data = buildScenario();
    const originalOthers = data.players
      .filter((p) => p.id !== "p3")
      .map((p) => ({ ...p }));
    const service = createMockGameService(data);

    const roster = await (service as any).deactivatePlayer("p3");
    const others = roster.filter((p: Player) => p.id !== "p3");

    expect(others).toEqual(originalOthers);
  });

  it("listRoster reflects the deactivated player afterwards", async () => {
    const service = createMockGameService(buildScenario());

    await (service as any).deactivatePlayer("p3");
    const roster = await (service as any).listRoster();
    const entry = roster.find((p: Player) => p.id === "p3");

    expect(entry!.active).toBe(false);
  });
});

describe("gameService.deactivatePlayer: error case — unknown id", () => {
  it("rejects when the player id does not exist in the roster", async () => {
    const service = createMockGameService(buildScenario());

    await expect(
      (service as any).deactivatePlayer("p-does-not-exist"),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// setWeekAbsences — happy path
// ---------------------------------------------------------------------------

describe("gameService.setWeekAbsences: interface", () => {
  it("exposes setWeekAbsences on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof (service as any).setWeekAbsences).toBe("function");
  });
});

describe("gameService.setWeekAbsences: happy path — future / awaiting week", () => {
  it("resolves without throwing for a weekId that is not the current open week", async () => {
    const service = createMockGameService(buildScenario());

    await expect(
      (service as any).setWeekAbsences(FUTURE_WEEK_ID, ["p1"]),
    ).resolves.toBeUndefined();
  });

  it("resolves without throwing when currentWeek status is awaiting_approval", async () => {
    const data = buildScenario({
      currentWeek: {
        id: DRAFT_WEEK_ID,
        status: "awaiting_approval" as WeekStatus,
        questions: [],
      },
    });
    const service = createMockGameService(data);

    await expect(
      (service as any).setWeekAbsences(DRAFT_WEEK_ID, ["p2"]),
    ).resolves.toBeUndefined();
  });

  it("getPresentPlayers reflects the recorded absences for a future week", async () => {
    const service = createMockGameService(buildScenario());

    await (service as any).setWeekAbsences(FUTURE_WEEK_ID, ["p1", "p2"]);
    const present = await (service as any).getPresentPlayers(FUTURE_WEEK_ID);
    const presentIds = present.map((p: Player) => p.id);

    expect(presentIds).not.toContain("p1");
    expect(presentIds).not.toContain("p2");
  });

  it("getPresentPlayers for a different weekId is unaffected by absences on another week", async () => {
    const service = createMockGameService(buildScenario());

    await (service as any).setWeekAbsences(FUTURE_WEEK_ID, ["p1", "p2"]);
    const present = await (service as any).getPresentPlayers("week-other");
    const presentIds = present.map((p: Player) => p.id);

    // week-other has no absences; all active players present
    expect(presentIds).toContain("p1");
    expect(presentIds).toContain("p2");
  });
});

// ---------------------------------------------------------------------------
// setWeekAbsences — guard: reject when week is open or closed
// ---------------------------------------------------------------------------

describe("gameService.setWeekAbsences: guard — rejects for open current week", () => {
  it("rejects when the weekId is the current open week", async () => {
    // Baseline has currentWeek open with CURRENT_WEEK_ID
    const service = createMockGameService(buildScenario());

    await expect(
      (service as any).setWeekAbsences(CURRENT_WEEK_ID, ["p1"]),
    ).rejects.toThrow();
  });

  it("does NOT record absences when the guard rejects (no side effects)", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    try {
      await (service as any).setWeekAbsences(CURRENT_WEEK_ID, ["p1"]);
    } catch {
      // expected to throw
    }

    // weekAbsences must not have been populated for the guarded weekId
    expect((data as any).weekAbsences?.[CURRENT_WEEK_ID]).toBeUndefined();
  });
});

describe("gameService.setWeekAbsences: guard — rejects for closed current week", () => {
  it("rejects when the weekId is the current closed week", async () => {
    const data = buildScenario({
      currentWeek: {
        id: CURRENT_WEEK_ID,
        status: "closed" as WeekStatus,
        questions: [],
      },
    });
    const service = createMockGameService(data);

    await expect(
      (service as any).setWeekAbsences(CURRENT_WEEK_ID, ["p1"]),
    ).rejects.toThrow();
  });
});

describe("gameService.setWeekAbsences: guard — allows awaiting_approval and future weekId", () => {
  it("allows setWeekAbsences when currentWeek status is awaiting_approval with same weekId", async () => {
    const data = buildScenario({
      currentWeek: {
        id: DRAFT_WEEK_ID,
        status: "awaiting_approval" as WeekStatus,
        questions: [],
      },
    });
    const service = createMockGameService(data);

    await expect(
      (service as any).setWeekAbsences(DRAFT_WEEK_ID, ["p3"]),
    ).resolves.toBeUndefined();
  });

  it("allows setWeekAbsences for a weekId completely different from currentWeek", async () => {
    // currentWeek is open with CURRENT_WEEK_ID — setting absences on FUTURE_WEEK_ID is fine
    const service = createMockGameService(buildScenario());

    await expect(
      (service as any).setWeekAbsences(FUTURE_WEEK_ID, ["p4"]),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getPresentPlayers
// ---------------------------------------------------------------------------

describe("gameService.getPresentPlayers: interface", () => {
  it("exposes getPresentPlayers on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof (service as any).getPresentPlayers).toBe("function");
  });
});

describe("gameService.getPresentPlayers: excludes inactive and absent players", () => {
  /**
   * Scenario:
   *   p1 — active, NOT absent → present
   *   p2 — active, NOT absent → present
   *   p3 — active, absent     → excluded (absent flag)
   *   p4 — inactive           → excluded (inactive)
   */
  const buildThreeWayScenario = () =>
    buildScenario({
      players: [
        makePlayer("p1"),
        makePlayer("p2"),
        makePlayer("p3"),
        makePlayer("p4", { active: false }),
      ],
      weekAbsences: {
        [FUTURE_WEEK_ID]: ["p3"],
      },
    } as Partial<ServiceData>);

  it(`returns exactly ${EXPECTED_PRESENT_COUNT} present players`, async () => {
    const service = createMockGameService(buildThreeWayScenario());

    const present = await (service as any).getPresentPlayers(FUTURE_WEEK_ID);

    expect(present).toHaveLength(EXPECTED_PRESENT_COUNT);
  });

  it("includes active non-absent players (p1, p2)", async () => {
    const service = createMockGameService(buildThreeWayScenario());

    const present = await (service as any).getPresentPlayers(FUTURE_WEEK_ID);
    const ids = present.map((p: Player) => p.id);

    expect(ids).toContain("p1");
    expect(ids).toContain("p2");
  });

  it("excludes the absent-but-active player (p3)", async () => {
    const service = createMockGameService(buildThreeWayScenario());

    const present = await (service as any).getPresentPlayers(FUTURE_WEEK_ID);
    const ids = present.map((p: Player) => p.id);

    expect(ids).not.toContain("p3");
  });

  it("excludes the inactive player (p4) regardless of absences", async () => {
    const service = createMockGameService(buildThreeWayScenario());

    const present = await (service as any).getPresentPlayers(FUTURE_WEEK_ID);
    const ids = present.map((p: Player) => p.id);

    expect(ids).not.toContain("p4");
  });

  it("returns Player objects (not just ids) for the present players", async () => {
    const service = createMockGameService(buildThreeWayScenario());

    const present = await (service as any).getPresentPlayers(FUTURE_WEEK_ID);

    for (const player of present) {
      expect(typeof player.id).toBe("string");
      expect(typeof player.name).toBe("string");
      expect(typeof player.email).toBe("string");
      expect(typeof player.isAdmin).toBe("boolean");
      expect(typeof player.active).toBe("boolean");
    }
  });

  it("returns all active players when there are no absences for that week", async () => {
    const data = buildScenario({
      players: [
        makePlayer("p1"),
        makePlayer("p2"),
        makePlayer("p3"),
        makePlayer("p4", { active: false }),
      ],
    });
    const service = createMockGameService(data);

    // No weekAbsences set; only inactive p4 is excluded.
    const present = await (service as any).getPresentPlayers(FUTURE_WEEK_ID);
    const ids = present.map((p: Player) => p.id);

    expect(ids).toContain("p1");
    expect(ids).toContain("p2");
    expect(ids).toContain("p3");
    expect(ids).not.toContain("p4");
  });
});

// ---------------------------------------------------------------------------
// pairing integration — absences drive pairing when presentPlayerIds absent
// ---------------------------------------------------------------------------

describe("gameService pairing integration: absences exclude player from pairing", () => {
  /**
   * Scenario (NO data.presentPlayerIds):
   *   Active roster: p1, p2, p3, p4, p5
   *   p5 flagged absent via setWeekAbsences(DRAFT_WEEK_ID, ["p5"])
   *   After approveWeek(DRAFT_WEEK_ID):
   *     Present set → p1, p2, p3, p4 (even count → 2 matchups, no bye)
   *     p5 must appear in neither matchups nor byePlayerIds.
   */

  const buildAbsenceDrivenScenario = (): ServiceData =>
    buildScenario({
      players: [
        makePlayer("p1"),
        makePlayer("p2"),
        makePlayer("p3"),
        makePlayer("p4"),
        makePlayer("p5"),
      ],
      // NO presentPlayerIds — absence resolution must kick in
      currentWeek: {
        id: CURRENT_WEEK_ID,
        status: "open" as WeekStatus,
        questions: [],
      },
    });

  /** Collect all player ids referenced in matchups (both sides). */
  const allMatchupIds = (matchups: { playerAId: string; playerBId: string }[]) =>
    matchups.flatMap((m) => [m.playerAId, m.playerBId]);

  it("absent player does not appear as playerAId or playerBId in any matchup", async () => {
    const gen = makeFakeGenerator();
    const data = buildAbsenceDrivenScenario();
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await (service as any).setWeekAbsences(DRAFT_WEEK_ID, ["p5"]);
    await service.approveWeek(DRAFT_WEEK_ID);

    const participants = allMatchupIds(data.matchups);
    expect(participants).not.toContain("p5");
  });

  it("absent player does not appear in byePlayerIds", async () => {
    const gen = makeFakeGenerator();
    const data = buildAbsenceDrivenScenario();
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await (service as any).setWeekAbsences(DRAFT_WEEK_ID, ["p5"]);
    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.byePlayerIds).not.toContain("p5");
  });

  it("all four present players (p1–p4) are covered — appear in matchups or byePlayerIds", async () => {
    const gen = makeFakeGenerator();
    const data = buildAbsenceDrivenScenario();
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await (service as any).setWeekAbsences(DRAFT_WEEK_ID, ["p5"]);
    await service.approveWeek(DRAFT_WEEK_ID);

    const covered = new Set([
      ...allMatchupIds(data.matchups),
      ...data.byePlayerIds,
    ]);

    expect(covered.has("p1")).toBe(true);
    expect(covered.has("p2")).toBe(true);
    expect(covered.has("p3")).toBe(true);
    expect(covered.has("p4")).toBe(true);
  });

  it("produces exactly 2 matchups when 4 active-non-absent players remain (even count)", async () => {
    const EVEN_PRESENT_COUNT = 4;
    const EXPECTED_MATCHUP_COUNT = EVEN_PRESENT_COUNT / 2;

    const gen = makeFakeGenerator();
    const data = buildAbsenceDrivenScenario();
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await (service as any).setWeekAbsences(DRAFT_WEEK_ID, ["p5"]);
    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.matchups).toHaveLength(EXPECTED_MATCHUP_COUNT);
  });

  it("leaves byePlayerIds empty when the remaining present count is even", async () => {
    const gen = makeFakeGenerator();
    const data = buildAbsenceDrivenScenario();
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await (service as any).setWeekAbsences(DRAFT_WEEK_ID, ["p5"]);
    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.byePlayerIds).toHaveLength(0);
  });

  it("inactive player is also excluded from pairing independent of absences", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [
        makePlayer("p1"),
        makePlayer("p2"),
        makePlayer("p3"),
        makePlayer("p4"),
        makePlayer("p5", { active: false }), // inactive — always excluded
      ],
      currentWeek: {
        id: CURRENT_WEEK_ID,
        status: "open" as WeekStatus,
        questions: [],
      },
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    // No explicit absence for p5; it's excluded purely by active===false
    await service.approveWeek(DRAFT_WEEK_ID);

    const participants = allMatchupIds(data.matchups);
    expect(participants).not.toContain("p5");
    expect(data.byePlayerIds).not.toContain("p5");
  });
});

// ---------------------------------------------------------------------------
// pairing back-compat — explicit presentPlayerIds override wins over absences
// ---------------------------------------------------------------------------

describe("gameService pairing back-compat: explicit presentPlayerIds overrides absences", () => {
  /**
   * When data.presentPlayerIds is set, buildPairingForWeek uses it verbatim.
   * Even if p3 is flagged absent in weekAbsences, it must still be paired
   * because the explicit override lists it as present.
   */
  it("pairs over exactly the explicit presentPlayerIds set, ignoring absences", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [
        makePlayer("p1"),
        makePlayer("p2"),
        makePlayer("p3"),
        makePlayer("p4"),
      ],
      // Explicit override lists all four
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
      weekAbsences: {
        [DRAFT_WEEK_ID]: ["p3"], // p3 absent — but override should win
      },
    } as Partial<ServiceData>);
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    const participants = new Set(
      data.matchups.flatMap((m) => [m.playerAId, m.playerBId]),
    );
    // p3 must appear because the override lists them despite the absence entry
    expect(participants.has("p3")).toBe(true);
  });

  it("produces matchups covering the exact override set (not the active-minus-absent set)", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [
        makePlayer("p1"),
        makePlayer("p2"),
        makePlayer("p3"),
        makePlayer("p4"),
      ],
      // Only p1 and p2 in override — p3 and p4 are excluded despite being active
      presentPlayerIds: ["p1", "p2"],
      weekAbsences: {
        [DRAFT_WEEK_ID]: ["p3"],
      },
    } as Partial<ServiceData>);
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    const participants = new Set(
      data.matchups.flatMap((m) => [m.playerAId, m.playerBId]),
    );
    expect(participants).toEqual(new Set(["p1", "p2"]));
    // p4 is NOT in the override even though it is active and not absent
    expect(participants.has("p4")).toBe(false);
  });
});
