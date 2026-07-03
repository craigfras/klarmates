/**
 * REGRESSION TESTS — Slack-ID backfill silently does nothing.
 *
 * ============================================================
 * THE BUG (confirmed via live diagnostics)
 * ============================================================
 *
 * Players in the DB carry `slack_user_id = ""` (empty string), NOT `null`.
 * Two defects in lib/services/dbGameService.ts combine so that the admin
 * "sync Slack IDs" action resolves nobody:
 *
 *   BUG 1 — backfillSlackIds (~line 1810)
 *     Queries only NULL rows:
 *       where: { active: true, slackUserId: null }
 *     Empty-string ids are excluded, so active players with
 *     `slackUserId === ""` are never resolved. The fix must treat BOTH
 *     `null` and `""` as unlinked, e.g.
 *       where: { active: true, OR: [{ slackUserId: null }, { slackUserId: "" }] }
 *
 *   BUG 2 — upsertPlayer (~lines 1760-1777)
 *     Persists `slackUserId: player.slackUserId ?? null` in create AND update.
 *     `??` only catches null/undefined, so an empty (or whitespace-only) form
 *     value is stored as `""` — re-seeding the very state Bug 1 can't resolve.
 *     The fix must normalise empty/whitespace to null, e.g.
 *       player.slackUserId?.trim() || null
 *     so "", "   ", null, undefined all become null; a real id is preserved
 *     (trimmed).
 *
 * ============================================================
 * APPROACH
 * ============================================================
 *
 * Follows the prisma-mock precedent in dbGameService.pairing.test.ts: the DB
 * client seam (`getPrisma` from @/lib/db/client) is mocked with a small
 * stateful in-memory fake that HONOURS the actual `where` clause passed to it.
 * Because the fake filters exactly as Prisma would, an `""` player is only
 * returned by findMany once the query includes the empty-string branch —
 * driving the assertion through behaviour rather than coupling to the literal
 * `where` shape.
 *
 * `resolveSlackIdByEmail` from @/lib/slack is mocked (per
 * gameService.backfillSlackIds.test.ts, which exercises the same seam) so the
 * network is never touched and each email maps to a deterministic id.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Player } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** Slack id resolved for the empty-string player fixture. */
const RESOLVED_ID_EMPTY = "U_EMPTY";

/** Slack id resolved for the null player fixture. */
const RESOLVED_ID_NULL = "U_NULL";

/** A real, already-linked slack id — must never be looked up or overwritten. */
const EXISTING_ID = "U_LINKED";

/** Expected updated count when exactly one unlinked player is resolved. */
const EXPECTED_UPDATED_ONE = 1;

/** upsert fixture: a real slack id, and the same id wrapped in whitespace. */
const REAL_SLACK_ID = "U123";
const REAL_SLACK_ID_PADDED = "  U123  ";

/** The normalised value every empty/whitespace slack id must persist as. */
const NORMALISED_EMPTY = null;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

/** A DB player ROW as Prisma returns it (slackUserId is `string | null`). */
type PlayerRow = {
  id: string;
  name: string;
  email: string;
  slackUserId: string | null;
  isAdmin: boolean;
  active: boolean;
  createdAt: Date;
};

const makeRow = (
  id: string,
  overrides: Partial<PlayerRow> = {},
): PlayerRow => ({
  id,
  name: `Player ${id}`,
  email: `${id}@example.com`,
  slackUserId: null,
  isAdmin: false,
  active: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  ...overrides,
});

/** A Player INPUT for upsertPlayer (slackUserId is optional on the domain type). */
const makeInput = (overrides: Partial<Player> = {}): Player => ({
  id: "p-upsert",
  name: "Upsert Player",
  email: "upsert@example.com",
  isAdmin: false,
  active: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Stateful in-memory Prisma fake
//
// Honours the `where` clause exactly as Prisma would so backfill behaviour is
// driven through the query, not coupled to its literal shape. Tracks upsert
// calls so upsertPlayer's persisted data can be asserted directly.
// ---------------------------------------------------------------------------

type WhereCond = { active?: boolean; slackUserId?: string | null };
type PlayerWhere = WhereCond & { OR?: WhereCond[] };

/** True when a row satisfies a single (AND-ed) condition object. */
const matchesCond = (row: PlayerRow, cond: WhereCond): boolean =>
  Object.entries(cond).every(([key, value]) => {
    if (key === "slackUserId") return row.slackUserId === value;
    return (row as unknown as Record<string, unknown>)[key] === value;
  });

/** True when a row satisfies a Prisma-style where (top-level AND, optional OR). */
const matchesWhere = (row: PlayerRow, where: PlayerWhere): boolean => {
  const { OR, ...rest } = where;
  if (!matchesCond(row, rest)) return false;
  if (OR) return OR.some((cond) => matchesCond(row, cond));
  return true;
};

const makeFakePrisma = (rows: PlayerRow[]) => {
  const players = rows.map((r) => ({ ...r }));

  const upsertCalls: Array<{
    where: { id: string };
    create: { slackUserId: string | null };
    update: { slackUserId: string | null };
  }> = [];

  const updateCalls: Array<{
    where: { id: string };
    data: { slackUserId?: string | null };
  }> = [];

  const fake = {
    // --- exposed spies for assertions ---
    _players: players,
    _upsertCalls: upsertCalls,
    _updateCalls: updateCalls,

    player: {
      // backfillSlackIds: findMany({ where }); listRoster: findMany({ orderBy })
      findMany: async (args?: { where?: PlayerWhere }) => {
        const where = args?.where;
        const result = where
          ? players.filter((p) => matchesWhere(p, where))
          : players;
        return result.map((p) => ({ ...p }));
      },
      // backfillSlackIds: update({ where: { id }, data: { slackUserId } })
      update: async (args: {
        where: { id: string };
        data: { slackUserId?: string | null };
      }) => {
        updateCalls.push(args);
        const row = players.find((p) => p.id === args.where.id);
        if (row && args.data.slackUserId !== undefined) {
          row.slackUserId = args.data.slackUserId;
        }
        return row ? { ...row } : null;
      },
      // upsertPlayer: upsert({ where, create, update })
      upsert: async (args: {
        where: { id: string };
        create: { slackUserId: string | null } & Record<string, unknown>;
        update: { slackUserId: string | null } & Record<string, unknown>;
      }) => {
        upsertCalls.push(args);
        const existing = players.find((p) => p.id === args.where.id);
        if (existing) {
          existing.slackUserId = args.update.slackUserId;
          return { ...existing };
        }
        const created = makeRow(args.where.id, {
          slackUserId: args.create.slackUserId,
        });
        players.push(created);
        return { ...created };
      },
    },
  };

  return fake;
};

// ---------------------------------------------------------------------------
// Mock the seams.
//
// A module-level holder lets each test install a fresh fake while the hoisted
// vi.mock factory closes over the holder. resolveSlackIdByEmail is a vi.fn so
// each test controls what every email resolves to.
// ---------------------------------------------------------------------------

let fakePrisma: ReturnType<typeof makeFakePrisma>;

vi.mock("@/lib/db/client", () => ({
  getPrisma: () => fakePrisma,
}));

const resolveSlackIdByEmail = vi.fn<[string], Promise<string | null>>();

vi.mock("@/lib/slack", () => ({
  resolveSlackIdByEmail: (email: string) => resolveSlackIdByEmail(email),
}));

// ---------------------------------------------------------------------------
// backfillSlackIds — empty-string / null unlinked resolution
// ---------------------------------------------------------------------------

describe("dbGameService.backfillSlackIds: empty-string backfill regression", () => {
  beforeEach(() => {
    resolveSlackIdByEmail.mockReset();
  });

  it('resolves an active player whose slackUserId is "" (currently excluded by the NULL-only where)', async () => {
    fakePrisma = makeFakePrisma([makeRow("p-empty", { slackUserId: "" })]);
    resolveSlackIdByEmail.mockResolvedValue(RESOLVED_ID_EMPTY);

    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    const result = await service.backfillSlackIds();

    // Behaviour-driven: with the fix the "" player is returned by findMany,
    // resolved, and persisted. With the current code findMany's NULL-only
    // where excludes it, so update is never called and updated stays 0.
    expect(result).toEqual({ updated: EXPECTED_UPDATED_ONE });
    expect(fakePrisma._updateCalls).toHaveLength(EXPECTED_UPDATED_ONE);
    expect(fakePrisma._updateCalls[0]).toMatchObject({
      where: { id: "p-empty" },
      data: { slackUserId: RESOLVED_ID_EMPTY },
    });
  });

  it("still resolves an active player whose slackUserId is null (guards against a fix that breaks null)", async () => {
    fakePrisma = makeFakePrisma([makeRow("p-null", { slackUserId: null })]);
    resolveSlackIdByEmail.mockResolvedValue(RESOLVED_ID_NULL);

    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    const result = await service.backfillSlackIds();

    expect(result).toEqual({ updated: EXPECTED_UPDATED_ONE });
    expect(fakePrisma._updateCalls[0]).toMatchObject({
      where: { id: "p-null" },
      data: { slackUserId: RESOLVED_ID_NULL },
    });
  });

  it("skips a player who already has a real slackUserId (no lookup, no update)", async () => {
    fakePrisma = makeFakePrisma([
      makeRow("p-linked", { slackUserId: EXISTING_ID }),
    ]);
    // If the linked player were (wrongly) selected, this would resolve an id
    // and trigger an update — so a non-null default catches an over-broad where.
    resolveSlackIdByEmail.mockResolvedValue("U_SHOULD_NOT_BE_USED");

    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    const result = await service.backfillSlackIds();

    expect(result).toEqual({ updated: 0 });
    expect(resolveSlackIdByEmail).not.toHaveBeenCalled();
    expect(fakePrisma._updateCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// upsertPlayer — slackUserId normalisation
// ---------------------------------------------------------------------------

describe("dbGameService.upsertPlayer: slackUserId normalisation regression", () => {
  beforeEach(() => {
    resolveSlackIdByEmail.mockReset();
  });

  it('normalises an empty-string slackUserId to null in BOTH create and update data', async () => {
    fakePrisma = makeFakePrisma([]);

    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await service.upsertPlayer(makeInput({ slackUserId: "" }));

    expect(fakePrisma._upsertCalls).toHaveLength(1);
    const call = fakePrisma._upsertCalls[0];
    // Current code writes `player.slackUserId ?? null`, so "" is persisted as "".
    expect(call.create.slackUserId).toBe(NORMALISED_EMPTY);
    expect(call.update.slackUserId).toBe(NORMALISED_EMPTY);
  });

  it("normalises a whitespace-only slackUserId to null in BOTH create and update data", async () => {
    fakePrisma = makeFakePrisma([]);

    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await service.upsertPlayer(makeInput({ slackUserId: "   " }));

    const call = fakePrisma._upsertCalls[0];
    expect(call.create.slackUserId).toBe(NORMALISED_EMPTY);
    expect(call.update.slackUserId).toBe(NORMALISED_EMPTY);
  });

  it("preserves a real slackUserId (trimmed) in BOTH create and update data", async () => {
    fakePrisma = makeFakePrisma([]);

    const { createDbGameService } = await import("@/lib/services/dbGameService");
    const service = createDbGameService();

    await service.upsertPlayer(makeInput({ slackUserId: REAL_SLACK_ID_PADDED }));

    const call = fakePrisma._upsertCalls[0];
    expect(call.create.slackUserId).toBe(REAL_SLACK_ID);
    expect(call.update.slackUserId).toBe(REAL_SLACK_ID);
  });
});
