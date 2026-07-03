/**
 * Tests for gameService.restartWeek(weekId).
 *
 * ============================================================
 * FEATURE CONTRACT (code-writer must match exactly)
 * ============================================================
 *
 *   restartWeek(weekId: string): Promise<void>
 *
 * Reverts the CURRENT OPEN week back to the questions-review (draft) state and
 * wipes all play so the admin can edit/regenerate questions and re-approve.
 * Re-approval re-pairs, picking up newly-active players.
 *
 * After `restartWeek(currentOpenWeekId)`:
 *   - The week is NO LONGER open: its status becomes "awaiting_approval" and
 *     it returns to the review/draft flow. questionsApprovedAt is cleared.
 *   - All play state for the week is wiped: submitted answers, generated answer
 *     options, guesses, weekly scores, recaps; the week's matchups and
 *     bye/participant state are cleared.
 *   - The week's QUESTIONS are preserved (same texts) and available via the
 *     draft/review path (getDraftQuestions(weekId)).
 *   - It THROWS if weekId is not the current open week (message contains "open").
 *
 * Observability notes (how the mock surfaces the above):
 *   - status is read via getMyWeek(playerId).status (mirrors approveWeek tests).
 *   - matchups/byes are read via getAdminMatchups() (AdminWeekOverview) and via
 *     getMyWeek().opponent / .isBye (mirrors adminMatchups + openWeek tests).
 *   - getDraftQuestions(weekId) is idempotent for an existing draft and returns
 *     the same texts (mirrors adminWeek tests), so after restart it returns the
 *     preserved question texts WITHOUT regenerating.
 * ============================================================
 */

import { describe, it, expect, vi } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type {
  Player,
  Question,
  StoredAnswer,
  StoredAnswerOption,
  StoredGuess,
  StoredMatchupRecap,
  StoredWeeklyScore,
  WeekStatus,
} from "@/lib/types";
import type { FixtureMatchup } from "@/lib/fixtures";
import type { DistractorGenerator, QuestionGenerator } from "@/lib/ai";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** The current (already-open) week id under test. */
const OPEN_WEEK_ID = "week-open-2026-25";

/** A week id that is NOT the current open week — for error cases. */
const BOGUS_WEEK_ID = "week-bogus-9999";

const OPEN_STATUS: WeekStatus = "open";
const AWAITING_STATUS: WeekStatus = "awaiting_approval";
const CLOSED_STATUS: WeekStatus = "closed";

/** Deterministic timestamp injected for approval stamping. */
const NOW_STUB = "2026-06-25T12:00:00.000Z";

/** The four seeded question texts that must survive a restart. */
const QUESTION_TEXTS = [
  "What was your first programming language?",
  "What is your go-to debugging tactic?",
  "Which tool could you not live without?",
  "What is your favourite keyboard shortcut?",
];

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

const makeQuestion = (id: string, orderIndex: number, text: string): Question => ({
  id,
  orderIndex,
  text,
});

const SEEDED_QUESTIONS: Question[] = QUESTION_TEXTS.map((text, i) =>
  makeQuestion(`q${i}`, i, text),
);

type ServiceData = Parameters<typeof createMockGameService>[0];

/**
 * Builds a deterministic fake QuestionGenerator. If the implementation ever
 * tries to REGENERATE questions during restart (it must not — texts are
 * preserved), this generator's output would differ from the seeded texts and
 * the "preserved" assertions would fail loudly.
 */
const makeFakeQuestionGenerator = (): QuestionGenerator & {
  generateQuestions: ReturnType<typeof vi.fn>;
} => ({
  generateQuestions: vi.fn(
    async (count: number): Promise<string[]> =>
      Array.from({ length: count }, (_, i) => `Regenerated question ${i}`),
  ),
});

/** Deterministic distractor generator — keeps submitAnswers options stable. */
const makeFakeDistractorGenerator = (): DistractorGenerator => ({
  generateDistractors: async (): Promise<string[]> => [
    "Distractor A",
    "Distractor B",
    "Distractor C",
  ],
});

/**
 * Builds a stored matchup for the open week with both players paired.
 */
const seededMatchup = (
  playerAId: string,
  playerBId: string,
  answeredBy: string[],
): FixtureMatchup => ({
  id: `matchup-${OPEN_WEEK_ID}-${playerAId}-${playerBId}`,
  weekId: OPEN_WEEK_ID,
  playerAId,
  playerBId,
  answeredBy,
});

/**
 * An OPEN current week with: four players (p1..p4) paired into two matchups,
 * both players in matchup 1 having answered, plus seeded answers, answer
 * options, guesses, weekly scores and recaps. This is the full "mid-play"
 * snapshot the restart must wipe.
 *
 * presentPlayerIds is intentionally OMITTED so re-approval pairs over the
 * live (active) roster — that is what lets a newly-added active player join.
 */
const buildOpenWeekScenario = (
  overrides: Partial<ServiceData> = {},
): ServiceData => {
  const m1 = seededMatchup("p1", "p2", ["p1", "p2"]);
  const m2 = seededMatchup("p3", "p4", ["p3"]);

  const answers: StoredAnswer[] = [
    {
      id: "answer-1",
      matchupId: m1.id,
      questionId: "q0",
      playerId: "p1",
      text: "Python",
    },
    {
      id: "answer-2",
      matchupId: m1.id,
      questionId: "q0",
      playerId: "p2",
      text: "JavaScript",
    },
  ];

  const answerOptions: StoredAnswerOption[] = [
    { id: "answer-1-opt-0", text: "Python", isCorrect: true, answerId: "answer-1" },
    { id: "answer-1-opt-1", text: "C", isCorrect: false, answerId: "answer-1" },
    { id: "answer-2-opt-0", text: "JavaScript", isCorrect: true, answerId: "answer-2" },
    { id: "answer-2-opt-1", text: "Ruby", isCorrect: false, answerId: "answer-2" },
  ];

  const guesses: StoredGuess[] = [
    {
      id: "guess-1",
      matchupId: m1.id,
      questionId: "q0",
      guesserId: "p1",
      chosenOptionId: "answer-2-opt-0",
      isCorrect: true,
      submittedAt: NOW_STUB,
    },
  ];

  const weeklyScores: StoredWeeklyScore[] = [
    { weekId: OPEN_WEEK_ID, playerId: "p1", participation: 1, correctGuesses: 1, total: 2 },
  ];

  const recaps: StoredMatchupRecap[] = [
    {
      weekId: OPEN_WEEK_ID,
      matchupId: m1.id,
      correctByPlayer: { p1: 1, p2: 0 },
      questionCount: SEEDED_QUESTIONS.length,
    },
  ];

  return {
    players: [makePlayer("p1"), makePlayer("p2"), makePlayer("p3"), makePlayer("p4")],
    currentWeek: {
      id: OPEN_WEEK_ID,
      startsAt: "2026-06-22T00:00:00.000Z",
      status: OPEN_STATUS,
      questions: SEEDED_QUESTIONS.map((q) => ({ ...q })),
      questionsApprovedAt: NOW_STUB,
    },
    matchups: [m1, m2],
    byePlayerIds: [],
    answers,
    answerOptions,
    guesses,
    weeklyScores,
    recaps,
    ...overrides,
  };
};

const makeService = (data: ServiceData) =>
  createMockGameService(data, {
    questions: makeFakeQuestionGenerator(),
    distractors: makeFakeDistractorGenerator(),
    now: () => NOW_STUB,
  });

// ---------------------------------------------------------------------------
// interface presence
// ---------------------------------------------------------------------------

describe("gameService.restartWeek: interface", () => {
  it("exposes restartWeek on the service", () => {
    const service = makeService(buildOpenWeekScenario());
    expect(typeof service.restartWeek).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// reverts open week to awaiting_approval
// ---------------------------------------------------------------------------

describe("gameService.restartWeek: reverts the open week to awaiting_approval", () => {
  it("getMyWeek no longer reports status 'open' after restart", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    const view = await service.getMyWeek("p1");
    expect(view.status).not.toBe(OPEN_STATUS);
  });

  it("the week's status becomes 'awaiting_approval'", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    const view = await service.getMyWeek("p1");
    expect(view.status).toBe(AWAITING_STATUS);
  });

  it("getAdminMatchups reports the week as no longer open", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    const overview = await service.getAdminMatchups();
    expect(overview.weekStatus).toBe(AWAITING_STATUS);
  });

  it("clears questionsApprovedAt on the week", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    expect(data.currentWeek.questionsApprovedAt).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// questions preserved (available via the draft/review path)
// ---------------------------------------------------------------------------

describe("gameService.restartWeek: preserves the week's questions", () => {
  it("getDraftQuestions(weekId) returns the same question texts as before restart", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    const textsBefore = SEEDED_QUESTIONS.map((q) => q.text);

    await service.restartWeek(OPEN_WEEK_ID);

    const draft = await service.getDraftQuestions(OPEN_WEEK_ID);
    expect(draft.map((q) => q.text)).toEqual(textsBefore);
  });

  it("does NOT regenerate questions (the injected generator is not consulted for the restarted week)", async () => {
    const gen = makeFakeQuestionGenerator();
    const data = buildOpenWeekScenario();
    const service = createMockGameService(data, {
      questions: gen,
      distractors: makeFakeDistractorGenerator(),
      now: () => NOW_STUB,
    });

    await service.restartWeek(OPEN_WEEK_ID);
    const draft = await service.getDraftQuestions(OPEN_WEEK_ID);

    // The preserved texts must NOT be the generator's "Regenerated question N".
    expect(draft.map((q) => q.text)).toEqual(QUESTION_TEXTS);
    expect(gen.generateQuestions).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// play state wiped
// ---------------------------------------------------------------------------

describe("gameService.restartWeek: wipes all play state", () => {
  it("getMyWeek shows myAnswersSubmitted === false for a player who had answered", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    const view = await service.getMyWeek("p1");
    expect(view.myAnswersSubmitted).toBe(false);
  });

  it("getMyWeek shows no opponent and no bye (pre-pairing) for a previously paired player", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    const view = await service.getMyWeek("p1");
    expect(view.opponent).toBeNull();
    expect(view.isBye).toBe(false);
  });

  it("getAdminMatchups shows no live matchups after restart", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    const overview = await service.getAdminMatchups();
    expect(overview.matchups).toEqual([]);
  });

  it("getAdminMatchups shows no bye players after restart", async () => {
    const data = buildOpenWeekScenario({ byePlayerIds: ["p4"] });
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    const overview = await service.getAdminMatchups();
    expect(overview.byePlayers).toEqual([]);
  });

  it("clears stored answers for the week", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    expect(data.answers ?? []).toEqual([]);
  });

  it("clears stored answer options for the week", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    expect(data.answerOptions ?? []).toEqual([]);
  });

  it("clears stored guesses for the week", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    expect(data.guesses ?? []).toEqual([]);
  });

  it("clears weekly scores for the week", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    const remaining = (data.weeklyScores ?? []).filter(
      (s) => s.weekId === OPEN_WEEK_ID,
    );
    expect(remaining).toEqual([]);
  });

  it("clears recaps for the week", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    const remaining = (data.recaps ?? []).filter(
      (r) => r.weekId === OPEN_WEEK_ID,
    );
    expect(remaining).toEqual([]);
  });

  it("clears the week's matchups", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    expect(data.matchups).toEqual([]);
  });

  it("clears the week's byePlayerIds", async () => {
    const data = buildOpenWeekScenario({ byePlayerIds: ["p4"] });
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);

    expect(data.byePlayerIds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// error cases — not the current open week
// ---------------------------------------------------------------------------

describe("gameService.restartWeek: error cases", () => {
  it("throws (message mentions 'open') when weekId is not the current week", async () => {
    const service = makeService(buildOpenWeekScenario());

    await expect(service.restartWeek(BOGUS_WEEK_ID)).rejects.toThrow(/open/i);
  });

  it("throws (message mentions 'open') when the current week is not open", async () => {
    const data = buildOpenWeekScenario();
    data.currentWeek.status = CLOSED_STATUS;
    const service = makeService(data);

    await expect(service.restartWeek(OPEN_WEEK_ID)).rejects.toThrow(/open/i);
  });
});

// ---------------------------------------------------------------------------
// END-TO-END acceptance: restart → add active player → re-approve → re-paired
// ---------------------------------------------------------------------------

describe("gameService.restartWeek: end-to-end re-pairing picks up a new active player", () => {
  it("a NEW active player added after restart appears in a matchup once the week is re-approved", async () => {
    // Seed an open week paired over p1..p4 (even, no bye). After restart we add
    // p5 AND p6 (keeping the active count even → no bye ambiguity), then run the
    // review → approve path. The two new players must now be paired.
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    // 1. Restart the open week back to review state (wipes play, clears pairing).
    await service.restartWeek(OPEN_WEEK_ID);

    // 2. Add two NEW active players not in the original pairing (even total = 6).
    await service.upsertPlayer(makePlayer("p5"));
    await service.upsertPlayer(makePlayer("p6"));

    // 3. Run the review → approve path. getDraftQuestions surfaces the preserved
    //    draft for the restarted week; approveWeek promotes it and re-pairs.
    await service.getDraftQuestions(OPEN_WEEK_ID);
    await service.approveWeek(OPEN_WEEK_ID);

    // 4. The freshly computed matchups must include the new players.
    const overview = await service.getAdminMatchups();
    const participants = new Set(
      overview.matchups.flatMap((m) => [m.playerA.id, m.playerB.id]),
    );
    expect(participants.has("p5")).toBe(true);
    expect(participants.has("p6")).toBe(true);
  });

  it("re-approval re-opens the week with all six active players paired (no bye for an even count)", async () => {
    const data = buildOpenWeekScenario();
    const service = makeService(data);

    await service.restartWeek(OPEN_WEEK_ID);
    await service.upsertPlayer(makePlayer("p5"));
    await service.upsertPlayer(makePlayer("p6"));

    await service.getDraftQuestions(OPEN_WEEK_ID);
    await service.approveWeek(OPEN_WEEK_ID);

    const overview = await service.getAdminMatchups();
    const participants = new Set(
      overview.matchups.flatMap((m) => [m.playerA.id, m.playerB.id]),
    );

    expect(overview.weekStatus).toBe(OPEN_STATUS);
    expect(overview.byePlayers).toEqual([]);
    expect(participants).toEqual(new Set(["p1", "p2", "p3", "p4", "p5", "p6"]));
  });
});
