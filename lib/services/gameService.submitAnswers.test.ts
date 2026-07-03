import { describe, it, expect } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type { FixtureMatchup } from "@/lib/fixtures";
import type {
  AnswerSubmission,
  Player,
  Question,
  WeekStatus,
} from "@/lib/types";
import type { DistractorGenerator } from "@/lib/ai";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const WEEK_ID = "week-1";
const FIXED_NOW = "2026-06-24T00:00:00.000Z";
const OPTIONS_PER_ANSWER = 4; // 1 real + 3 distractors
const DISTRACTORS = ["wrong-1", "wrong-2", "wrong-3"];

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

type ServiceData = Parameters<typeof createMockGameService>[0];
type ServiceDeps = NonNullable<Parameters<typeof createMockGameService>[1]>;

const matchup = (
  id: string,
  playerAId: string,
  playerBId: string,
  answeredBy: string[] = [],
): FixtureMatchup => ({ id, weekId: WEEK_ID, playerAId, playerBId, answeredBy });

const buildScenario = (overrides: Partial<ServiceData> = {}): ServiceData => ({
  players: [makePlayer("a"), makePlayer("b"), makePlayer("c")],
  currentWeek: {
    id: WEEK_ID,
    status: "open" as WeekStatus,
    questions: [makeQuestion("q1", 0), makeQuestion("q2", 1)],
  },
  matchups: [],
  byePlayerIds: [],
  answers: [],
  answerOptions: [],
  ...overrides,
});

// A deterministic fake distractor generator so option content is predictable.
const fakeDistractors: DistractorGenerator = {
  generateDistractors: async () => [...DISTRACTORS],
};

const fixedDeps = (overrides: Partial<ServiceDeps> = {}): ServiceDeps => ({
  distractors: fakeDistractors,
  now: () => FIXED_NOW,
  ...overrides,
});

// Submission set that exactly covers the default two-question week.
const validAnswers = (): AnswerSubmission[] => [
  { questionId: "q1", text: "answer one" },
  { questionId: "q2", text: "answer two" },
];

// ---------------------------------------------------------------------------
// interface presence
// ---------------------------------------------------------------------------

describe("gameService.submitAnswers: interface", () => {
  it("exposes submitAnswers on the service", () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b")] }),
      fixedDeps(),
    );
    expect(typeof service.submitAnswers).toBe("function");
  });

  it("exposes ensureAnswerOptions on the service", () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b")] }),
      fixedDeps(),
    );
    expect(typeof service.ensureAnswerOptions).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// rejection: wrong week
// ---------------------------------------------------------------------------

describe("gameService.submitAnswers: week guards", () => {
  it("rejects when weekId does not match the current week", async () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b")] }),
      fixedDeps(),
    );

    await expect(
      service.submitAnswers("a", "some-other-week", validAnswers()),
    ).rejects.toThrow();
  });

  it("rejects when the current week is not open", async () => {
    const service = createMockGameService(
      buildScenario({
        currentWeek: {
          id: WEEK_ID,
          status: "closed",
          questions: [makeQuestion("q1", 0), makeQuestion("q2", 1)],
        },
        matchups: [matchup("m1", "a", "b")],
      }),
      fixedDeps(),
    );

    await expect(
      service.submitAnswers("a", WEEK_ID, validAnswers()),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// rejection: bye / no matchup
// ---------------------------------------------------------------------------

describe("gameService.submitAnswers: eligibility guards", () => {
  it("rejects a player on a bye", async () => {
    const service = createMockGameService(
      buildScenario({
        matchups: [matchup("m1", "a", "b")],
        byePlayerIds: ["c"],
      }),
      fixedDeps(),
    );

    await expect(
      service.submitAnswers("c", WEEK_ID, validAnswers()),
    ).rejects.toThrow();
  });

  it("rejects a player with no matchup this week", async () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b")] }),
      fixedDeps(),
    );

    await expect(
      service.submitAnswers("zzz", WEEK_ID, validAnswers()),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// rejection: already submitted
// ---------------------------------------------------------------------------

describe("gameService.submitAnswers: double-submission guard", () => {
  it("rejects when the player has already submitted", async () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b", ["a"])] }),
      fixedDeps(),
    );

    await expect(
      service.submitAnswers("a", WEEK_ID, validAnswers()),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// rejection: answer-set validation
// ---------------------------------------------------------------------------

describe("gameService.submitAnswers: answer-set validation", () => {
  it("rejects when an answer is missing for a question", async () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b")] }),
      fixedDeps(),
    );

    await expect(
      service.submitAnswers("a", WEEK_ID, [{ questionId: "q1", text: "only one" }]),
    ).rejects.toThrow();
  });

  it("rejects when there is an extra answer for an unknown question", async () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b")] }),
      fixedDeps(),
    );

    await expect(
      service.submitAnswers("a", WEEK_ID, [
        { questionId: "q1", text: "one" },
        { questionId: "q2", text: "two" },
        { questionId: "q-extra", text: "three" },
      ]),
    ).rejects.toThrow();
  });

  it("rejects when a question is answered twice (count matches but coverage does not)", async () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b")] }),
      fixedDeps(),
    );

    await expect(
      service.submitAnswers("a", WEEK_ID, [
        { questionId: "q1", text: "one" },
        { questionId: "q1", text: "dup" },
      ]),
    ).rejects.toThrow();
  });

  it("rejects when any answer text is empty after trimming", async () => {
    const service = createMockGameService(
      buildScenario({ matchups: [matchup("m1", "a", "b")] }),
      fixedDeps(),
    );

    await expect(
      service.submitAnswers("a", WEEK_ID, [
        { questionId: "q1", text: "fine" },
        { questionId: "q2", text: "   " },
      ]),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// success: stored answers
// ---------------------------------------------------------------------------

describe("gameService.submitAnswers: persists stored answers", () => {
  it("appends one StoredAnswer per submitted answer with the deterministic id", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data, fixedDeps());

    await service.submitAnswers("a", WEEK_ID, validAnswers());

    expect(data.answers).toHaveLength(2);
    expect(data.answers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "answer-m1-a-q1",
          matchupId: "m1",
          questionId: "q1",
          playerId: "a",
          text: "answer one",
        }),
        expect.objectContaining({
          id: "answer-m1-a-q2",
          matchupId: "m1",
          questionId: "q2",
          playerId: "a",
          text: "answer two",
        }),
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// success: submitAnswers alone does NOT write options (fast submit path)
// ---------------------------------------------------------------------------

describe("gameService.submitAnswers: no options on the submit path", () => {
  it("writes NO answer options when submitAnswers is called alone", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data, fixedDeps());

    await service.submitAnswers("a", WEEK_ID, validAnswers());

    // Answers are persisted, but option generation is now off the submit path.
    expect(data.answers).toHaveLength(2);
    expect(data.answerOptions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// success: ensureAnswerOptions generates + persists options
// ---------------------------------------------------------------------------

describe("gameService.ensureAnswerOptions", () => {
  it("writes exactly 4 options per answer: real first (isCorrect), then 3 distractors", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data, fixedDeps());

    await service.submitAnswers("a", WEEK_ID, validAnswers());
    await service.ensureAnswerOptions("a", WEEK_ID);

    const answerId = "answer-m1-a-q1";
    const options = (data.answerOptions ?? []).filter(
      (option) => option.answerId === answerId,
    );

    expect(options).toHaveLength(OPTIONS_PER_ANSWER);

    expect(options[0]).toEqual({
      id: `${answerId}-opt-0`,
      text: "answer one",
      isCorrect: true,
      answerId,
    });
    expect(options[1]).toEqual({
      id: `${answerId}-opt-1`,
      text: DISTRACTORS[0],
      isCorrect: false,
      answerId,
    });
    expect(options[2]).toEqual({
      id: `${answerId}-opt-2`,
      text: DISTRACTORS[1],
      isCorrect: false,
      answerId,
    });
    expect(options[3]).toEqual({
      id: `${answerId}-opt-3`,
      text: DISTRACTORS[2],
      isCorrect: false,
      answerId,
    });
  });

  it("writes exactly one correct option per answer", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data, fixedDeps());

    await service.submitAnswers("a", WEEK_ID, validAnswers());
    await service.ensureAnswerOptions("a", WEEK_ID);

    for (const answerId of ["answer-m1-a-q1", "answer-m1-a-q2"]) {
      const correct = (data.answerOptions ?? []).filter(
        (option) => option.answerId === answerId && option.isCorrect,
      );
      expect(correct).toHaveLength(1);
    }
  });

  it("writes 8 total options for a two-question submission", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data, fixedDeps());

    await service.submitAnswers("a", WEEK_ID, validAnswers());
    await service.ensureAnswerOptions("a", WEEK_ID);

    expect(data.answerOptions).toHaveLength(2 * OPTIONS_PER_ANSWER);
  });

  it("is idempotent: calling ensureAnswerOptions twice does NOT duplicate options", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data, fixedDeps());

    await service.submitAnswers("a", WEEK_ID, validAnswers());
    await service.ensureAnswerOptions("a", WEEK_ID);
    await service.ensureAnswerOptions("a", WEEK_ID);

    expect(data.answerOptions).toHaveLength(2 * OPTIONS_PER_ANSWER);
  });

  it("is concurrency-safe: two overlapping calls still produce options exactly once", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data, fixedDeps());

    await service.submitAnswers("a", WEEK_ID, validAnswers());
    await Promise.all([
      service.ensureAnswerOptions("a", WEEK_ID),
      service.ensureAnswerOptions("a", WEEK_ID),
    ]);

    expect(data.answerOptions).toHaveLength(2 * OPTIONS_PER_ANSWER);
  });

  it("is a no-op when the player has no answers this week", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data, fixedDeps());

    // No submitAnswers first — player "a" has no stored answers.
    await expect(
      service.ensureAnswerOptions("a", WEEK_ID),
    ).resolves.toBeUndefined();

    expect(data.answerOptions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// success: answeredBy mutation
// ---------------------------------------------------------------------------

describe("gameService.submitAnswers: answeredBy mutation", () => {
  it("adds the player id to their matchup's answeredBy on the passed-in data", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data, fixedDeps());

    await service.submitAnswers("a", WEEK_ID, validAnswers());

    expect(data.matchups[0].answeredBy).toContain("a");
  });
});

// ---------------------------------------------------------------------------
// success: guessing unlock when both have answered
// ---------------------------------------------------------------------------

describe("gameService.submitAnswers: guessing unlock", () => {
  it("does NOT set guessingUnlockedAt when only one participant has answered", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data, fixedDeps());

    await service.submitAnswers("a", WEEK_ID, validAnswers());

    expect(data.matchups[0].guessingUnlockedAt).toBeUndefined();
  });

  it("sets guessingUnlockedAt to deps.now() when both participants have answered", async () => {
    // Opponent already submitted; this submission completes the pair.
    const data = buildScenario({ matchups: [matchup("m1", "a", "b", ["b"])] });
    const service = createMockGameService(data, fixedDeps());

    await service.submitAnswers("a", WEEK_ID, validAnswers());

    expect(data.matchups[0].guessingUnlockedAt).toBe(FIXED_NOW);
  });

  it("reflects guessingUnlocked === true via getMyWeek once both have answered", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b", ["b"])] });
    const service = createMockGameService(data, fixedDeps());

    await service.submitAnswers("a", WEEK_ID, validAnswers());
    const view = await service.getMyWeek("a");

    expect(view.guessingUnlocked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// success: persistence across calls on the same instance
// ---------------------------------------------------------------------------

describe("gameService.submitAnswers: persistence", () => {
  it("getMyWeek reflects myAnswersSubmitted === true after submitting", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data, fixedDeps());

    expect((await service.getMyWeek("a")).myAnswersSubmitted).toBe(false);

    await service.submitAnswers("a", WEEK_ID, validAnswers());

    expect((await service.getMyWeek("a")).myAnswersSubmitted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// default deps: single-arg factory still works
// ---------------------------------------------------------------------------

describe("gameService.submitAnswers: default deps", () => {
  it("works when called without a deps argument (backward compatible)", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data);

    await expect(
      service.submitAnswers("a", WEEK_ID, validAnswers()),
    ).resolves.toBeUndefined();

    expect(data.matchups[0].answeredBy).toContain("a");
    // Submit NEVER generates options — regardless of whether a distractor dep is
    // injected. With the default (real/stub) generator, submit alone is empty.
    expect(data.answerOptions).toHaveLength(0);
  });

  it("generates options via ensureAnswerOptions with the default distractor generator", async () => {
    const data = buildScenario({ matchups: [matchup("m1", "a", "b")] });
    const service = createMockGameService(data);

    await service.submitAnswers("a", WEEK_ID, validAnswers());
    await service.ensureAnswerOptions("a", WEEK_ID);

    // The default generator (deterministic stub with no GEMINI_API_KEY) yields
    // exactly OPTIONS_PER_ANSWER options through the ensureAnswerOptions path.
    const options = (data.answerOptions ?? []).filter(
      (option) => option.answerId === "answer-m1-a-q1",
    );
    expect(options).toHaveLength(OPTIONS_PER_ANSWER);
  });
});
