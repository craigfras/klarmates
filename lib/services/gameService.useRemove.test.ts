/**
 * Tests for the admin-facing useSuggestion + removeSuggestion write paths on
 * GameService (question-suggestions slices 3 & 4 — mock implementation).
 *
 * ============================================================
 * CONTRACT DECISIONS (code-writer must match exactly)
 * ============================================================
 *
 * These reuse the existing `StoredSuggestion` store type and the `draftWeek`
 * scenario field established by gameService.suggest.test.ts /
 * gameService.adminWeek.test.ts. Both new methods live on the GameService
 * interface + createMockGameService.
 *
 * 1. useSuggestion(suggestionId: string, draftQuestionId: string):
 *      Promise<Question[]>
 *
 *    Behaviour:
 *      - Locate the suggestion in `data.suggestions` by id.
 *      - Locate the draft question in `data.draftWeek.questions` by id — the
 *        SAME lookup `updateDraftQuestion` uses.
 *      - Overwrite the target draft slot's `text` with the SUGGESTION's text
 *        (a snapshot copy).
 *      - HARD-DELETE the suggestion from `data.suggestions` (length drops by
 *        one; a follow-up `listSuggestions()` must NOT contain it).
 *      - Return the draft questions sorted by orderIndex ascending (same shape
 *        as `updateDraftQuestion`), with the chosen slot showing the new text.
 *      - THROW (reject) AND make NO mutation when ANY of these is true, each
 *        tested INDEPENDENTLY (only one bad input at a time so the order of
 *        internal checks does not matter):
 *          (a) unknown suggestion id
 *          (b) unknown draft question id
 *          (c) absent draft week (`data.draftWeek` undefined)
 *      - PERMANENCE: after a successful use, a later `updateDraftQuestion` or
 *        `regenerateQuestion` on that same slot does NOT resurrect the
 *        suggestion — it stays gone from `listSuggestions`.
 *
 * 2. removeSuggestion(suggestionId: string): Promise<void>
 *
 *    Behaviour:
 *      - HARD-DELETE the matching entry from `data.suggestions` (length drops
 *        by one; `listSuggestions()` no longer contains it).
 *      - Does NOT touch `data.draftWeek` (draft question texts unchanged).
 *      - THROW (reject) on unknown id and make NO mutation.
 *
 * ============================================================
 */

import { describe, it, expect } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type { Player, Question, StoredSuggestion, WeekStatus } from "@/lib/types";
import { WEEKLY_QUESTION_COUNT } from "@/lib/types";
import type { QuestionGenerator } from "@/lib/ai";
import { vi } from "vitest";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** The upcoming week id used as the draft week under test. */
const DRAFT_WEEK_ID = "week-draft-2026-26";

/** The current (already-open) week id used in baseline scenarios. */
const CURRENT_WEEK_ID = "week-current-2026-25";

const OPEN_STATUS: WeekStatus = "open";
const AWAITING_STATUS: WeekStatus = "awaiting_approval";

/** Suggester ids. */
const ADA_ID = "player-ada";
const BOB_ID = "player-bob";
const ADA_NAME = "Ada Lovelace";
const BOB_NAME = "Bob Bobson";

/** Seeded suggestion ids + texts. */
const SUG_A_ID = "sug-a";
const SUG_B_ID = "sug-b";
const SUG_A_TEXT = "What is the best advice you ever got?";
const SUG_B_TEXT = "What was your very first job?";

const SUG_A_CREATED = "2026-07-02T09:30:00.000Z";
const SUG_B_CREATED = "2026-07-01T08:00:00.000Z";

/** An id that matches NO seeded suggestion. */
const UNKNOWN_SUGGESTION_ID = "sug-does-not-exist";

/** An id that matches NO draft question. */
const UNKNOWN_QUESTION_ID = "q-does-not-exist";

/** Expected pool sizes. */
const TWO_SUGGESTIONS = 2;
const ONE_SUGGESTION = 1;

/** Draft slot order indices. */
const EXPECTED_ORDER_INDICES = [0, 1, 2, 3];

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
  text = `Draft question ${id}`,
): Question => ({
  id,
  orderIndex,
  text,
});

const makeStored = (
  id: string,
  text: string,
  suggestedById: string,
  createdAt: string,
): StoredSuggestion => ({ id, text, suggestedById, createdAt });

type ServiceData = Parameters<typeof createMockGameService>[0];

/**
 * A deterministic fake QuestionGenerator so regenerateQuestion can run in the
 * permanence test. Wrapped in vi.fn so behaviour is predictable.
 */
const makeCountingGenerator = (): QuestionGenerator => {
  let callCount = 0;
  return {
    generateQuestions: vi.fn(async (count: number): Promise<string[]> => {
      callCount += 1;
      return Array.from({ length: count }, (_, i) => `Gen${callCount} question ${i}`);
    }),
  };
};

/**
 * Baseline scenario: a current open week PLUS a seeded draft week (status
 * awaiting_approval) holding WEEKLY_QUESTION_COUNT draft questions, and a
 * two-entry standing suggestion pool. Tests override fields as needed.
 */
const buildScenario = (overrides: Partial<ServiceData> = {}): ServiceData => ({
  players: [
    makePlayer(ADA_ID, { name: ADA_NAME }),
    makePlayer(BOB_ID, { name: BOB_NAME }),
  ],
  currentWeek: {
    id: CURRENT_WEEK_ID,
    status: OPEN_STATUS,
    questions: [makeQuestion("cur-q1", 0)],
  },
  draftWeek: {
    id: DRAFT_WEEK_ID,
    status: AWAITING_STATUS,
    questions: [
      makeQuestion("draft-q0", 0),
      makeQuestion("draft-q1", 1),
      makeQuestion("draft-q2", 2),
      makeQuestion("draft-q3", 3),
    ],
  },
  matchups: [],
  byePlayerIds: [],
  suggestions: [
    makeStored(SUG_A_ID, SUG_A_TEXT, ADA_ID, SUG_A_CREATED),
    makeStored(SUG_B_ID, SUG_B_TEXT, BOB_ID, SUG_B_CREATED),
  ],
  ...overrides,
});

/** Reads the suggestions array off the (mutated-in-place) data object. */
const readSuggestions = (data: ServiceData): StoredSuggestion[] =>
  (data as { suggestions?: StoredSuggestion[] }).suggestions ?? [];

/** Reads the current draft-week questions off the data object. */
const readDraftQuestions = (data: ServiceData): Question[] =>
  (data as { draftWeek?: { questions: Question[] } }).draftWeek?.questions ?? [];

// ===========================================================================
// useSuggestion
// ===========================================================================

describe("gameService.useSuggestion: interface", () => {
  it("exposes useSuggestion on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(
      typeof (service as unknown as { useSuggestion: unknown }).useSuggestion,
    ).toBe("function");
  });
});

describe("gameService.useSuggestion: happy path", () => {
  it("overwrites the target draft slot text with the suggestion text", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    const updated = await service.useSuggestion(SUG_A_ID, "draft-q1");

    const target = updated.find((q) => q.id === "draft-q1");
    expect(target?.text).toBe(SUG_A_TEXT);
  });

  it("returns a list of exactly WEEKLY_QUESTION_COUNT questions", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    const updated = await service.useSuggestion(SUG_A_ID, "draft-q1");

    expect(updated).toHaveLength(WEEKLY_QUESTION_COUNT);
  });

  it("returns questions sorted by orderIndex ascending", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    const updated = await service.useSuggestion(SUG_A_ID, "draft-q2");

    expect(updated.map((q) => q.orderIndex)).toEqual(EXPECTED_ORDER_INDICES);
  });

  it("leaves the OTHER draft slots unchanged", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);
    const originalOthers = readDraftQuestions(data)
      .filter((q) => q.id !== "draft-q1")
      .map((q) => ({ id: q.id, text: q.text, orderIndex: q.orderIndex }));

    const updated = await service.useSuggestion(SUG_A_ID, "draft-q1");
    const updatedOthers = updated
      .filter((q) => q.id !== "draft-q1")
      .map((q) => ({ id: q.id, text: q.text, orderIndex: q.orderIndex }));

    expect(updatedOthers).toEqual(originalOthers);
  });

  it("hard-deletes the used suggestion from data.suggestions (length drops by one)", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await service.useSuggestion(SUG_A_ID, "draft-q1");

    expect(readSuggestions(data)).toHaveLength(ONE_SUGGESTION);
    expect(readSuggestions(data).some((s) => s.id === SUG_A_ID)).toBe(false);
  });

  it("removes the used suggestion from a follow-up listSuggestions()", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await service.useSuggestion(SUG_A_ID, "draft-q1");
    const listed = await service.listSuggestions();

    expect(listed.some((s) => s.id === SUG_A_ID)).toBe(false);
    expect(listed).toHaveLength(ONE_SUGGESTION);
  });

  it("leaves the OTHER suggestion in the pool untouched", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await service.useSuggestion(SUG_A_ID, "draft-q1");

    expect(readSuggestions(data).some((s) => s.id === SUG_B_ID)).toBe(true);
  });
});

describe("gameService.useSuggestion: error cases (each in isolation, no mutation)", () => {
  it("throws on an unknown suggestion id (draft + draftQuestionId otherwise valid)", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await expect(
      service.useSuggestion(UNKNOWN_SUGGESTION_ID, "draft-q1"),
    ).rejects.toThrow();
  });

  it("does NOT mutate the pool or the draft when the suggestion id is unknown", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);
    const draftTextBefore = readDraftQuestions(data).find(
      (q) => q.id === "draft-q1",
    )!.text;

    await expect(
      service.useSuggestion(UNKNOWN_SUGGESTION_ID, "draft-q1"),
    ).rejects.toThrow();

    // Pool intact, both suggestions still present.
    expect(readSuggestions(data)).toHaveLength(TWO_SUGGESTIONS);
    expect(readSuggestions(data).some((s) => s.id === SUG_A_ID)).toBe(true);
    // Draft slot text unchanged.
    expect(readDraftQuestions(data).find((q) => q.id === "draft-q1")!.text).toBe(
      draftTextBefore,
    );
  });

  it("throws on an unknown draft question id (suggestion id valid)", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await expect(
      service.useSuggestion(SUG_A_ID, UNKNOWN_QUESTION_ID),
    ).rejects.toThrow();
  });

  it("does NOT delete the suggestion when the draft question id is unknown", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await expect(
      service.useSuggestion(SUG_A_ID, UNKNOWN_QUESTION_ID),
    ).rejects.toThrow();

    expect(readSuggestions(data)).toHaveLength(TWO_SUGGESTIONS);
    expect(readSuggestions(data).some((s) => s.id === SUG_A_ID)).toBe(true);
  });

  it("throws when there is no draft week (data.draftWeek absent, suggestion id valid)", async () => {
    const data = buildScenario();
    delete (data as { draftWeek?: unknown }).draftWeek;
    const service = createMockGameService(data);

    await expect(
      service.useSuggestion(SUG_A_ID, "draft-q1"),
    ).rejects.toThrow();
  });

  it("does NOT delete the suggestion when there is no draft week", async () => {
    const data = buildScenario();
    delete (data as { draftWeek?: unknown }).draftWeek;
    const service = createMockGameService(data);

    await expect(
      service.useSuggestion(SUG_A_ID, "draft-q1"),
    ).rejects.toThrow();

    expect(readSuggestions(data)).toHaveLength(TWO_SUGGESTIONS);
    expect(readSuggestions(data).some((s) => s.id === SUG_A_ID)).toBe(true);
  });
});

describe("gameService.useSuggestion: permanence (removal survives later slot edits)", () => {
  it("a later updateDraftQuestion on the same slot does NOT resurrect the used suggestion", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await service.useSuggestion(SUG_A_ID, "draft-q1");
    await service.updateDraftQuestion("draft-q1", "A totally new edit");

    const listed = await service.listSuggestions();
    expect(listed.some((s) => s.id === SUG_A_ID)).toBe(false);
    expect(readSuggestions(data).some((s) => s.id === SUG_A_ID)).toBe(false);
  });

  it("a later regenerateQuestion on the same slot does NOT resurrect the used suggestion", async () => {
    const gen = makeCountingGenerator();
    const data = buildScenario();
    const service = createMockGameService(data, { questions: gen });

    await service.useSuggestion(SUG_A_ID, "draft-q1");
    await service.regenerateQuestion("draft-q1");

    const listed = await service.listSuggestions();
    expect(listed.some((s) => s.id === SUG_A_ID)).toBe(false);
    expect(readSuggestions(data).some((s) => s.id === SUG_A_ID)).toBe(false);
  });
});

// ===========================================================================
// removeSuggestion
// ===========================================================================

describe("gameService.removeSuggestion: interface", () => {
  it("exposes removeSuggestion on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(
      typeof (service as unknown as { removeSuggestion: unknown }).removeSuggestion,
    ).toBe("function");
  });
});

describe("gameService.removeSuggestion: happy path", () => {
  it("hard-deletes the matching entry from data.suggestions (length drops by one)", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await service.removeSuggestion(SUG_A_ID);

    expect(readSuggestions(data)).toHaveLength(ONE_SUGGESTION);
    expect(readSuggestions(data).some((s) => s.id === SUG_A_ID)).toBe(false);
  });

  it("removes the suggestion from a follow-up listSuggestions()", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await service.removeSuggestion(SUG_B_ID);
    const listed = await service.listSuggestions();

    expect(listed.some((s) => s.id === SUG_B_ID)).toBe(false);
    expect(listed).toHaveLength(ONE_SUGGESTION);
  });

  it("leaves the OTHER suggestion in the pool untouched", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await service.removeSuggestion(SUG_A_ID);

    expect(readSuggestions(data).some((s) => s.id === SUG_B_ID)).toBe(true);
  });

  it("does NOT touch the draft week (draft question texts unchanged)", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);
    const draftTextsBefore = readDraftQuestions(data).map((q) => ({
      id: q.id,
      text: q.text,
      orderIndex: q.orderIndex,
    }));

    await service.removeSuggestion(SUG_A_ID);

    const draftTextsAfter = readDraftQuestions(data).map((q) => ({
      id: q.id,
      text: q.text,
      orderIndex: q.orderIndex,
    }));
    expect(draftTextsAfter).toEqual(draftTextsBefore);
  });
});

describe("gameService.removeSuggestion: error cases", () => {
  it("throws on an unknown suggestion id", async () => {
    const service = createMockGameService(buildScenario());

    await expect(
      service.removeSuggestion(UNKNOWN_SUGGESTION_ID),
    ).rejects.toThrow();
  });

  it("does NOT mutate the pool when the id is unknown", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await expect(
      service.removeSuggestion(UNKNOWN_SUGGESTION_ID),
    ).rejects.toThrow();

    expect(readSuggestions(data)).toHaveLength(TWO_SUGGESTIONS);
  });
});
