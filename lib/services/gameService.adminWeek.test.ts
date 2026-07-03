/**
 * Tests for the admin-week methods on GameService:
 *   getDraftQuestions, updateDraftQuestion, regenerateQuestion, approveWeek.
 *
 * ============================================================
 * CONTRACT DECISIONS (code-writer must match exactly)
 * ============================================================
 *
 * 1. GameServiceData shape extension — `draftWeek`:
 *
 *      draftWeek?: {
 *        id: string;
 *        status: "awaiting_approval";
 *        questions: Question[];
 *      }
 *
 *    - Absent initially; created by getDraftQuestions() on first call.
 *    - getDraftQuestions() is IDEMPOTENT: a second call with the same weekId
 *      returns the same questions and does NOT invoke the generator again.
 *    - A call with a DIFFERENT weekId replaces the entire draft week.
 *    - approveWeek() promotes draftWeek → currentWeek (status "open"),
 *      sets questionsApprovedAt (ISO timestamp string) on the week object,
 *      runs computePairing over presentPlayerIds (or all players when absent),
 *      REPLACES data.matchups and data.byePlayerIds with the new results.
 *    - approveWeek() idempotent: if currentWeek.id === weekId and
 *      currentWeek.status === "open", it is a no-op (no throw, matchups stable).
 *
 * 2. GameServiceDeps extension — `questions`:
 *
 *      questions?: QuestionGenerator   // from @/lib/ai
 *
 *    Defaults to stubQuestionGenerator when absent.
 *    Tests inject a fake generator (makeFakeGenerator) returning predictable
 *    numbered prompts so assertions are exact.
 *
 * 3. Constants referenced here:
 *    - WEEKLY_QUESTION_COUNT = 4  (from @/lib/types)
 *    - DRAFT_WEEK_ID = "week-draft-2026-26"  (upcoming week id used in tests)
 *    - OPEN_STATUS = "open"
 *    - AWAITING_STATUS = "awaiting_approval"
 *
 * 4. questionsApprovedAt field:
 *    The draftWeek (or the promoted currentWeek after approveWeek) gains a
 *    `questionsApprovedAt?: string` field (ISO timestamp). GameServiceData's
 *    GameServiceWeek type must be extended to include this optional field.
 *    Tests assert it is a non-empty string after approveWeek.
 *
 * 5. Matchup id pattern (consistent with openWeek):
 *    `matchup-${weekId}-${playerAId}-${playerBId}`
 *
 * ============================================================
 */

import { describe, it, expect, vi } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type { Player, Question, WeekStatus } from "@/lib/types";
import { WEEKLY_QUESTION_COUNT, UPCOMING_WEEK_ID } from "@/lib/types";
import type { QuestionGenerator } from "@/lib/ai";
import { stubQuestionGenerator } from "@/lib/ai";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** The upcoming week id used as the draft week under test. */
const DRAFT_WEEK_ID = "week-draft-2026-26";

/** The current (already-open) week id used in baseline scenarios. */
const CURRENT_WEEK_ID = "week-current-2026-25";

/** A week id that has no corresponding draft — for "no draft" error cases. */
const UNKNOWN_WEEK_ID = "week-unknown-9999";

const OPEN_STATUS: WeekStatus = "open";
const AWAITING_STATUS: WeekStatus = "awaiting_approval";

/** Order indices that the four draft questions must carry. */
const EXPECTED_ORDER_INDICES = [0, 1, 2, 3];

/** Even present-player count for "no bye" scenarios. */
const EVEN_PLAYER_COUNT = 4;

/** Odd present-player count for "one bye" scenarios. */
const ODD_PLAYER_COUNT = 3;

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

const makeQuestion = (id: string, orderIndex: number, text = `Question ${id}`): Question => ({
  id,
  orderIndex,
  text,
});

type ServiceData = Parameters<typeof createMockGameService>[0];

/**
 * Baseline scenario: a current open week, no draft week yet.
 * Tests that exercise admin methods supply a DRAFT_WEEK_ID distinct from
 * CURRENT_WEEK_ID so the two week objects coexist cleanly.
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
    status: OPEN_STATUS,
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
// Fake / spy question generator
// ---------------------------------------------------------------------------

/**
 * Builds a deterministic fake QuestionGenerator.
 * Returns prompts of the form "Fake question 0", "Fake question 1", … for
 * the requested count, sliced from a fixed pool.
 * Wraps the implementation in a vi.fn() so call counts are observable.
 */
const makeFakeGenerator = (): QuestionGenerator & { generateQuestions: ReturnType<typeof vi.fn> } => {
  const FAKE_POOL = Array.from({ length: 20 }, (_, i) => `Fake question ${i}`);

  return {
    generateQuestions: vi.fn(async (count: number): Promise<string[]> => {
      return FAKE_POOL.slice(0, count);
    }),
  };
};

/**
 * A regenerating fake that always returns a prompt that differs from current
 * content by appending a generation number. Used for regenerateQuestion tests.
 */
const makeCountingGenerator = () => {
  let callCount = 0;
  return {
    generateQuestions: vi.fn(async (count: number): Promise<string[]> => {
      callCount += 1;
      return Array.from({ length: count }, (_, i) => `Gen${callCount} question ${i}`);
    }),
  };
};

// ---------------------------------------------------------------------------
// getDraftQuestions
// ---------------------------------------------------------------------------

describe("gameService.getDraftQuestions: interface", () => {
  it("exposes getDraftQuestions on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof service.getDraftQuestions).toBe("function");
  });
});

describe("gameService.getDraftQuestions: creates draft when absent", () => {
  it("resolves to an array of exactly WEEKLY_QUESTION_COUNT questions", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);

    expect(questions).toHaveLength(WEEKLY_QUESTION_COUNT);
  });

  it("questions have orderIndex values 0, 1, 2, 3 (sorted ascending)", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);

    expect(questions.map((q) => q.orderIndex)).toEqual(EXPECTED_ORDER_INDICES);
  });

  it("question texts come from the injected generator output", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);

    // The generator returns ["Fake question 0", …, "Fake question 3"]
    expect(questions.map((q) => q.text)).toEqual([
      "Fake question 0",
      "Fake question 1",
      "Fake question 2",
      "Fake question 3",
    ]);
  });

  it("each question has a non-empty string id", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);

    for (const question of questions) {
      expect(typeof question.id).toBe("string");
      expect(question.id.length).toBeGreaterThan(0);
    }
  });

  it("question ids are distinct", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);
    const ids = questions.map((q) => q.id);

    expect(new Set(ids).size).toBe(WEEKLY_QUESTION_COUNT);
  });

  it("calls the generator exactly once on first call", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);

    expect(gen.generateQuestions).toHaveBeenCalledTimes(1);
  });

  it("calls the generator with WEEKLY_QUESTION_COUNT", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);

    expect(gen.generateQuestions).toHaveBeenCalledWith(WEEKLY_QUESTION_COUNT);
  });
});

describe("gameService.getDraftQuestions: idempotency", () => {
  it("returns the same questions on a second call with the same weekId", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const first = await service.getDraftQuestions(DRAFT_WEEK_ID);
    const second = await service.getDraftQuestions(DRAFT_WEEK_ID);

    expect(second).toEqual(first);
  });

  it("does NOT call the generator again on the second call (generator called once total)", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.getDraftQuestions(DRAFT_WEEK_ID);

    expect(gen.generateQuestions).toHaveBeenCalledTimes(1);
  });

  it("replaces the draft when called with a different weekId", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    const newWeekId = "week-draft-2026-27";
    const newQuestions = await service.getDraftQuestions(newWeekId);

    // New set is still WEEKLY_QUESTION_COUNT items (a fresh draft).
    expect(newQuestions).toHaveLength(WEEKLY_QUESTION_COUNT);
    // Generator was called a second time for the new week.
    expect(gen.generateQuestions).toHaveBeenCalledTimes(2);
  });
});

describe("gameService.getDraftQuestions: awaiting_approval status", () => {
  it("sets the draft week status to 'awaiting_approval'", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario();
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);

    // The draft week is reflected in data.draftWeek.
    expect(data.draftWeek).toBeDefined();
    expect(data.draftWeek!.status).toBe(AWAITING_STATUS);
  });

  it("sets the draft week id to the requested weekId", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario();
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);

    expect(data.draftWeek!.id).toBe(DRAFT_WEEK_ID);
  });
});

// ---------------------------------------------------------------------------
// updateDraftQuestion
// ---------------------------------------------------------------------------

describe("gameService.updateDraftQuestion: interface", () => {
  it("exposes updateDraftQuestion on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof service.updateDraftQuestion).toBe("function");
  });
});

describe("gameService.updateDraftQuestion: happy path", () => {
  it("updates the text of the matching question and returns the full question list", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);
    const targetId = questions[0].id;
    const newText = "Updated question text";

    const updated = await service.updateDraftQuestion(targetId, newText);

    const target = updated.find((q) => q.id === targetId);
    expect(target?.text).toBe(newText);
  });

  it("returns a list of exactly WEEKLY_QUESTION_COUNT questions", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);
    const updated = await service.updateDraftQuestion(questions[0].id, "New text");

    expect(updated).toHaveLength(WEEKLY_QUESTION_COUNT);
  });

  it("leaves all other questions unchanged", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);
    const targetId = questions[0].id;
    const originalOthers = questions.filter((q) => q.id !== targetId);

    const updated = await service.updateDraftQuestion(targetId, "New text");
    const updatedOthers = updated.filter((q) => q.id !== targetId);

    expect(updatedOthers).toEqual(originalOthers);
  });

  it("returned list is sorted by orderIndex ascending", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);
    const updated = await service.updateDraftQuestion(questions[2].id, "Changed");

    expect(updated.map((q) => q.orderIndex)).toEqual(EXPECTED_ORDER_INDICES);
  });
});

describe("gameService.updateDraftQuestion: error cases", () => {
  it("throws when questionId is unknown (not in draft)", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);

    await expect(
      service.updateDraftQuestion("q-does-not-exist", "Some text"),
    ).rejects.toThrow();
  });

  it("throws when text is an empty string", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);

    await expect(
      service.updateDraftQuestion(questions[0].id, ""),
    ).rejects.toThrow();
  });

  it("throws when text is whitespace-only", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);

    await expect(
      service.updateDraftQuestion(questions[0].id, "   "),
    ).rejects.toThrow();
  });

  it("throws when no draft week exists yet", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    // No getDraftQuestions call — draft is absent.
    await expect(
      service.updateDraftQuestion("any-id", "Some text"),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// regenerateQuestion
// ---------------------------------------------------------------------------

describe("gameService.regenerateQuestion: interface", () => {
  it("exposes regenerateQuestion on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof service.regenerateQuestion).toBe("function");
  });
});

describe("gameService.regenerateQuestion: happy path", () => {
  it("changes the target question text to something different from the original", async () => {
    const gen = makeCountingGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);
    const targetId = questions[1].id;
    const originalText = questions[1].text;

    const updated = await service.regenerateQuestion(targetId);

    const target = updated.find((q) => q.id === targetId);
    expect(target?.text).not.toBe(originalText);
  });

  it("leaves all other questions unchanged", async () => {
    const gen = makeCountingGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);
    const targetId = questions[1].id;
    const originalOthers = questions
      .filter((q) => q.id !== targetId)
      .map((q) => ({ id: q.id, text: q.text, orderIndex: q.orderIndex }));

    const updated = await service.regenerateQuestion(targetId);
    const updatedOthers = updated
      .filter((q) => q.id !== targetId)
      .map((q) => ({ id: q.id, text: q.text, orderIndex: q.orderIndex }));

    expect(updatedOthers).toEqual(originalOthers);
  });

  it("returns a list of exactly WEEKLY_QUESTION_COUNT questions", async () => {
    const gen = makeCountingGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);
    const updated = await service.regenerateQuestion(questions[0].id);

    expect(updated).toHaveLength(WEEKLY_QUESTION_COUNT);
  });

  it("returned list is sorted by orderIndex ascending", async () => {
    const gen = makeCountingGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);
    const updated = await service.regenerateQuestion(questions[0].id);

    expect(updated.map((q) => q.orderIndex)).toEqual(EXPECTED_ORDER_INDICES);
  });

  it("the regenerated text is a non-empty string", async () => {
    const gen = makeCountingGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    const questions = await service.getDraftQuestions(DRAFT_WEEK_ID);
    const targetId = questions[0].id;

    const updated = await service.regenerateQuestion(targetId);
    const target = updated.find((q) => q.id === targetId);

    expect(typeof target?.text).toBe("string");
    expect(target!.text.trim().length).toBeGreaterThan(0);
  });
});

describe("gameService.regenerateQuestion: error cases", () => {
  it("throws when questionId is unknown (not in draft)", async () => {
    const gen = makeCountingGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);

    await expect(
      service.regenerateQuestion("q-does-not-exist"),
    ).rejects.toThrow();
  });

  it("throws when no draft week exists yet", async () => {
    const gen = makeCountingGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    // No getDraftQuestions call — draft is absent.
    await expect(
      service.regenerateQuestion("any-id"),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// approveWeek
// ---------------------------------------------------------------------------

describe("gameService.approveWeek: interface", () => {
  it("exposes approveWeek on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof service.approveWeek).toBe("function");
  });
});

describe("gameService.approveWeek: promotes draft to currentWeek", () => {
  it("sets currentWeek.id to the approved weekId", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.currentWeek.id).toBe(DRAFT_WEEK_ID);
  });

  it("sets currentWeek.status to 'open' after approval", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.currentWeek.status).toBe(OPEN_STATUS);
  });

  it("sets questionsApprovedAt to a non-empty ISO timestamp string", async () => {
    const gen = makeFakeGenerator();
    const NOW_STUB = "2026-06-25T12:00:00.000Z";
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
    });
    const service = createMockGameService(data, {
      questions: gen,
      now: () => NOW_STUB,
    });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.currentWeek.questionsApprovedAt).toBe(NOW_STUB);
  });

  it("currentWeek.questions are the draft questions", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
    });
    const service = createMockGameService(data, { questions: gen });

    const draftQuestions = await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.currentWeek.questions).toEqual(draftQuestions);
  });
});

describe("gameService.approveWeek: even player count — full pairing, no bye", () => {
  it("creates matchups covering all EVEN_PLAYER_COUNT present players", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [makePlayer("p1"), makePlayer("p2"), makePlayer("p3"), makePlayer("p4")],
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    const participants = data.matchups.flatMap((m) => [m.playerAId, m.playerBId]);
    expect(new Set(participants)).toEqual(new Set(["p1", "p2", "p3", "p4"]));
  });

  it("produces exactly EVEN_PLAYER_COUNT / 2 matchups for an even present count", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.matchups).toHaveLength(EVEN_PLAYER_COUNT / 2);
  });

  it("leaves byePlayerIds empty for an even present count", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.byePlayerIds).toHaveLength(0);
  });
});

describe("gameService.approveWeek: odd player count — exactly one bye", () => {
  it("records exactly one byePlayerId for an ODD_PLAYER_COUNT present count", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [makePlayer("p1"), makePlayer("p2"), makePlayer("p3")],
      presentPlayerIds: ["p1", "p2", "p3"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.byePlayerIds).toHaveLength(1);
  });

  it("bye player does NOT appear in any matchup", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [makePlayer("p1"), makePlayer("p2"), makePlayer("p3")],
      presentPlayerIds: ["p1", "p2", "p3"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    const [byeId] = data.byePlayerIds;
    const participants = data.matchups.flatMap((m) => [m.playerAId, m.playerBId]);
    expect(participants).not.toContain(byeId);
  });

  it("byePlayerIds and matchup participants are disjoint", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [makePlayer("p1"), makePlayer("p2"), makePlayer("p3")],
      presentPlayerIds: ["p1", "p2", "p3"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    const matchupSet = new Set(
      data.matchups.flatMap((m) => [m.playerAId, m.playerBId]),
    );
    for (const byeId of data.byePlayerIds) {
      expect(matchupSet.has(byeId)).toBe(false);
    }
  });

  it("creates (ODD_PLAYER_COUNT - 1) / 2 matchups for an odd present count", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [makePlayer("p1"), makePlayer("p2"), makePlayer("p3")],
      presentPlayerIds: ["p1", "p2", "p3"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.matchups).toHaveLength((ODD_PLAYER_COUNT - 1) / 2);
  });
});

describe("gameService.approveWeek: replaces existing matchups/byes", () => {
  it("replaces data.matchups (old matchups from currentWeek are gone)", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
      matchups: [
        {
          id: "old-matchup",
          weekId: CURRENT_WEEK_ID,
          playerAId: "p1",
          playerBId: "p2",
          answeredBy: [],
        },
      ],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    const oldMatchupStillPresent = data.matchups.some((m) => m.id === "old-matchup");
    expect(oldMatchupStillPresent).toBe(false);
  });

  it("replaces data.byePlayerIds with the freshly computed byes", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [makePlayer("p1"), makePlayer("p2"), makePlayer("p3")],
      presentPlayerIds: ["p1", "p2", "p3"],
      byePlayerIds: ["old-bye-player"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.byePlayerIds).not.toContain("old-bye-player");
  });
});

describe("gameService.approveWeek: defaults to all players when presentPlayerIds absent", () => {
  it("pairs all roster players when presentPlayerIds is not set", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario();
    // No presentPlayerIds — service should use all players (p1, p2, p3, p4)
    delete data.presentPlayerIds;
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    const participants = data.matchups.flatMap((m) => [m.playerAId, m.playerBId]);
    expect(new Set(participants)).toEqual(new Set(["p1", "p2", "p3", "p4"]));
  });
});

describe("gameService.approveWeek: error cases", () => {
  it("throws when there is no draft week for the requested weekId", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    // No getDraftQuestions call — draft is absent.
    await expect(service.approveWeek(UNKNOWN_WEEK_ID)).rejects.toThrow();
  });

  it("throws when a draft exists but for a DIFFERENT weekId", async () => {
    const gen = makeFakeGenerator();
    const service = createMockGameService(buildScenario(), { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);

    // Approve with a different id than the draft's id.
    await expect(service.approveWeek(UNKNOWN_WEEK_ID)).rejects.toThrow();
  });
});

describe("gameService.approveWeek: idempotency", () => {
  it("is a no-op (does not throw) when called again after the week is already open", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    await expect(service.approveWeek(DRAFT_WEEK_ID)).resolves.toBeUndefined();
  });

  it("matchups are stable (no re-randomization) on a second approveWeek call", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      presentPlayerIds: ["p1", "p2", "p3", "p4"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    const matchupsAfterFirst = data.matchups.map((m) => ({ ...m }));

    await service.approveWeek(DRAFT_WEEK_ID);

    expect(data.matchups).toEqual(matchupsAfterFirst);
  });
});

// ---------------------------------------------------------------------------
// approveWeek + getMyWeek integration
// ---------------------------------------------------------------------------

describe("gameService.approveWeek: reflected in getMyWeek", () => {
  it("getMyWeek returns a non-null opponent for a paired present player after approveWeek", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [makePlayer("p1"), makePlayer("p2")],
      presentPlayerIds: ["p1", "p2"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    const view = await service.getMyWeek("p1");
    expect(view.isBye).toBe(false);
    expect(view.opponent).not.toBeNull();
  });

  it("getMyWeek returns isBye===true for the bye player after approveWeek", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [makePlayer("p1"), makePlayer("p2"), makePlayer("p3")],
      presentPlayerIds: ["p1", "p2", "p3"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    const [byeId] = data.byePlayerIds;
    const view = await service.getMyWeek(byeId);
    expect(view.isBye).toBe(true);
  });

  it("getMyWeek reflects the new weekId from the approved draft", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [makePlayer("p1"), makePlayer("p2")],
      presentPlayerIds: ["p1", "p2"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    const view = await service.getMyWeek("p1");
    expect(view.weekId).toBe(DRAFT_WEEK_ID);
  });

  it("getMyWeek shows status 'open' for the approved week", async () => {
    const gen = makeFakeGenerator();
    const data = buildScenario({
      players: [makePlayer("p1"), makePlayer("p2")],
      presentPlayerIds: ["p1", "p2"],
    });
    const service = createMockGameService(data, { questions: gen });

    await service.getDraftQuestions(DRAFT_WEEK_ID);
    await service.approveWeek(DRAFT_WEEK_ID);

    const view = await service.getMyWeek("p1");
    expect(view.status).toBe(OPEN_STATUS);
  });
});

// ---------------------------------------------------------------------------
// REGRESSION: regenerateQuestion duplicate-text bug (slice 06)
//
// Bug: regenerateQuestion picks the first generated candidate that differs from
// the target slot's OWN current text, but does NOT check the other questions
// already in the draft. With the real stubQuestionGenerator (which returns
// CANNED_QUESTIONS.slice(0, count) deterministically), the seeded draft holds
// CANNED_QUESTIONS[0..3]. Regenerating slot 0 picks CANNED_QUESTIONS[1] —
// which slot 1 already holds — producing two identical questions in the draft.
// Repeated regeneration of the same slot bounces between indices 0 and 1,
// remaining stuck and always colliding with an occupied slot.
//
// These tests use the REAL stubQuestionGenerator (injected explicitly so the
// deterministic pool is guaranteed) — NOT the counting generator, which masks
// the bug by returning unique "Gen<N> question <i>" strings per call.
//
// Intended invariant: after any regenerateQuestion call the draft always has
// WEEKLY_QUESTION_COUNT questions with DISTINCT texts.
// ---------------------------------------------------------------------------

describe("regenerateQuestion regression: no duplicate texts using real stubQuestionGenerator", () => {
  it("regenerating the FIRST slot produces WEEKLY_QUESTION_COUNT distinct question texts", async () => {
    // Uses UPCOMING_WEEK_ID from @/lib/types as the draft week id, and the
    // real stubQuestionGenerator to trigger the deterministic bug.
    const service = createMockGameService(
      buildScenario(),
      { questions: stubQuestionGenerator },
    );

    const initialQuestions = await service.getDraftQuestions(UPCOMING_WEEK_ID);
    const firstSlotId = initialQuestions[0].id;
    const originalFirstText = initialQuestions[0].text;

    const updatedQuestions = await service.regenerateQuestion(firstSlotId);

    // The slot must ACTUALLY regenerate (guards against a no-op satisfying the
    // distinctness assertion below) — under the real stub the new text differs.
    const regeneratedFirstText = updatedQuestions.find(
      (q) => q.id === firstSlotId,
    )!.text;
    expect(regeneratedFirstText).not.toBe(originalFirstText);

    // Primary invariant: no two questions in the draft share the same text.
    const texts = updatedQuestions.map((q) => q.text);
    const uniqueTexts = new Set(texts);
    expect(uniqueTexts.size).toBe(WEEKLY_QUESTION_COUNT);
  });

  it("regenerating the FIRST slot yields a text not already held by any other slot", async () => {
    const service = createMockGameService(
      buildScenario(),
      { questions: stubQuestionGenerator },
    );

    const initialQuestions = await service.getDraftQuestions(UPCOMING_WEEK_ID);
    const firstSlotId = initialQuestions[0].id;

    // Collect the texts of all OTHER slots before regeneration.
    const otherTextsBeforeRegen = initialQuestions
      .filter((q) => q.id !== firstSlotId)
      .map((q) => q.text);

    const updatedQuestions = await service.regenerateQuestion(firstSlotId);
    const regeneratedText = updatedQuestions.find((q) => q.id === firstSlotId)!.text;

    // The regenerated text must not collide with any currently occupied slot.
    expect(otherTextsBeforeRegen).not.toContain(regeneratedText);
  });

  it("regenerating the SAME slot twice in a row keeps all draft texts distinct after the first regeneration", async () => {
    const service = createMockGameService(
      buildScenario(),
      { questions: stubQuestionGenerator },
    );

    const initialQuestions = await service.getDraftQuestions(UPCOMING_WEEK_ID);
    const firstSlotId = initialQuestions[0].id;

    // First regeneration.
    const afterFirst = await service.regenerateQuestion(firstSlotId);
    const textsAfterFirst = afterFirst.map((q) => q.text);
    expect(new Set(textsAfterFirst).size).toBe(WEEKLY_QUESTION_COUNT);
  });

  it("regenerating the SAME slot twice in a row keeps all draft texts distinct after the second regeneration", async () => {
    const service = createMockGameService(
      buildScenario(),
      { questions: stubQuestionGenerator },
    );

    const initialQuestions = await service.getDraftQuestions(UPCOMING_WEEK_ID);
    const firstSlotId = initialQuestions[0].id;

    // First regeneration.
    await service.regenerateQuestion(firstSlotId);
    // Second regeneration of the same slot.
    const afterSecond = await service.regenerateQuestion(firstSlotId);

    const textsAfterSecond = afterSecond.map((q) => q.text);
    expect(new Set(textsAfterSecond).size).toBe(WEEKLY_QUESTION_COUNT);
  });

  it("regenerating the SAME slot three times in a row keeps all draft texts distinct after the third regeneration", async () => {
    const service = createMockGameService(
      buildScenario(),
      { questions: stubQuestionGenerator },
    );

    const initialQuestions = await service.getDraftQuestions(UPCOMING_WEEK_ID);
    const firstSlotId = initialQuestions[0].id;

    // Three consecutive regenerations of the same slot.
    await service.regenerateQuestion(firstSlotId);
    await service.regenerateQuestion(firstSlotId);
    const afterThird = await service.regenerateQuestion(firstSlotId);

    const textsAfterThird = afterThird.map((q) => q.text);
    expect(new Set(textsAfterThird).size).toBe(WEEKLY_QUESTION_COUNT);
  });

  it("after regenerating every slot once, all WEEKLY_QUESTION_COUNT draft texts remain distinct", async () => {
    const service = createMockGameService(
      buildScenario(),
      { questions: stubQuestionGenerator },
    );

    const initialQuestions = await service.getDraftQuestions(UPCOMING_WEEK_ID);

    // Regenerate every slot sequentially (order matches orderIndex ascending).
    let latestQuestions = initialQuestions;
    for (const question of initialQuestions) {
      latestQuestions = await service.regenerateQuestion(question.id);
    }

    const texts = latestQuestions.map((q) => q.text);
    expect(new Set(texts).size).toBe(WEEKLY_QUESTION_COUNT);
  });
});
