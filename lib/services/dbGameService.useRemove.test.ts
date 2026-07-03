/**
 * Tests for the admin-facing useSuggestion + removeSuggestion write paths on
 * dbGameService (question-suggestions slices 3 & 4 — DB implementation).
 *
 * ============================================================
 * CONTRACT DECISIONS (code-writer must match exactly)
 * ============================================================
 *
 * Mirrors updateDraftQuestion's draft-week-by-status resolution exactly:
 *   requireCurrentSeason() → getDraftWeek (week.findFirst awaiting_approval,
 *   then draft_questions) → question.findFirst({ id, weekId: draft.id }).
 *
 * 1. useSuggestion(suggestionId, draftQuestionId): Promise<Question[]>
 *      - requireCurrentSeason().
 *      - Resolve the draft week by status (awaiting_approval, then
 *        draft_questions) via `week.findFirst`. Throw when absent.
 *      - Verify the suggestion exists:
 *        `questionSuggestion.findUnique({ where: { id: suggestionId } })`.
 *        Throw when missing.
 *      - Verify the draft question belongs to the draft week:
 *        `question.findFirst({ where: { id: draftQuestionId, weekId: draft.id } })`.
 *        Throw when missing.
 *      - In a `prisma.$transaction`:
 *          * `question.update({ where: { id: draftQuestionId },
 *              data: { text: <suggestion.text> } })`
 *          * `questionSuggestion.delete({ where: { id: suggestionId } })`
 *      - Return the refreshed draft questions:
 *        `question.findMany({ where: { weekId: draft.id },
 *           orderBy: { orderIndex: "asc" } })` mapped to Question[].
 *
 * 2. removeSuggestion(suggestionId): Promise<void>
 *      - `questionSuggestion.delete({ where: { id: suggestionId } })`.
 *      - When the row is missing Prisma throws a P2025-shaped error
 *        (`{ code: "P2025" }`); the service surfaces a clear rejection.
 *
 * ============================================================
 * APPROACH
 * ============================================================
 *
 * Mirrors dbGameService.pairing.test.ts: a minimal STATEFUL in-memory Prisma
 * fake wired via `vi.mock("@/lib/db/client")` → getPrisma. The fake implements
 * ONLY the surface these two methods touch. `$transaction(fn)` runs `fn(tx)`
 * with a tx client exposing the write methods (mirroring pairing.test.ts).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

const SEASON_ID = "season-1";
const DRAFT_WEEK_ID = "week-draft-1";

const STATUS_AWAITING = "awaiting_approval" as const;

/** Seeded draft questions on the draft week. */
const DRAFT_Q0_ID = "draft-q0";
const DRAFT_Q1_ID = "draft-q1";
const DRAFT_Q0_TEXT = "Draft question 0 text?";
const DRAFT_Q1_TEXT = "Draft question 1 text?";

/** Seeded suggestion. */
const SUGGESTION_ID = "sug-1";
const SUGGESTION_TEXT = "What is the best advice you ever got?";

/** Ids that match nothing. */
const UNKNOWN_SUGGESTION_ID = "sug-nope";
const UNKNOWN_QUESTION_ID = "draft-q-nope";

const EXPECTED_DRAFT_COUNT = 2;

// ---------------------------------------------------------------------------
// In-memory stateful Prisma fake
//
// Only the surface useSuggestion / removeSuggestion touch:
//   season.findFirst, week.findFirst (by status), question.findFirst,
//   question.update, question.findMany, questionSuggestion.findUnique,
//   questionSuggestion.delete, $transaction.
// ---------------------------------------------------------------------------

type QuestionRow = {
  id: string;
  weekId: string;
  orderIndex: number;
  text: string;
};

type SuggestionRow = {
  id: string;
  text: string;
  suggestedById: string;
};

type WeekRow = { id: string; seasonId: string; status: string };

const makeFakePrisma = () => {
  const questions: QuestionRow[] = [
    { id: DRAFT_Q0_ID, weekId: DRAFT_WEEK_ID, orderIndex: 0, text: DRAFT_Q0_TEXT },
    { id: DRAFT_Q1_ID, weekId: DRAFT_WEEK_ID, orderIndex: 1, text: DRAFT_Q1_TEXT },
  ];

  const suggestions: SuggestionRow[] = [
    { id: SUGGESTION_ID, text: SUGGESTION_TEXT, suggestedById: "player-ada" },
  ];

  const weeks: WeekRow[] = [
    { id: DRAFT_WEEK_ID, seasonId: SEASON_ID, status: STATUS_AWAITING },
  ];

  const fake = {
    // --- exposed stores for assertions ---
    _questions: questions,
    _suggestions: suggestions,

    // --- season ---
    season: {
      // requireCurrentSeason: { where: { isCurrent: true } }
      findFirst: async () => ({ id: SEASON_ID, isCurrent: true }),
    },

    // --- week ---
    week: {
      // getDraftWeek: findFirst by { seasonId, status }
      findFirst: async (args: { where: { seasonId: string; status?: string } }) => {
        const { status } = args.where;
        return weeks.find((w) => w.status === status) ?? null;
      },
    },

    // --- question ---
    question: {
      // verify slot belongs to the draft week: { id, weekId }
      findFirst: async (args: { where: { id: string; weekId?: string } }) => {
        const { id, weekId } = args.where;
        return (
          questions.find(
            (q) => q.id === id && (weekId === undefined || q.weekId === weekId),
          ) ?? null
        );
      },
      // refreshed read: { where: { weekId }, orderBy: { orderIndex: "asc" } }
      findMany: async (args: { where: { weekId: string } }) =>
        questions
          .filter((q) => q.weekId === args.where.weekId)
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((q) => ({ ...q })),
      // tx write: overwrite the slot text
      update: async (args: {
        where: { id: string };
        data: { text?: string };
      }) => {
        const row = questions.find((q) => q.id === args.where.id);
        if (!row) {
          throw Object.assign(new Error("Question not found"), { code: "P2025" });
        }
        if (args.data.text !== undefined) row.text = args.data.text;
        return { ...row };
      },
    },

    // --- questionSuggestion ---
    questionSuggestion: {
      // existence check before use: findUnique({ where: { id } })
      findUnique: async (args: { where: { id: string } }) =>
        suggestions.find((s) => s.id === args.where.id)
          ? { ...suggestions.find((s) => s.id === args.where.id)! }
          : null,
      // hard delete (use tx + remove flow). Missing → P2025-shaped throw.
      delete: async (args: { where: { id: string } }) => {
        const idx = suggestions.findIndex((s) => s.id === args.where.id);
        if (idx === -1) {
          throw Object.assign(
            new Error("Record to delete does not exist."),
            { code: "P2025" },
          );
        }
        const [removed] = suggestions.splice(idx, 1);
        return { ...removed };
      },
    },

    // --- transaction: pass the same fake as tx (exposes update + delete) ---
    $transaction: async (fn: (tx: unknown) => Promise<unknown>, _opts?: unknown) =>
      fn(fake),
  };

  return fake;
};

// ---------------------------------------------------------------------------
// Mock the DB client seam.
// ---------------------------------------------------------------------------

let fakePrisma: ReturnType<typeof makeFakePrisma>;

vi.mock("@/lib/db/client", () => ({
  getPrisma: () => fakePrisma,
}));

// ===========================================================================
// useSuggestion
// ===========================================================================

describe("dbGameService.useSuggestion: happy path", () => {
  beforeEach(() => {
    fakePrisma = makeFakePrisma();
  });

  it("overwrites the target draft slot text with the suggestion text", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    const updated = await service.useSuggestion(SUGGESTION_ID, DRAFT_Q1_ID);

    const target = updated.find((q) => q.id === DRAFT_Q1_ID);
    expect(target?.text).toBe(SUGGESTION_TEXT);
    // The persisted row was actually updated.
    expect(
      fakePrisma._questions.find((q) => q.id === DRAFT_Q1_ID)!.text,
    ).toBe(SUGGESTION_TEXT);
  });

  it("hard-deletes the suggestion row (delete called with the suggestion id)", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    const deleteSpy = vi.spyOn(fakePrisma.questionSuggestion, "delete");

    await service.useSuggestion(SUGGESTION_ID, DRAFT_Q1_ID);

    expect(deleteSpy).toHaveBeenCalledWith({ where: { id: SUGGESTION_ID } });
    expect(fakePrisma._suggestions.some((s) => s.id === SUGGESTION_ID)).toBe(false);
  });

  it("returns the refreshed draft questions sorted by orderIndex ascending", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    const updated = await service.useSuggestion(SUGGESTION_ID, DRAFT_Q0_ID);

    expect(updated).toHaveLength(EXPECTED_DRAFT_COUNT);
    expect(updated.map((q) => q.orderIndex)).toEqual([0, 1]);
    expect(updated.find((q) => q.id === DRAFT_Q0_ID)!.text).toBe(SUGGESTION_TEXT);
  });

  it("leaves the OTHER draft slot unchanged", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    const updated = await service.useSuggestion(SUGGESTION_ID, DRAFT_Q0_ID);

    expect(updated.find((q) => q.id === DRAFT_Q1_ID)!.text).toBe(DRAFT_Q1_TEXT);
  });
});

describe("dbGameService.useSuggestion: error cases", () => {
  beforeEach(() => {
    fakePrisma = makeFakePrisma();
  });

  it("throws when the suggestion is missing (and does NOT update the slot)", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await expect(
      service.useSuggestion(UNKNOWN_SUGGESTION_ID, DRAFT_Q1_ID),
    ).rejects.toThrow();

    expect(fakePrisma._questions.find((q) => q.id === DRAFT_Q1_ID)!.text).toBe(
      DRAFT_Q1_TEXT,
    );
  });

  it("throws when the draft question does not belong to the draft week (and does NOT delete the suggestion)", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await expect(
      service.useSuggestion(SUGGESTION_ID, UNKNOWN_QUESTION_ID),
    ).rejects.toThrow();

    expect(fakePrisma._suggestions.some((s) => s.id === SUGGESTION_ID)).toBe(true);
  });

  it("throws when there is no draft week", async () => {
    // A fake with NO draft/awaiting week — week.findFirst returns null.
    fakePrisma = {
      ...makeFakePrisma(),
      week: {
        findFirst: async () => null,
      },
    } as unknown as ReturnType<typeof makeFakePrisma>;

    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await expect(
      service.useSuggestion(SUGGESTION_ID, DRAFT_Q1_ID),
    ).rejects.toThrow();
  });
});

// ===========================================================================
// removeSuggestion
// ===========================================================================

describe("dbGameService.removeSuggestion: happy path", () => {
  beforeEach(() => {
    fakePrisma = makeFakePrisma();
  });

  it("deletes the suggestion row by id", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    const deleteSpy = vi.spyOn(fakePrisma.questionSuggestion, "delete");

    await service.removeSuggestion(SUGGESTION_ID);

    expect(deleteSpy).toHaveBeenCalledWith({ where: { id: SUGGESTION_ID } });
    expect(fakePrisma._suggestions.some((s) => s.id === SUGGESTION_ID)).toBe(false);
  });

  it("resolves to undefined (void) on success", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await expect(service.removeSuggestion(SUGGESTION_ID)).resolves.toBeUndefined();
  });
});

describe("dbGameService.removeSuggestion: error cases", () => {
  beforeEach(() => {
    fakePrisma = makeFakePrisma();
  });

  it("rejects when the suggestion row is missing (P2025 surfaced as a clear error)", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await expect(
      service.removeSuggestion(UNKNOWN_SUGGESTION_ID),
    ).rejects.toThrow();
  });
});
