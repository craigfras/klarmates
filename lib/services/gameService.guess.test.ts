import { describe, it, expect } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type { FixtureMatchup } from "@/lib/fixtures";
import type {
  GuessOption,
  GuessSheetItem,
  Player,
  Question,
  StoredAnswer,
  StoredAnswerOption,
  StoredGuess,
  WeekStatus,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const WEEK_ID = "week-1";
const FIXED_NOW = "2026-06-24T00:00:00.000Z";
const OPTIONS_PER_ANSWER = 4; // 1 real + 3 distractors
const EXPECTED_SHEET_ITEMS = 4;

// The four questions of the controlled week (mirrors the four-question week).
const QUESTION_IDS = ["q1", "q2", "q3", "q4"] as const;

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

type ServiceData = Parameters<typeof createMockGameService>[0];
type ServiceDeps = NonNullable<Parameters<typeof createMockGameService>[1]>;

/**
 * Builds one stored answer plus its four options for an opponent. Index 0 is the
 * real answer (isCorrect), then three distractors. Readable seed ids, mirroring
 * the fixture seed convention; the service works off relationships, not id text.
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

// A deterministic shuffle: reverse a copy. Lets us prove shuffle is applied
// without assuming the correct option lands first.
const reverseShuffle = <T,>(items: T[]): T[] => [...items].reverse();

const fixedDeps = (overrides: Partial<ServiceDeps> = {}): ServiceDeps => ({
  now: () => FIXED_NOW,
  shuffle: reverseShuffle,
  ...overrides,
});

/**
 * Real answer text per opponent question, used both to seed options and to
 * assert realAnswerText. Distractors are distinct and non-equal to the real.
 */
const OPPONENT_ANSWERS: Record<
  string,
  { real: string; distractors: [string, string, string] }
> = {
  q1: { real: "real-q1", distractors: ["wrong-q1-a", "wrong-q1-b", "wrong-q1-c"] },
  q2: { real: "real-q2", distractors: ["wrong-q2-a", "wrong-q2-b", "wrong-q2-c"] },
  q3: { real: "real-q3", distractors: ["wrong-q3-a", "wrong-q3-b", "wrong-q3-c"] },
  q4: { real: "real-q4", distractors: ["wrong-q4-a", "wrong-q4-b", "wrong-q4-c"] },
};

const MATCHUP_ID = "m1";
const ME = "a";
const OPPONENT = "b";

/**
 * Controlled, unlocked scenario: a four-question week, a paired matchup where
 * both participants have answered (so guessing is unlocked), and stored answers
 * + options for the opponent across all four questions.
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
    players: [makePlayer(ME), makePlayer(OPPONENT), makePlayer("c")],
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

// ---------------------------------------------------------------------------
// interface presence
// ---------------------------------------------------------------------------

describe("gameService.guess: interface", () => {
  it("exposes getGuessSheet and submitGuess on the service", () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());
    expect(typeof service.getGuessSheet).toBe("function");
    expect(typeof service.submitGuess).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// getGuessSheet: happy path
// ---------------------------------------------------------------------------

describe("gameService.getGuessSheet: happy path", () => {
  it("returns one item per question, in question order", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    const sheet = await service.getGuessSheet(ME, WEEK_ID);

    expect(sheet).toHaveLength(EXPECTED_SHEET_ITEMS);
    expect(sheet.map((item: GuessSheetItem) => item.questionId)).toEqual([
      "q1",
      "q2",
      "q3",
      "q4",
    ]);
    expect(sheet[0].questionText).toBe("Question q1");
  });

  it("includes the opponent's four options for each question", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    const sheet = await service.getGuessSheet(ME, WEEK_ID);

    for (const item of sheet) {
      expect(item.options).toHaveLength(OPTIONS_PER_ANSWER);
      const expected = OPPONENT_ANSWERS[item.questionId];
      const texts = item.options
        .map((option: GuessOption) => option.text)
        .sort();
      expect(texts).toEqual([expected.real, ...expected.distractors].sort());
    }
  });

  it("applies the injected shuffle to the options (reverse order here)", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    const sheet = await service.getGuessSheet(ME, WEEK_ID);

    // Seed order is [real, distractor-1, distractor-2, distractor-3]; the
    // reverse shuffle must flip it so the real answer is NOT first.
    const firstItem = sheet[0];
    const expected = OPPONENT_ANSWERS["q1"];
    expect(firstItem.options.map((option: GuessOption) => option.text)).toEqual([
      expected.distractors[2],
      expected.distractors[1],
      expected.distractors[0],
      expected.real,
    ]);
    // Guards against assuming the correct/real option lands first.
    expect(firstItem.options[0].text).not.toBe(expected.real);
  });

  it("strips isCorrect and answerId — options expose ONLY id and text", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    const sheet = await service.getGuessSheet(ME, WEEK_ID);

    for (const item of sheet) {
      for (const option of item.options) {
        expect(Object.keys(option).sort()).toEqual(["id", "text"]);
        const leaky = option as Record<string, unknown>;
        expect("isCorrect" in leaky).toBe(false);
        expect("answerId" in leaky).toBe(false);
        expect(typeof option.id).toBe("string");
        expect(typeof option.text).toBe("string");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getGuessSheet: lazy option generation (backstop)
// ---------------------------------------------------------------------------

/**
 * Scenario where the opponent has StoredAnswers persisted but NO answer options
 * yet (data.answerOptions is empty), and the matchup is unlocked. This mirrors
 * the new fast-submit path where option generation happens off submitAnswers;
 * getGuessSheet must lazily ensure the opponent's options exist before reading.
 */
const buildUnlockedScenarioWithoutOptions = (
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
    players: [makePlayer(ME), makePlayer(OPPONENT), makePlayer("c")],
    currentWeek: {
      id: WEEK_ID,
      status: "open" as WeekStatus,
      questions: QUESTION_IDS.map((qid, index) => makeQuestion(qid, index)),
    },
    matchups: [
      {
        id: MATCHUP_ID,
        weekId: WEEK_ID,
        playerAId: ME,
        playerBId: OPPONENT,
        answeredBy: [ME, OPPONENT],
        // Guessing unlocked: both have answered.
        guessingUnlockedAt: FIXED_NOW,
      },
    ],
    byePlayerIds: [],
    answers: seeded.map((s) => s.answer),
    // Deliberately EMPTY — options must be generated lazily on read.
    answerOptions: [],
    guesses: [],
    ...overrides,
  };
};

describe("gameService.getGuessSheet: lazy option generation", () => {
  it("generates the opponent's options on read when answerOptions is empty", async () => {
    const data = buildUnlockedScenarioWithoutOptions();
    const service = createMockGameService(data, fixedDeps());

    const sheet = await service.getGuessSheet(ME, WEEK_ID);

    expect(sheet).toHaveLength(EXPECTED_SHEET_ITEMS);
    for (const item of sheet) {
      // Each item carries the 4 lazily-generated options.
      expect(item.options).toHaveLength(OPTIONS_PER_ANSWER);
    }
    // The options were persisted into the store as a side effect.
    expect(data.answerOptions?.length ?? 0).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getGuessSheet: guards
// ---------------------------------------------------------------------------

describe("gameService.getGuessSheet: guards", () => {
  it("rejects when weekId is not the current week", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    await expect(
      service.getGuessSheet(ME, "some-other-week"),
    ).rejects.toThrow();
  });

  it("rejects a player on a bye", async () => {
    const service = createMockGameService(
      buildUnlockedScenario({ byePlayerIds: ["c"] }),
      fixedDeps(),
    );

    await expect(service.getGuessSheet("c", WEEK_ID)).rejects.toThrow();
  });

  it("rejects when guessing is not unlocked (only one participant answered)", async () => {
    const service = createMockGameService(
      buildUnlockedScenario({
        matchups: [matchup(MATCHUP_ID, ME, OPPONENT, [ME])],
      }),
      fixedDeps(),
    );

    await expect(service.getGuessSheet(ME, WEEK_ID)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// submitGuess: correctness computation
// ---------------------------------------------------------------------------

describe("gameService.submitGuess: correctness", () => {
  it("returns correct=true when the chosen option is the real (correct) one", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    const correctOptionId = "seed-b-q1-opt-0"; // index 0 is the real answer

    const result = await service.submitGuess(ME, WEEK_ID, "q1", correctOptionId);

    expect(result.correct).toBe(true);
    expect(result.questionId).toBe("q1");
    expect(result.realAnswerText).toBe(OPPONENT_ANSWERS["q1"].real);
  });

  it("returns correct=false when the chosen option is a distractor", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    const distractorOptionId = "seed-b-q2-opt-1"; // a distractor

    const result = await service.submitGuess(
      ME,
      WEEK_ID,
      "q2",
      distractorOptionId,
    );

    expect(result.correct).toBe(false);
    expect(result.questionId).toBe("q2");
    // realAnswerText is always the opponent's real answer, never the distractor.
    expect(result.realAnswerText).toBe(OPPONENT_ANSWERS["q2"].real);
  });
});

// ---------------------------------------------------------------------------
// submitGuess: persistence
// ---------------------------------------------------------------------------

describe("gameService.submitGuess: persistence", () => {
  it("appends a StoredGuess with the right fields to data.guesses", async () => {
    const data = buildUnlockedScenario();
    const service = createMockGameService(data, fixedDeps());

    await service.submitGuess(ME, WEEK_ID, "q1", "seed-b-q1-opt-0");

    const guesses = data.guesses ?? [];
    expect(guesses).toHaveLength(1);
    const stored: StoredGuess = guesses[0];
    expect(stored).toEqual({
      id: `guess-${MATCHUP_ID}-${ME}-q1`,
      matchupId: MATCHUP_ID,
      questionId: "q1",
      guesserId: ME,
      chosenOptionId: "seed-b-q1-opt-0",
      isCorrect: true,
      submittedAt: FIXED_NOW,
    });
  });

  it("records isCorrect=false for an incorrect guess", async () => {
    const data = buildUnlockedScenario();
    const service = createMockGameService(data, fixedDeps());

    await service.submitGuess(ME, WEEK_ID, "q2", "seed-b-q2-opt-2");

    const guesses = data.guesses ?? [];
    expect(guesses[0].isCorrect).toBe(false);
    expect(guesses[0].chosenOptionId).toBe("seed-b-q2-opt-2");
  });
});

// ---------------------------------------------------------------------------
// submitGuess: guards
// ---------------------------------------------------------------------------

describe("gameService.submitGuess: guards", () => {
  it("rejects a second guess for an already-guessed question", async () => {
    const data = buildUnlockedScenario();
    const service = createMockGameService(data, fixedDeps());

    await service.submitGuess(ME, WEEK_ID, "q1", "seed-b-q1-opt-0");

    await expect(
      service.submitGuess(ME, WEEK_ID, "q1", "seed-b-q1-opt-1"),
    ).rejects.toThrow();
  });

  it("rejects an option id that does not belong to the question", async () => {
    const service = createMockGameService(buildUnlockedScenario(), fixedDeps());

    await expect(
      service.submitGuess(ME, WEEK_ID, "q1", "not-a-real-option"),
    ).rejects.toThrow();
  });

  it("rejects when guessing is not unlocked", async () => {
    const service = createMockGameService(
      buildUnlockedScenario({
        matchups: [matchup(MATCHUP_ID, ME, OPPONENT, [ME])],
      }),
      fixedDeps(),
    );

    await expect(
      service.submitGuess(ME, WEEK_ID, "q1", "seed-b-q1-opt-0"),
    ).rejects.toThrow();
  });
});
