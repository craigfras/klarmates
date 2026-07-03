/**
 * Tests for the player-facing suggestQuestion write path on GameService
 * (question-suggestions slice 1 — mock implementation).
 *
 * ============================================================
 * CONTRACT DECISIONS (code-writer must match exactly)
 * ============================================================
 *
 * 1. New view/store type in @/lib/types — `StoredSuggestion`:
 *
 *      export type StoredSuggestion = {
 *        id: string;
 *        text: string;
 *        suggestedById: string;
 *        createdAt: string; // ISO 8601
 *      };
 *
 * 2. GameServiceData shape extension — `suggestions`:
 *
 *      suggestions?: StoredSuggestion[];
 *
 *    A standing, week-agnostic pool of player-authored candidate questions.
 *    Optional so existing scenarios that omit it continue to compile and
 *    behave correctly. When absent, suggestQuestion lazily initialises it
 *    (`data.suggestions ??= []`).
 *
 * 3. New method on the GameService interface + createMockGameService:
 *
 *      suggestQuestion(playerId: string, text: string): Promise<void>
 *
 *    Behaviour:
 *      - Trim `text`. Throw (reject) on empty / whitespace-only text and
 *        make NO mutation in that case.
 *      - Otherwise APPEND exactly ONE entry to `data.suggestions`:
 *          {
 *            id:            <non-empty unique string>,
 *            text:          <the TRIMMED input>,
 *            suggestedById: <playerId>,
 *            createdAt:     <deps.now()>,   // injected clock, not Date.now()
 *          }
 *      - Two successive calls append two entries with DISTINCT non-empty ids.
 *        (Id format is an implementation detail — tests only pin uniqueness +
 *        non-empty string.)
 *      - Works anytime, independent of any draft / current-week state (append
 *        succeeds even with an empty / closed week scenario).
 *
 * ============================================================
 */

import { describe, it, expect } from "vitest";
import { createMockGameService } from "@/lib/services/gameService";
import type { Player, Question, StoredSuggestion, WeekStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Constants (no magic numbers)
// ---------------------------------------------------------------------------

/** A fixed ISO timestamp emitted by the injected `now` clock. */
const FIXED_NOW = "2026-07-02T12:00:00.000Z";

/** A distinct second timestamp for the two-call ordering scenario. */
const SECOND_NOW = "2026-07-02T12:05:00.000Z";

/** The id of the suggesting player. */
const SUGGESTER_ID = "player-ada";

/** Raw text with surrounding whitespace — trimming target. */
const PADDED_TEXT = "  hello  ";

/** The trimmed form of PADDED_TEXT. */
const TRIMMED_TEXT = "hello";

/** A plain valid suggestion body. */
const VALID_TEXT = "What is your favourite programming language?";

/** Number of suggestions expected after a single successful call. */
const ONE_SUGGESTION = 1;

/** Number of suggestions expected after two successful calls. */
const TWO_SUGGESTIONS = 2;

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
  text = `Question ${id}`,
): Question => ({
  id,
  orderIndex,
  text,
});

type ServiceData = Parameters<typeof createMockGameService>[0];

/**
 * Baseline scenario: a current open week and a small roster. Tests override
 * fields (e.g. `suggestions`, `currentWeek`) as needed.
 */
const buildScenario = (overrides: Partial<ServiceData> = {}): ServiceData => ({
  players: [makePlayer(SUGGESTER_ID), makePlayer("p2")],
  currentWeek: {
    id: "week-current",
    status: "open" as WeekStatus,
    questions: [makeQuestion("q1", 0)],
  },
  matchups: [],
  byePlayerIds: [],
  ...overrides,
});

/** Reads the suggestions array off the (mutated-in-place) data object. */
const readSuggestions = (data: ServiceData): StoredSuggestion[] =>
  ((data as { suggestions?: StoredSuggestion[] }).suggestions ?? []);

// ---------------------------------------------------------------------------
// interface
// ---------------------------------------------------------------------------

describe("gameService.suggestQuestion: interface", () => {
  it("exposes suggestQuestion on the service", () => {
    const service = createMockGameService(buildScenario());
    expect(typeof (service as unknown as { suggestQuestion: unknown }).suggestQuestion).toBe(
      "function",
    );
  });
});

// ---------------------------------------------------------------------------
// happy path — append one entry with the correct shape
// ---------------------------------------------------------------------------

describe("gameService.suggestQuestion: appends a well-formed entry", () => {
  it("appends exactly one entry when suggestions was initially undefined", async () => {
    const data = buildScenario(); // no `suggestions` field
    const service = createMockGameService(data, { now: () => FIXED_NOW });

    await service.suggestQuestion(SUGGESTER_ID, VALID_TEXT);

    expect(readSuggestions(data)).toHaveLength(ONE_SUGGESTION);
  });

  it("appends exactly one entry when suggestions was seeded as an empty array", async () => {
    const data = buildScenario({
      suggestions: [],
    } as Partial<ServiceData>);
    const service = createMockGameService(data, { now: () => FIXED_NOW });

    await service.suggestQuestion(SUGGESTER_ID, VALID_TEXT);

    expect(readSuggestions(data)).toHaveLength(ONE_SUGGESTION);
  });

  it("stores suggestedById equal to the playerId argument", async () => {
    const data = buildScenario();
    const service = createMockGameService(data, { now: () => FIXED_NOW });

    await service.suggestQuestion(SUGGESTER_ID, VALID_TEXT);

    expect(readSuggestions(data)[0].suggestedById).toBe(SUGGESTER_ID);
  });

  it("stores createdAt from the injected now() dependency", async () => {
    const data = buildScenario();
    const service = createMockGameService(data, { now: () => FIXED_NOW });

    await service.suggestQuestion(SUGGESTER_ID, VALID_TEXT);

    expect(readSuggestions(data)[0].createdAt).toBe(FIXED_NOW);
  });

  it("stores a non-empty string id", async () => {
    const data = buildScenario();
    const service = createMockGameService(data, { now: () => FIXED_NOW });

    await service.suggestQuestion(SUGGESTER_ID, VALID_TEXT);

    const { id } = readSuggestions(data)[0];
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("stores the text verbatim when it needs no trimming", async () => {
    const data = buildScenario();
    const service = createMockGameService(data, { now: () => FIXED_NOW });

    await service.suggestQuestion(SUGGESTER_ID, VALID_TEXT);

    expect(readSuggestions(data)[0].text).toBe(VALID_TEXT);
  });
});

// ---------------------------------------------------------------------------
// trimming
// ---------------------------------------------------------------------------

describe("gameService.suggestQuestion: trims surrounding whitespace", () => {
  it('stores "hello" (trimmed) when given "  hello  "', async () => {
    const data = buildScenario();
    const service = createMockGameService(data, { now: () => FIXED_NOW });

    await service.suggestQuestion(SUGGESTER_ID, PADDED_TEXT);

    expect(readSuggestions(data)[0].text).toBe(TRIMMED_TEXT);
  });
});

// ---------------------------------------------------------------------------
// two calls — distinct ids
// ---------------------------------------------------------------------------

describe("gameService.suggestQuestion: two successive calls", () => {
  it("appends two entries", async () => {
    const data = buildScenario();
    let clock = FIXED_NOW;
    const service = createMockGameService(data, { now: () => clock });

    await service.suggestQuestion(SUGGESTER_ID, "first question");
    clock = SECOND_NOW;
    await service.suggestQuestion(SUGGESTER_ID, "second question");

    expect(readSuggestions(data)).toHaveLength(TWO_SUGGESTIONS);
  });

  it("gives the two entries DISTINCT non-empty ids", async () => {
    const data = buildScenario();
    const service = createMockGameService(data, { now: () => FIXED_NOW });

    await service.suggestQuestion(SUGGESTER_ID, "first question");
    await service.suggestQuestion(SUGGESTER_ID, "second question");

    const [first, second] = readSuggestions(data);
    expect(first.id.length).toBeGreaterThan(0);
    expect(second.id.length).toBeGreaterThan(0);
    expect(first.id).not.toBe(second.id);
  });
});

// ---------------------------------------------------------------------------
// validation — empty / whitespace-only rejects with no mutation
// ---------------------------------------------------------------------------

describe("gameService.suggestQuestion: rejects empty text", () => {
  it("rejects on an empty string", async () => {
    const service = createMockGameService(buildScenario());

    await expect(service.suggestQuestion(SUGGESTER_ID, "")).rejects.toThrow();
  });

  it("does NOT append on an empty string", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await expect(service.suggestQuestion(SUGGESTER_ID, "")).rejects.toThrow();

    expect(readSuggestions(data)).toHaveLength(0);
  });

  it("rejects on a whitespace-only string", async () => {
    const service = createMockGameService(buildScenario());

    await expect(
      service.suggestQuestion(SUGGESTER_ID, "   "),
    ).rejects.toThrow();
  });

  it("does NOT append on a whitespace-only string", async () => {
    const data = buildScenario();
    const service = createMockGameService(data);

    await expect(
      service.suggestQuestion(SUGGESTER_ID, "   "),
    ).rejects.toThrow();

    expect(readSuggestions(data)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// week-agnostic — succeeds regardless of the current-week state
// ---------------------------------------------------------------------------

describe("gameService.suggestQuestion: week-agnostic", () => {
  it("appends even when the current week is closed with no questions", async () => {
    const data = buildScenario({
      currentWeek: {
        id: "week-closed",
        status: "closed" as WeekStatus,
        questions: [],
      },
    });
    const service = createMockGameService(data, { now: () => FIXED_NOW });

    await service.suggestQuestion(SUGGESTER_ID, VALID_TEXT);

    expect(readSuggestions(data)).toHaveLength(ONE_SUGGESTION);
    expect(readSuggestions(data)[0].text).toBe(VALID_TEXT);
  });
});
