/**
 * Tests for the admin-facing listSuggestions read path on GameService
 * (question-suggestions slice 2 — mock implementation).
 *
 * ============================================================
 * CONTRACT DECISIONS (code-writer must match exactly)
 * ============================================================
 *
 * 1. New view/return type in @/lib/types — `QuestionSuggestion`:
 *
 *      export type QuestionSuggestion = {
 *        id: string;
 *        text: string;
 *        suggestedByName: string;
 *        createdAt: string; // ISO 8601
 *      };
 *
 *    The read shape surfaced to the admin UI. The suggester NAME is resolved
 *    server-side (this mock resolves it from `data.players`).
 *
 * 2. New method on the GameService interface + createMockGameService:
 *
 *      listSuggestions(): Promise<QuestionSuggestion[]>
 *
 *    Behaviour:
 *      - Reads the standing pool `data.suggestions ?? []` (a StoredSuggestion[]).
 *      - Maps each StoredSuggestion → QuestionSuggestion:
 *          * `id`        — copied verbatim
 *          * `text`      — copied verbatim
 *          * `createdAt` — copied verbatim
 *          * `suggestedByName` — resolved by matching the stored
 *            `suggestedById` against `data.players` (find where
 *            `player.id === suggestedById`) and using `player.name`.
 *      - NAME FALLBACK: when no player in `data.players` matches the stored
 *        `suggestedById`, `suggestedByName` falls back to the raw
 *        `suggestedById` string.
 *      - NEWEST-FIRST: the returned array is sorted by `createdAt` DESCENDING,
 *        regardless of the insertion order of `data.suggestions`.
 *      - When `data.suggestions` is absent or empty, returns `[]`.
 *      - PURE READ: does NOT mutate `data.suggestions` — the sort is performed
 *        on a copy, so the stored array's order is preserved.
 *
 * ============================================================
 */

import { describe, it, expect } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type {
  Player,
  Question,
  QuestionSuggestion,
  StoredSuggestion,
  WeekStatus,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** Player ids used as suggesters. */
const ADA_ID = "player-ada";
const BOB_ID = "player-bob";

/** Human-readable names attached to the seeded roster. */
const ADA_NAME = "Ada Lovelace";
const BOB_NAME = "Bob Bobson";

/** A suggestedById that intentionally has NO matching player. */
const ORPHAN_ID = "player-ghost";

/** Three DISTINCT createdAt timestamps, oldest → newest. */
const T_OLD = "2026-07-01T08:00:00.000Z";
const T_MID = "2026-07-01T12:00:00.000Z";
const T_NEW = "2026-07-02T09:30:00.000Z";

/** Suggestion texts. */
const TEXT_OLD = "What was your first job?";
const TEXT_MID = "What's your go-to comfort food?";
const TEXT_NEW = "What's the best advice you ever got?";

/** Expected list length for the three-entry pool scenario. */
const THREE_SUGGESTIONS = 3;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

const makePlayer = (
  id: string,
  overrides: Partial<Player> = {},
): Player => ({
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
  text = `Question ${id}`,
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
 * Baseline scenario: a current open week and a roster of named players.
 * Tests override `suggestions` (and `players`) as needed.
 */
const buildScenario = (overrides: Partial<ServiceData> = {}): ServiceData => ({
  players: [
    makePlayer(ADA_ID, { name: ADA_NAME }),
    makePlayer(BOB_ID, { name: BOB_NAME }),
  ],
  currentWeek: {
    id: "week-current",
    status: "open" as WeekStatus,
    questions: [makeQuestion("q1", 0)],
  },
  matchups: [],
  byePlayerIds: [],
  ...overrides,
});

/**
 * A pool of three suggestions seeded OUT OF ORDER (mid, new, old) so tests can
 * assert the service re-sorts newest-first rather than echoing insertion order.
 */
const seedOutOfOrder = (): StoredSuggestion[] => [
  makeStored("sug-mid", TEXT_MID, BOB_ID, T_MID),
  makeStored("sug-new", TEXT_NEW, ADA_ID, T_NEW),
  makeStored("sug-old", TEXT_OLD, ADA_ID, T_OLD),
];

// ---------------------------------------------------------------------------
// interface
// ---------------------------------------------------------------------------

describe("gameService.listSuggestions: interface", () => {
  it("exposes listSuggestions on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(
      typeof (service as unknown as { listSuggestions: unknown }).listSuggestions,
    ).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// mapping — id / text / createdAt verbatim, name resolved from roster
// ---------------------------------------------------------------------------

describe("gameService.listSuggestions: maps stored entries to the view type", () => {
  it("returns one QuestionSuggestion per stored suggestion", async () => {
    const data = buildScenario({
      suggestions: seedOutOfOrder(),
    } as Partial<ServiceData>);
    const service = createMockGameService(data);

    const result = await service.listSuggestions();

    expect(result).toHaveLength(THREE_SUGGESTIONS);
  });

  it("copies id, text and createdAt verbatim from the stored suggestion", async () => {
    const data = buildScenario({
      suggestions: [makeStored("sug-new", TEXT_NEW, ADA_ID, T_NEW)],
    } as Partial<ServiceData>);
    const service = createMockGameService(data);

    const [entry] = await service.listSuggestions();

    expect(entry.id).toBe("sug-new");
    expect(entry.text).toBe(TEXT_NEW);
    expect(entry.createdAt).toBe(T_NEW);
  });

  it("resolves suggestedByName from data.players (matching id → name)", async () => {
    const data = buildScenario({
      suggestions: [
        makeStored("sug-a", TEXT_NEW, ADA_ID, T_NEW),
        makeStored("sug-b", TEXT_MID, BOB_ID, T_MID),
      ],
    } as Partial<ServiceData>);
    const service = createMockGameService(data);

    const result = await service.listSuggestions();
    const byId = new Map(result.map((s: QuestionSuggestion) => [s.id, s]));

    expect(byId.get("sug-a")!.suggestedByName).toBe(ADA_NAME);
    expect(byId.get("sug-b")!.suggestedByName).toBe(BOB_NAME);
  });
});

// ---------------------------------------------------------------------------
// newest-first ordering — sorted by createdAt descending regardless of input
// ---------------------------------------------------------------------------

describe("gameService.listSuggestions: newest-first ordering", () => {
  it("returns entries sorted by createdAt DESCENDING regardless of insertion order", async () => {
    const data = buildScenario({
      suggestions: seedOutOfOrder(), // seeded mid, new, old
    } as Partial<ServiceData>);
    const service = createMockGameService(data);

    const result = await service.listSuggestions();
    const orderedIds = result.map((s: QuestionSuggestion) => s.id);

    expect(orderedIds).toEqual(["sug-new", "sug-mid", "sug-old"]);
  });

  it("returns createdAt values in strictly descending order", async () => {
    const data = buildScenario({
      suggestions: seedOutOfOrder(),
    } as Partial<ServiceData>);
    const service = createMockGameService(data);

    const result = await service.listSuggestions();
    const times = result.map((s: QuestionSuggestion) => s.createdAt);

    expect(times).toEqual([T_NEW, T_MID, T_OLD]);
  });
});

// ---------------------------------------------------------------------------
// name fallback — unknown suggestedById falls back to the raw id string
// ---------------------------------------------------------------------------

describe("gameService.listSuggestions: name fallback for unknown suggester", () => {
  it("uses the raw suggestedById as suggestedByName when no player matches", async () => {
    const data = buildScenario({
      suggestions: [makeStored("sug-orphan", TEXT_NEW, ORPHAN_ID, T_NEW)],
    } as Partial<ServiceData>);
    const service = createMockGameService(data);

    const [entry] = await service.listSuggestions();

    expect(entry.suggestedByName).toBe(ORPHAN_ID);
  });
});

// ---------------------------------------------------------------------------
// empty / absent pool → []
// ---------------------------------------------------------------------------

describe("gameService.listSuggestions: empty pool", () => {
  it("returns [] when data.suggestions is an empty array", async () => {
    const data = buildScenario({
      suggestions: [],
    } as Partial<ServiceData>);
    const service = createMockGameService(data);

    const result = await service.listSuggestions();

    expect(result).toEqual([]);
  });

  it("returns [] when data.suggestions is absent entirely", async () => {
    const data = buildScenario(); // no `suggestions` field
    const service = createMockGameService(data);

    const result = await service.listSuggestions();

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// purity — does NOT mutate the stored suggestions array
// ---------------------------------------------------------------------------

describe("gameService.listSuggestions: is a pure read", () => {
  it("does NOT reorder / mutate data.suggestions (sort is on a copy)", async () => {
    const data = buildScenario({
      suggestions: seedOutOfOrder(), // seeded mid, new, old
    } as Partial<ServiceData>);
    const service = createMockGameService(data);

    await service.listSuggestions();

    const storedOrder = (
      (data as { suggestions?: StoredSuggestion[] }).suggestions ?? []
    ).map((s) => s.id);

    // The stored array retains its ORIGINAL insertion order untouched.
    expect(storedOrder).toEqual(["sug-mid", "sug-new", "sug-old"]);
  });
});
