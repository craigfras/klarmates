import { describe, it, expect } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type { FixtureMatchup } from "@/lib/fixtures";
import type {
  GuessResult,
  GuessSheetItem,
  Player,
  Question,
  StoredAnswer,
  StoredAnswerOption,
  WeekStatus,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const WEEK_ID = "week-1";
const FIXED_NOW = "2026-06-24T00:00:00.000Z";
const TOTAL_QUESTIONS = 4;

// The four questions of the controlled, unlocked week.
const QUESTION_IDS = ["q1", "q2", "q3", "q4"] as const;

const MATCHUP_ID = "m1";
const ME = "a";
const OPPONENT = "b";
const BYE_PLAYER = "c";

// ---------------------------------------------------------------------------
// Builders (replicated locally — mirrors gameService.guess.test.ts)
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

type ServiceData = Parameters<typeof createMockGameService>[0];
type ServiceDeps = NonNullable<Parameters<typeof createMockGameService>[1]>;

/**
 * Builds one stored answer plus its four options for the opponent. Index 0 is
 * the real (correct) answer, then three distractors.
 */
const seedAnswer = (
  matchupId: string,
  playerId: string,
  questionId: string,
  realText: string,
  distractors: [string, string, string],
): { answer: StoredAnswer; options: StoredAnswerOption[] } => {
  const answerId = `seed-${playerId}-${questionId}`;
  const answer: StoredAnswer = {
    id: answerId,
    matchupId,
    questionId,
    playerId,
    text: realText,
  };
  const options: StoredAnswerOption[] = [
    { id: `${answerId}-opt-0`, text: realText, isCorrect: true, answerId },
    ...distractors.map((text, index) => ({
      id: `${answerId}-opt-${index + 1}`,
      text,
      isCorrect: false,
      answerId,
    })),
  ];
  return { answer, options };
};

// Deterministic shuffle: identity here — we resolve options off the guess sheet
// rather than assuming a fixed order, so the shuffle implementation is irrelevant.
const identityShuffle = <T,>(items: T[]): T[] => [...items];

const fixedDeps = (overrides: Partial<ServiceDeps> = {}): ServiceDeps => ({
  now: () => FIXED_NOW,
  shuffle: identityShuffle,
  ...overrides,
});

const OPPONENT_ANSWERS: Record<
  string,
  { real: string; distractors: [string, string, string] }
> = {
  q1: { real: "real-q1", distractors: ["wrong-q1-a", "wrong-q1-b", "wrong-q1-c"] },
  q2: { real: "real-q2", distractors: ["wrong-q2-a", "wrong-q2-b", "wrong-q2-c"] },
  q3: { real: "real-q3", distractors: ["wrong-q3-a", "wrong-q3-b", "wrong-q3-c"] },
  q4: { real: "real-q4", distractors: ["wrong-q4-a", "wrong-q4-b", "wrong-q4-c"] },
};

/**
 * Controlled, unlocked scenario: a four-question OPEN week, a matchup where both
 * participants have answered (guessing unlocked), and the opponent's stored
 * answers + options across all four questions so submitGuess succeeds.
 */
const buildUnlockedScenario = (
  overrides: Partial<ServiceData> = {},
): ServiceData => {
  const seeded = QUESTION_IDS.map((qid) =>
    seedAnswer(
      MATCHUP_ID,
      OPPONENT,
      qid,
      OPPONENT_ANSWERS[qid].real,
      OPPONENT_ANSWERS[qid].distractors,
    ),
  );
  return {
    players: [makePlayer(ME), makePlayer(OPPONENT), makePlayer(BYE_PLAYER)],
    currentWeek: {
      id: WEEK_ID,
      status: "open" as WeekStatus,
      questions: QUESTION_IDS.map((qid, index) => makeQuestion(qid, index)),
    },
    matchups: [matchup(MATCHUP_ID, ME, OPPONENT, [ME, OPPONENT])],
    byePlayerIds: [],
    answers: seeded.map((s) => s.answer),
    answerOptions: seeded.flatMap((s) => s.options),
    guesses: [],
    ...overrides,
  };
};

/**
 * Submits a guess for every question on the sheet, choosing the first option of
 * each item. Drives the player to a fully-guessed (complete) state.
 */
const guessEveryQuestion = async (
  service: ReturnType<typeof createMockGameService>,
  playerId: string,
): Promise<void> => {
  const sheet = await service.getGuessSheet(playerId, WEEK_ID);
  for (const item of sheet) {
    await service.submitGuess(playerId, WEEK_ID, item.questionId, item.options[0].id);
  }
};

// ---------------------------------------------------------------------------
// getMyWeek: guessingComplete
// ---------------------------------------------------------------------------

describe("gameService.getMyWeek: guessingComplete", () => {
  it("is false before the player has guessed anything (unlocked, zero guesses)", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    const view = await service.getMyWeek(ME);

    expect(view.guessingUnlocked).toBe(true);
    expect(view.guessingComplete).toBe(false);
  });

  it("is false when some but NOT all questions have been guessed", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    const sheet = await service.getGuessSheet(ME, WEEK_ID);
    // Guess only the first two of four questions.
    await service.submitGuess(ME, WEEK_ID, sheet[0].questionId, sheet[0].options[0].id);
    await service.submitGuess(ME, WEEK_ID, sheet[1].questionId, sheet[1].options[0].id);

    const view = await service.getMyWeek(ME);

    expect(view.guessingComplete).toBe(false);
  });

  it("is true once the player has submitted a guess for EVERY question", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    await guessEveryQuestion(service, ME);

    const view = await service.getMyWeek(ME);

    expect(view.guessingComplete).toBe(true);
  });

  it("is false for a player on a bye", async () => {
    const service = createMockGameService(
      buildUnlockedScenario({ byePlayerIds: [BYE_PLAYER] }),
      fixedDeps(),
    );

    const view = await service.getMyWeek(BYE_PLAYER);

    expect(view.isBye).toBe(true);
    expect(view.guessingComplete).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getMyWeek: myCorrectGuesses (the player's week score)
// ---------------------------------------------------------------------------

describe("gameService.getMyWeek: myCorrectGuesses", () => {
  it("is 0 before the player has guessed anything (unlocked, zero guesses)", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    const view = await service.getMyWeek(ME);

    expect(view.guessingUnlocked).toBe(true);
    expect(view.myCorrectGuesses).toBe(0);
  });

  it("counts only CORRECT guesses (2 correct + 1 incorrect -> 2)", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    // The seed encodes the correct option as `seed-b-<qid>-opt-0` and the
    // distractors as `-opt-1..3`. Guess q1 + q2 correctly, q3 incorrectly.
    const r1 = await service.submitGuess(ME, WEEK_ID, "q1", "seed-b-q1-opt-0");
    const r2 = await service.submitGuess(ME, WEEK_ID, "q2", "seed-b-q2-opt-0");
    const r3 = await service.submitGuess(ME, WEEK_ID, "q3", "seed-b-q3-opt-1");

    // Sanity: the chosen options behaved as expected.
    expect(r1.correct).toBe(true);
    expect(r2.correct).toBe(true);
    expect(r3.correct).toBe(false);

    const view = await service.getMyWeek(ME);

    expect(view.myCorrectGuesses).toBe(2);
  });

  it("equals the count of correct submitGuess results once every question is guessed", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    const sheet = await service.getGuessSheet(ME, WEEK_ID);
    let correctCount = 0;
    for (const item of sheet) {
      const result = await service.submitGuess(
        ME,
        WEEK_ID,
        item.questionId,
        item.options[0].id,
      );
      if (result.correct) correctCount += 1;
    }

    const view = await service.getMyWeek(ME);

    expect(view.guessingComplete).toBe(true);
    expect(view.myCorrectGuesses).toBeGreaterThanOrEqual(0);
    expect(view.myCorrectGuesses).toBeLessThanOrEqual(TOTAL_QUESTIONS);
    expect(view.myCorrectGuesses).toBe(correctCount);
  });

  it("is 0 for a player on a bye", async () => {
    const service = createMockGameService(
      buildUnlockedScenario({ byePlayerIds: [BYE_PLAYER] }),
      fixedDeps(),
    );

    const view = await service.getMyWeek(BYE_PLAYER);

    expect(view.isBye).toBe(true);
    expect(view.myCorrectGuesses).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getGuessSheet: per-item result
// ---------------------------------------------------------------------------

describe("gameService.getGuessSheet: item.result", () => {
  it("every item's result is null before the player has guessed", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    const sheet = await service.getGuessSheet(ME, WEEK_ID);

    expect(sheet).toHaveLength(TOTAL_QUESTIONS);
    for (const item of sheet) {
      expect(item.result).toBeNull();
    }
  });

  it("exposes the prior result for a guessed question, leaving others null", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    // Guess only q1 (choose its correct option so we can assert correct=true).
    const before = await service.getGuessSheet(ME, WEEK_ID);
    const q1 = before.find((item: GuessSheetItem) => item.questionId === "q1");
    const correctOptionId = "seed-b-q1-opt-0";
    expect(q1?.options.some((o) => o.id === correctOptionId)).toBe(true);
    await service.submitGuess(ME, WEEK_ID, "q1", correctOptionId);

    const sheet = await service.getGuessSheet(ME, WEEK_ID);
    const guessed = sheet.find((item: GuessSheetItem) => item.questionId === "q1");
    const notGuessed = sheet.filter((item: GuessSheetItem) => item.questionId !== "q1");

    // The guessed item now carries a populated result.
    const result = guessed?.result as GuessResult;
    expect(result).not.toBeNull();
    expect(result.questionId).toBe("q1");
    expect(typeof result.correct).toBe("boolean");
    expect(result.correct).toBe(true);
    expect(typeof result.realAnswerText).toBe("string");
    expect(result.realAnswerText).toBe(OPPONENT_ANSWERS["q1"].real);

    // Not-yet-guessed questions remain null.
    for (const item of notGuessed) {
      expect(item.result).toBeNull();
    }
  });

  it("records correct=false in the result when an incorrect option was guessed", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    const distractorOptionId = "seed-b-q2-opt-1";
    await service.submitGuess(ME, WEEK_ID, "q2", distractorOptionId);

    const sheet = await service.getGuessSheet(ME, WEEK_ID);
    const guessed = sheet.find((item: GuessSheetItem) => item.questionId === "q2");
    const result = guessed?.result as GuessResult;

    expect(result).not.toBeNull();
    expect(result.correct).toBe(false);
    expect(result.realAnswerText).toBe(OPPONENT_ANSWERS["q2"].real);
  });

  it("every item carries a populated result once all questions are guessed", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    await guessEveryQuestion(service, ME);

    const sheet = await service.getGuessSheet(ME, WEEK_ID);
    for (const item of sheet) {
      expect(item.result).not.toBeNull();
      expect((item.result as GuessResult).questionId).toBe(item.questionId);
    }
  });
});
