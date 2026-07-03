/**
 * Tests for the admin-facing listSuggestions read path on the
 * Postgres-backed dbGameService (question-suggestions slice 2).
 *
 * ============================================================
 * CONTRACT DECISIONS (code-writer must match exactly)
 * ============================================================
 *
 *   listSuggestions(): Promise<QuestionSuggestion[]>
 *
 *   - Calls `prisma.questionSuggestion.findMany` EXACTLY once with:
 *
 *       { include: { suggestedBy: true }, orderBy: { createdAt: "desc" } }
 *
 *     (join the Player relation for the suggester name; DB does the
 *     newest-first ordering.)
 *   - Maps each returned row
 *       { id, text, createdAt: Date, suggestedBy: { name } }
 *     to the view type
 *       { id, text, suggestedByName: row.suggestedBy.name, createdAt: <ISO> }
 *     where `createdAt` is the ISO string form of the row's Date
 *     (`row.createdAt.toISOString()`) — mirroring how other db-service reads
 *     convert Date → ISO (e.g. `startsAt.toISOString()` in getMyWeek).
 *   - Week-agnostic: no `requireCurrentSeason` / season / week lookup. The fake
 *     below therefore only models `questionSuggestion.findMany`.
 *   - Returns `[]` when findMany returns `[]`.
 *
 * ============================================================
 * APPROACH
 * ============================================================
 *
 * Mirrors dbGameService.suggest.test.ts: the DB client seam (`getPrisma` from
 * @/lib/db/client) is mocked to return a minimal fake exposing only the surface
 * listSuggestions touches (`questionSuggestion.findMany` as a vi.fn). The
 * service is imported AFTER vi.mock so the mocked getPrisma is in place, and a
 * module-level holder lets each test install a fresh fake.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

const ADA_NAME = "Ada Lovelace";
const BOB_NAME = "Bob Bobson";

const TEXT_NEW = "What's the best advice you ever got?";
const TEXT_OLD = "What was your first job?";

/** Distinct createdAt Dates, newest-first as the DB would return them. */
const DATE_NEW = new Date("2026-07-02T09:30:00.000Z");
const DATE_OLD = new Date("2026-07-01T08:00:00.000Z");

const TWO_ROWS = 2;

// ---------------------------------------------------------------------------
// Types for the fake rows (row shape findMany returns with the include join)
// ---------------------------------------------------------------------------

type FakeRow = {
  id: string;
  text: string;
  suggestedById: string;
  createdAt: Date;
  suggestedBy: { name: string };
};

// ---------------------------------------------------------------------------
// Minimal Prisma fake — only the questionSuggestion.findMany surface.
// Each test seeds `rows` before calling the service.
// ---------------------------------------------------------------------------

const makeFakePrisma = (rows: FakeRow[]) => {
  const findMany = vi.fn(async () => rows);
  return {
    questionSuggestion: { findMany },
  };
};

// ---------------------------------------------------------------------------
// Mock the DB client seam. A module-level holder lets each test install a
// fresh fake while the hoisted mock factory closes over it.
// ---------------------------------------------------------------------------

let fakePrisma: ReturnType<typeof makeFakePrisma>;

vi.mock("@/lib/db/client", () => ({
  getPrisma: () => fakePrisma,
}));

const TWO_ROW_FIXTURE: FakeRow[] = [
  {
    id: "sug-new",
    text: TEXT_NEW,
    suggestedById: "player-ada",
    createdAt: DATE_NEW,
    suggestedBy: { name: ADA_NAME },
  },
  {
    id: "sug-old",
    text: TEXT_OLD,
    suggestedById: "player-bob",
    createdAt: DATE_OLD,
    suggestedBy: { name: BOB_NAME },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("dbGameService.listSuggestions", () => {
  beforeEach(() => {
    fakePrisma = makeFakePrisma([]);
  });

  it("calls questionSuggestion.findMany with the include + orderBy shape", async () => {
    fakePrisma = makeFakePrisma(TWO_ROW_FIXTURE);
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await service.listSuggestions();

    expect(fakePrisma.questionSuggestion.findMany).toHaveBeenCalledTimes(1);
    expect(fakePrisma.questionSuggestion.findMany).toHaveBeenCalledWith({
      include: { suggestedBy: true },
      orderBy: { createdAt: "desc" },
    });
  });

  it("maps each row to { id, text, suggestedByName, createdAt } in order", async () => {
    fakePrisma = makeFakePrisma(TWO_ROW_FIXTURE);
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    const result = await service.listSuggestions();

    expect(result).toHaveLength(TWO_ROWS);
    expect(result[0].id).toBe("sug-new");
    expect(result[0].text).toBe(TEXT_NEW);
    expect(result[0].suggestedByName).toBe(ADA_NAME);
    expect(result[1].id).toBe("sug-old");
    expect(result[1].suggestedByName).toBe(BOB_NAME);
  });

  it("resolves suggestedByName from the joined suggestedBy.name relation", async () => {
    fakePrisma = makeFakePrisma(TWO_ROW_FIXTURE);
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    const result = await service.listSuggestions();

    expect(result.map((s) => s.suggestedByName)).toEqual([ADA_NAME, BOB_NAME]);
  });

  it("converts the row Date createdAt to its ISO string form", async () => {
    fakePrisma = makeFakePrisma(TWO_ROW_FIXTURE);
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    const result = await service.listSuggestions();

    // Mirrors startsAt.toISOString() Date→ISO conversion elsewhere in the service.
    expect(typeof result[0].createdAt).toBe("string");
    expect(result[0].createdAt.length).toBeGreaterThan(0);
    expect(result[0].createdAt).toBe(DATE_NEW.toISOString());
    expect(result[1].createdAt).toBe(DATE_OLD.toISOString());
  });

  it("returns [] when findMany returns no rows", async () => {
    fakePrisma = makeFakePrisma([]);
    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    const result = await service.listSuggestions();

    expect(result).toEqual([]);
  });
});
