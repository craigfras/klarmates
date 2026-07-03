import { describe, it, expect } from "vitest";
import {
  createMockGameService,
  mockGameService,
  type GameService,
} from "@/lib/services/gameService";
import type { FixtureMatchup } from "@/lib/fixtures";
import type { Player, Question, WeekStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test helpers / builders
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

const WEEK_ID = "week-1";

type ServiceData = Parameters<typeof createMockGameService>[0];

const buildScenario = (overrides: Partial<ServiceData> = {}): ServiceData => ({
  players: [makePlayer("a"), makePlayer("b"), makePlayer("c")],
  currentWeek: {
    id: WEEK_ID,
    status: "open" as WeekStatus,
    questions: [makeQuestion("q1", 0), makeQuestion("q2", 1)],
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
// week metadata
// ---------------------------------------------------------------------------

describe("gameService.getMyWeek: week metadata", () => {
  it("returns a resolved Promise with weekId and status from currentWeek", async () => {
    const service = createMockGameService(
      buildScenario({
        currentWeek: {
          id: "week-99",
          status: "open",
          questions: [makeQuestion("q1", 0)],
        },
        matchups: [matchup("m1", "a", "b")],
      }),
    );

    const view = await service.getMyWeek("a");

    expect(view.weekId).toBe("week-99");
    expect(view.status).toBe("open");
  });
});

// ---------------------------------------------------------------------------
// questions ordering
// ---------------------------------------------------------------------------

describe("gameService.getMyWeek: questions", () => {
  it("returns questions sorted ascending by orderIndex", async () => {
    const service = createMockGameService(
      buildScenario({
        currentWeek: {
          id: WEEK_ID,
          status: "open",
          questions: [
            makeQuestion("q3", 2),
            makeQuestion("q1", 0),
            makeQuestion("q4", 3),
            makeQuestion("q2", 1),
          ],
        },
        matchups: [matchup("m1", "a", "b")],
      }),
    );

    const view = await service.getMyWeek("a");

    expect(view.questions.map((q) => q.orderIndex)).toEqual([0, 1, 2, 3]);
    expect(view.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3", "q4"]);
  });
});

// ---------------------------------------------------------------------------
// bye handling
// ---------------------------------------------------------------------------

describe("gameService.getMyWeek: bye player", () => {
  it("flags a bye player with no opponent and locked guessing", async () => {
    const service = createMockGameService(
      buildScenario({
        matchups: [matchup("m1", "a", "b")],
        byePlayerIds: ["c"],
      }),
    );

    const view = await service.getMyWeek("c");

    expect(view.isBye).toBe(true);
    expect(view.opponent).toBeNull();
    expect(view.guessingUnlocked).toBe(false);
    expect(view.opponentAnswered).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// paired handling
// ---------------------------------------------------------------------------

describe("gameService.getMyWeek: paired player", () => {
  it("resolves the opponent when the player is playerAId", async () => {
    const opponent = makePlayer("b", { name: "Opponent B" });
    const service = createMockGameService(
      buildScenario({
        players: [makePlayer("a"), opponent, makePlayer("c")],
        matchups: [matchup("m1", "a", "b")],
      }),
    );

    const view = await service.getMyWeek("a");

    expect(view.isBye).toBe(false);
    expect(view.opponent).toEqual(opponent);
  });

  it("resolves the opponent when the player is playerBId", async () => {
    const opponent = makePlayer("a", { name: "Opponent A" });
    const service = createMockGameService(
      buildScenario({
        players: [opponent, makePlayer("b"), makePlayer("c")],
        matchups: [matchup("m1", "a", "b")],
      }),
    );

    const view = await service.getMyWeek("b");

    expect(view.isBye).toBe(false);
    expect(view.opponent).toEqual(opponent);
  });
});

// ---------------------------------------------------------------------------
// submission flags
// ---------------------------------------------------------------------------

describe("gameService.getMyWeek: submission flags", () => {
  it("sets myAnswersSubmitted from answeredBy.includes(playerId)", async () => {
    const submitted = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b", ["a"])] }),
    );
    const notSubmitted = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b", ["b"])] }),
    );

    expect((await submitted.getMyWeek("a")).myAnswersSubmitted).toBe(true);
    expect((await notSubmitted.getMyWeek("a")).myAnswersSubmitted).toBe(false);
  });

  it("sets opponentAnswered from answeredBy.includes(opponentId)", async () => {
    const oppAnswered = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b", ["b"])] }),
    );
    const oppNotAnswered = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b", ["a"])] }),
    );

    expect((await oppAnswered.getMyWeek("a")).opponentAnswered).toBe(true);
    expect((await oppNotAnswered.getMyWeek("a")).opponentAnswered).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// guessing unlock matrix (neither / only me / only opponent / both)
// ---------------------------------------------------------------------------

describe("gameService.getMyWeek: guessingUnlocked matrix", () => {
  it("is false when neither player has answered", async () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b", [])] }),
    );
    expect((await service.getMyWeek("a")).guessingUnlocked).toBe(false);
  });

  it("is false when only I have answered", async () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b", ["a"])] }),
    );
    expect((await service.getMyWeek("a")).guessingUnlocked).toBe(false);
  });

  it("is false when only the opponent has answered", async () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b", ["b"])] }),
    );
    expect((await service.getMyWeek("a")).guessingUnlocked).toBe(false);
  });

  it("is true when both players have answered", async () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b", ["a", "b"])] }),
    );
    expect((await service.getMyWeek("a")).guessingUnlocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// recap
// ---------------------------------------------------------------------------

describe("gameService.getMyWeek: recap", () => {
  it("is undefined when status is not closed", async () => {
    const service = createMockGameService(
      buildScenario({
        currentWeek: {
          id: WEEK_ID,
          status: "open",
          questions: [makeQuestion("q1", 0)],
        },
        matchups: [matchup("m1", "a", "b", ["a", "b"])],
      }),
    );
    expect((await service.getMyWeek("a")).recap).toBeUndefined();
  });

  it("is defined when status is closed", async () => {
    const service = createMockGameService(
      buildScenario({
        currentWeek: {
          id: WEEK_ID,
          status: "closed",
          questions: [makeQuestion("q1", 0)],
        },
        matchups: [matchup("m1", "a", "b", ["a", "b"])],
      }),
    );
    const view = await service.getMyWeek("a");
    expect(view.recap).toBeDefined();
    expect(view.recap).toMatchObject({
      meCorrect: expect.any(Number),
      opponentCorrect: expect.any(Number),
      questionCount: expect.any(Number),
    });
  });
});

// ---------------------------------------------------------------------------
// recap values (buildRecap ternary arms)
// ---------------------------------------------------------------------------

describe("gameService.getMyWeek: recap values", () => {
  it("scores meCorrect=N and opponentCorrect=0 when only I have answered a closed week", async () => {
    const questions = [
      makeQuestion("q1", 0),
      makeQuestion("q2", 1),
      makeQuestion("q3", 2),
    ];
    const questionCount = questions.length;
    const service = createMockGameService(
      buildScenario({
        currentWeek: { id: WEEK_ID, status: "closed", questions },
        matchups: [matchup("m1", "a", "b", ["a"])],
      }),
    );

    const view = await service.getMyWeek("a");

    expect(view.recap).toEqual({
      meCorrect: questionCount,
      opponentCorrect: 0,
      questionCount,
    });
  });

  it("scores both meCorrect and opponentCorrect=N when both have answered a closed week", async () => {
    const questions = [
      makeQuestion("q1", 0),
      makeQuestion("q2", 1),
      makeQuestion("q3", 2),
    ];
    const questionCount = questions.length;
    const service = createMockGameService(
      buildScenario({
        currentWeek: { id: WEEK_ID, status: "closed", questions },
        matchups: [matchup("m1", "a", "b", ["a", "b"])],
      }),
    );

    const view = await service.getMyWeek("a");

    expect(view.recap).toEqual({
      meCorrect: questionCount,
      opponentCorrect: questionCount,
      questionCount,
    });
  });

  it("scores meCorrect=0 and opponentCorrect=N when only the opponent has answered a closed week", async () => {
    const questions = [
      makeQuestion("q1", 0),
      makeQuestion("q2", 1),
      makeQuestion("q3", 2),
    ];
    const questionCount = questions.length;
    const service = createMockGameService(
      buildScenario({
        currentWeek: { id: WEEK_ID, status: "closed", questions },
        matchups: [matchup("m1", "a", "b", ["b"])],
      }),
    );

    const view = await service.getMyWeek("a");

    expect(view.recap).toEqual({
      meCorrect: 0,
      opponentCorrect: questionCount,
      questionCount,
    });
  });
});

// ---------------------------------------------------------------------------
// missing opponent (opponent ?? null fallback)
// ---------------------------------------------------------------------------

describe("gameService.getMyWeek: missing opponent", () => {
  it("resolves opponent to null when the matchup opponent id is absent from players", async () => {
    const service = createMockGameService(
      buildScenario({
        players: [makePlayer("a"), makePlayer("c")],
        matchups: [matchup("m1", "a", "b")],
      }),
    );

    const view = await service.getMyWeek("a");

    expect(view.isBye).toBe(false);
    expect(view.opponent).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// unknown player
// ---------------------------------------------------------------------------

describe("gameService.getMyWeek: unknown player", () => {
  it("rejects when the player is in no matchup and not a bye", async () => {
    const service = createMockGameService(
      buildScenario({
        matchups: [matchup("m1", "a", "b")],
        byePlayerIds: ["c"],
      }),
    );
    await expect(service.getMyWeek("zzz")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// default instance
// ---------------------------------------------------------------------------

describe("gameService: default mockGameService", () => {
  it("conforms to the GameService interface", () => {
    const service: GameService = mockGameService;
    expect(typeof service.getMyWeek).toBe("function");
  });

  it("resolves a MyWeekView for a known fixture player", async () => {
    // Imported lazily to keep this test independent of fixture id literals.
    const { players, matchups, byePlayerIds } = await import("@/lib/fixtures");
    const referenced = new Set<string>([
      ...matchups.flatMap((m) => [m.playerAId, m.playerBId]),
      ...byePlayerIds,
    ]);
    const known = players.find((p) => referenced.has(p.id));
    expect(known).toBeDefined();

    const view = await mockGameService.getMyWeek(known!.id);
    expect(view.weekId).toEqual(expect.any(String));
    expect(typeof view.isBye).toBe("boolean");
  });

  // -------------------------------------------------------------------------
  // week startsAt (drives the home eyebrow date, not the raw week id)
  // -------------------------------------------------------------------------

  it("populates MyWeekView.startsAt from the fixture week's start date", async () => {
    const { players, matchups, byePlayerIds, currentWeek } = await import(
      "@/lib/fixtures"
    );
    const referenced = new Set<string>([
      ...matchups.flatMap((m) => [m.playerAId, m.playerBId]),
      ...byePlayerIds,
    ]);
    const known = players.find((p) => referenced.has(p.id));
    expect(known).toBeDefined();

    const view = await mockGameService.getMyWeek(known!.id);

    // The fixture week carries the canonical start date; the view echoes it.
    expect(currentWeek.startsAt).toEqual(expect.any(String));
    expect(currentWeek.startsAt.length).toBeGreaterThan(0);
    expect(view.startsAt).toBe(currentWeek.startsAt);

    // And it must be a real, parseable ISO date (no NaN / Invalid Date).
    expect(Number.isNaN(new Date(view.startsAt).getTime())).toBe(false);
  });
});
