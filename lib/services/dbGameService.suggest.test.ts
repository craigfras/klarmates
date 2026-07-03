/**
 * Tests for the player-facing suggestQuestion write path on the
 * Postgres-backed dbGameService (question-suggestions slice 1).
 *
 * ============================================================
 * CONTRACT DECISIONS (code-writer must match exactly)
 * ============================================================
 *
 *   suggestQuestion(playerId: string, text: string): Promise<void>
 *
 *   - Trim `text`. Throw (reject) on empty / whitespace-only text and make NO
 *     database write in that case (`questionSuggestion.create` is NOT called).
 *   - Otherwise call `prisma.questionSuggestion.create` EXACTLY once with:
 *
 *       { data: { text: <trimmed>, suggestedById: <playerId> } }
 *
 *     No `createdAt` / `id` are passed — Prisma defaults own those columns
 *     (`@default(uuid())` / `@default(now())`).
 *   - Week-agnostic: suggestQuestion does NOT require a current season/week, so
 *     it never touches `season` / `week`. The fake below therefore only models
 *     `questionSuggestion.create`.
 *
 * ============================================================
 * APPROACH
 * ============================================================
 *
 * Mirrors dbGameService.pairing.test.ts: the DB client seam
 * (`getPrisma` from @/lib/db/client) is mocked to return a minimal fake that
 * exposes only the surface suggestQuestion touches (`questionSuggestion.create`
 * as a vi.fn). The service is imported AFTER vi.mock so the mocked getPrisma is
 * in place, and a module-level holder lets each test install a fresh fake.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

const SUGGESTER_ID = "player-ada";
const VALID_TEXT = "What is your favourite programming language?";
const PADDED_TEXT = "  hello  ";
const TRIMMED_TEXT = "hello";

// ---------------------------------------------------------------------------
// Minimal stateful Prisma fake — only the questionSuggestion.create surface.
// ---------------------------------------------------------------------------

const makeFakePrisma = () => {
  const create = vi.fn(
    async (args: { data: { text: string; suggestedById: string } }) => ({
      id: "generated-uuid",
      text: args.data.text,
      suggestedById: args.data.suggestedById,
      createdAt: new Date("2026-07-02T12:00:00.000Z"),
    }),
  );

  return {
    questionSuggestion: { create },
  };
};

// ---------------------------------------------------------------------------
// Mock the DB client seam. A module-level holder lets each test install a
// fresh fake (via beforeEach) while the hoisted mock factory closes over it.
// ---------------------------------------------------------------------------

let fakePrisma: ReturnType<typeof makeFakePrisma>;

vi.mock("@/lib/db/client", () => ({
  getPrisma: () => fakePrisma,
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dbGameService.suggestQuestion", () => {
  beforeEach(() => {
    fakePrisma = makeFakePrisma();
  });

  it("calls questionSuggestion.create exactly once with { text, suggestedById }", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await service.suggestQuestion(SUGGESTER_ID, VALID_TEXT);

    expect(fakePrisma.questionSuggestion.create).toHaveBeenCalledTimes(1);
    expect(fakePrisma.questionSuggestion.create).toHaveBeenCalledWith({
      data: { text: VALID_TEXT, suggestedById: SUGGESTER_ID },
    });
  });

  it("trims the text before persisting", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await service.suggestQuestion(SUGGESTER_ID, PADDED_TEXT);

    expect(fakePrisma.questionSuggestion.create).toHaveBeenCalledTimes(1);
    expect(fakePrisma.questionSuggestion.create).toHaveBeenCalledWith({
      data: { text: TRIMMED_TEXT, suggestedById: SUGGESTER_ID },
    });
  });

  it("rejects on an empty string and does NOT call create", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await expect(service.suggestQuestion(SUGGESTER_ID, "")).rejects.toThrow();

    expect(fakePrisma.questionSuggestion.create).not.toHaveBeenCalled();
  });

  it("rejects on a whitespace-only string and does NOT call create", async () => {
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await expect(
      service.suggestQuestion(SUGGESTER_ID, "   "),
    ).rejects.toThrow();

    expect(fakePrisma.questionSuggestion.create).not.toHaveBeenCalled();
  });
});
