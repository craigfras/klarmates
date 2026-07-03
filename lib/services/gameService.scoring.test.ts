import { describe, it, expect } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type { FixtureMatchup } from "@/lib/fixtures";
import type {
  HistoryEntry,
  LeaderboardSeedRow,
  Player,
  Question,
  StoredGuess,
  StoredMatchupRecap,
  StoredWeeklyScore,
  WeekStatus,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const WEEK_ID = "week-1";
const FIXED_NOW = "2026-06-24T00:00:00.000Z";
const MATCHUP_ID = "m1";
const ME = "a";
const OPPONENT = "b";
const BYE = "c";

// ---------------------------------------------------------------------------
// Builders (replicated locally — do NOT import private helpers)
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

const matchup = (
  id: string,
  playerAId: string,
  playerBId: string,
  answeredBy: string[] = [],
): FixtureMatchup => ({ id, weekId: WEEK_ID, playerAId, playerBId, answeredBy });

/** Builds a StoredGuess with a controlled isCorrect flag for a guesser. */
const makeGuess = (
  guesserId: string,
  questionId: string,
  isCorrect: boolean,
): StoredGuess => ({
  id: `guess-${guesserId}-${questionId}`,
  matchupId: MATCHUP_ID,
  questionId,
  guesserId,
  chosenOptionId: `opt-${questionId}`,
  isCorrect,
  submittedAt: FIXED_NOW,
});

type ServiceData = Parameters<typeof createMockGameService>[0];
type ServiceDeps = NonNullable<Parameters<typeof createMockGameService>[1]>;

const fixedDeps = (overrides: Partial<ServiceDeps> = {}): ServiceDeps => ({
  now: () => FIXED_NOW,
  ...overrides,
});

// ---------------------------------------------------------------------------
// getLeaderboard
// ---------------------------------------------------------------------------

describe("gameService.getLeaderboard", () => {
  // Ada & Linus tie on season total=5; Ada wins the tiebreak on correctGuesses.
  // Grace tops the all-time scope.
  const LEADERBOARD: LeaderboardSeedRow[] = [
    {
      playerId: "player-ada",
      season: { total: 5, correctGuesses: 4 },
      allTime: { total: 18, correctGuesses: 15 },
    },
    {
      playerId: "player-linus",
      season: { total: 5, correctGuesses: 3 },
      allTime: { total: 16, correctGuesses: 12 },
    },
    {
      playerId: "player-grace",
      season: { total: 4, correctGuesses: 4 },
      allTime: { total: 20, correctGuesses: 16 },
    },
  ];

  const PLAYERS: Player[] = [
    makePlayer("player-ada", { name: "Ada Lovelace" }),
    makePlayer("player-linus", { name: "Linus Bytes" }),
    makePlayer("player-grace", { name: "Grace Hopper" }),
  ];

  const buildData = (overrides: Partial<ServiceData> = {}): ServiceData => ({
    players: PLAYERS,
    currentWeek: { id: WEEK_ID, status: "open" as WeekStatus, questions: [] },
    matchups: [],
    byePlayerIds: [],
    leaderboard: LEADERBOARD,
    ...overrides,
  });

  it("ranks the season scope and resolves player names", async () => {
    const service = createMockGameService(buildData(), fixedDeps());

    const ranked = await service.getLeaderboard("season");

    expect(ranked.map((row) => row.playerId)).toEqual([
      "player-ada",
      "player-linus",
      "player-grace",
    ]);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3]);
    expect(ranked[0].name).toBe("Ada Lovelace");
    expect(ranked[0].total).toBe(5);
    expect(ranked[0].correctGuesses).toBe(4);
  });

  it("breaks the season tie (ada & linus on total 5) by correctGuesses", async () => {
    const service = createMockGameService(buildData(), fixedDeps());

    const ranked = await service.getLeaderboard("season");

    // Ada (4 correct) ranks above Linus (3 correct) despite the equal total.
    expect(ranked[0].playerId).toBe("player-ada");
    expect(ranked[1].playerId).toBe("player-linus");
  });

  it("ranks the all_time scope using the allTime ScopeScore", async () => {
    const service = createMockGameService(buildData(), fixedDeps());

    const ranked = await service.getLeaderboard("all_time");

    // Grace tops the all-time board with total 20.
    expect(ranked[0].playerId).toBe("player-grace");
    expect(ranked[0].total).toBe(20);
    expect(ranked[0].correctGuesses).toBe(16);
    expect(ranked.map((row) => row.rank)).toEqual([1, 2, 3]);
  });

  it("falls back to the playerId when the player is absent from the roster", async () => {
    const service = createMockGameService(
      buildData({ players: [] }),
      fixedDeps(),
    );

    const ranked = await service.getLeaderboard("season");

    expect(ranked[0].name).toBe(ranked[0].playerId);
  });
});

// ---------------------------------------------------------------------------
// getMyHistory
// ---------------------------------------------------------------------------

describe("gameService.getMyHistory", () => {
  const ADA_HISTORY: HistoryEntry[] = [
    {
      weekId: "week-2026-24",
      startsAt: "2026-06-08T00:00:00.000Z",
      opponentName: "Grace Hopper",
      recap: { meCorrect: 3, opponentCorrect: 2, questionCount: 4 },
    },
  ];

  const buildData = (): ServiceData => ({
    players: [makePlayer("player-ada")],
    currentWeek: { id: WEEK_ID, status: "open" as WeekStatus, questions: [] },
    matchups: [],
    byePlayerIds: [],
    history: { "player-ada": ADA_HISTORY },
  });

  it("returns the injected history for a known player", async () => {
    const service = createMockGameService(buildData(), fixedDeps());

    const history = await service.getMyHistory("player-ada");

    expect(history).toEqual(ADA_HISTORY);
  });

  it("returns an empty array for a player with no history", async () => {
    const service = createMockGameService(buildData(), fixedDeps());

    const history = await service.getMyHistory("player-unknown");

    expect(history).toEqual([]);
  });

  it("returns an empty array when no history is injected at all", async () => {
    const service = createMockGameService(
      {
        players: [makePlayer("player-ada")],
        currentWeek: {
          id: WEEK_ID,
          status: "open" as WeekStatus,
          questions: [],
        },
        matchups: [],
        byePlayerIds: [],
      },
      fixedDeps(),
    );

    const history = await service.getMyHistory("player-ada");

    expect(history).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// closeWeek
// ---------------------------------------------------------------------------

describe("gameService.closeWeek", () => {
  // A four-question week: ME guesses 3 correct, OPPONENT guesses 1 correct.
  // Both submitted their own answers; C sits on a bye.
  const QUESTIONS: Question[] = [
    makeQuestion("q1", 0),
    makeQuestion("q2", 1),
    makeQuestion("q3", 2),
    makeQuestion("q4", 3),
  ];

  const ME_CORRECT = 3;
  const OPPONENT_CORRECT = 1;

  const GUESSES: StoredGuess[] = [
    // ME: 3 correct, 1 wrong.
    makeGuess(ME, "q1", true),
    makeGuess(ME, "q2", true),
    makeGuess(ME, "q3", true),
    makeGuess(ME, "q4", false),
    // OPPONENT: 1 correct, 1 wrong.
    makeGuess(OPPONENT, "q1", true),
    makeGuess(OPPONENT, "q2", false),
  ];

  const buildData = (overrides: Partial<ServiceData> = {}): ServiceData => ({
    players: [makePlayer(ME), makePlayer(OPPONENT), makePlayer(BYE)],
    currentWeek: {
      id: WEEK_ID,
      status: "open" as WeekStatus,
      questions: QUESTIONS,
    },
    matchups: [matchup(MATCHUP_ID, ME, OPPONENT, [ME, OPPONENT])],
    byePlayerIds: [BYE],
    guesses: GUESSES,
    weeklyScores: [],
    recaps: [],
    ...overrides,
  });

  it("sets the current week status to closed", async () => {
    const data = buildData();
    const service = createMockGameService(data, fixedDeps());

    await service.closeWeek(WEEK_ID);

    expect(data.currentWeek.status).toBe("closed");
  });

  it("writes one StoredWeeklyScore per matched player with computed totals", async () => {
    const data = buildData();
    const service = createMockGameService(data, fixedDeps());

    await service.closeWeek(WEEK_ID);

    const scores = data.weeklyScores ?? [];
    const byPlayer = (id: string): StoredWeeklyScore | undefined =>
      scores.find((score) => score.playerId === id);

    // ME submitted + 3 correct → participation 1, total 4.
    expect(byPlayer(ME)).toEqual({
      weekId: WEEK_ID,
      playerId: ME,
      participation: 1,
      correctGuesses: ME_CORRECT,
      total: ME_CORRECT + 1,
    });

    // OPPONENT submitted + 1 correct → participation 1, total 2.
    expect(byPlayer(OPPONENT)).toEqual({
      weekId: WEEK_ID,
      playerId: OPPONENT,
      participation: 1,
      correctGuesses: OPPONENT_CORRECT,
      total: OPPONENT_CORRECT + 1,
    });
  });

  it("writes a StoredMatchupRecap per matchup with per-player correct counts and questionCount", async () => {
    const data = buildData();
    const service = createMockGameService(data, fixedDeps());

    await service.closeWeek(WEEK_ID);

    const recaps = data.recaps ?? [];
    expect(recaps).toHaveLength(1);
    const recap: StoredMatchupRecap = recaps[0];
    expect(recap.weekId).toBe(WEEK_ID);
    expect(recap.matchupId).toBe(MATCHUP_ID);
    expect(recap.questionCount).toBe(QUESTIONS.length);
    expect(recap.correctByPlayer[ME]).toBe(ME_CORRECT);
    expect(recap.correctByPlayer[OPPONENT]).toBe(OPPONENT_CORRECT);
  });

  it("writes a zero-scoring StoredWeeklyScore for a bye player and no recap for them", async () => {
    const data = buildData();
    const service = createMockGameService(data, fixedDeps());

    await service.closeWeek(WEEK_ID);

    const byeScore = (data.weeklyScores ?? []).find(
      (score) => score.playerId === BYE,
    );
    expect(byeScore).toEqual({
      weekId: WEEK_ID,
      playerId: BYE,
      participation: 0,
      correctGuesses: 0,
      total: 0,
    });

    // The bye player never appears in a matchup recap.
    const recaps = data.recaps ?? [];
    recaps.forEach((recap) => {
      expect(BYE in recap.correctByPlayer).toBe(false);
    });
  });

  it("throws when the weekId is not the current week", async () => {
    const service = createMockGameService(buildData(), fixedDeps());

    await expect(service.closeWeek("some-other-week")).rejects.toThrow();
  });
});
