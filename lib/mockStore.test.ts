import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getMockStore, MOCK_STORE_KEY } from "@/lib/mockStore";
import { createMockGameService } from "@/lib/services/gameService";
import { matchups as fixtureMatchups, type FixtureMatchup } from "@/lib/fixtures";
import type { AnswerSubmission } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test helpers / constants
// ---------------------------------------------------------------------------

/** Below this count a matchup still has a participant who must answer. */
const FULLY_ANSWERED = 2;

/** Cast helper for indexing the (loosely-typed) global object. */
const globalRecord = (): Record<string, unknown> =>
  globalThis as Record<string, unknown>;

/** Clears the shared store off globalThis so each test re-seeds in isolation. */
const clearStore = (): void => {
  delete globalRecord()[MOCK_STORE_KEY];
};

/** Builds a full answer set covering every question in the current week. */
const answerEveryQuestion = (
  questions: ReadonlyArray<{ id: string }>,
): AnswerSubmission[] =>
  questions.map((q) => ({ questionId: q.id, text: `ans-${q.id}` }));

// ---------------------------------------------------------------------------
// Isolation: the store lives on globalThis (shared within a Vitest worker),
// so wipe it before AND after every test to neither inherit nor leak state.
// ---------------------------------------------------------------------------

beforeEach(clearStore);
afterEach(clearStore);

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

describe("getMockStore: shape", () => {
  it("returns a store with players, currentWeek, matchups, byes and answer collections", () => {
    const store = getMockStore();

    expect(Array.isArray(store.players)).toBe(true);

    expect(store.currentWeek.id).toEqual(expect.any(String));
    expect(store.currentWeek.status).toEqual(expect.any(String));
    expect(Array.isArray(store.currentWeek.questions)).toBe(true);

    expect(Array.isArray(store.matchups)).toBe(true);
    expect(Array.isArray(store.byePlayerIds)).toBe(true);

    // Seeded from fixtures (slice 3): the pre-answered players have answers.
    expect(Array.isArray(store.answers)).toBe(true);
    expect(Array.isArray(store.answerOptions)).toBe(true);
    expect(Array.isArray(store.guesses)).toBe(true);
    expect(store.guesses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

describe("getMockStore: singleton", () => {
  it("returns the same reference on repeated calls", () => {
    expect(getMockStore()).toBe(getMockStore());
  });
});

// ---------------------------------------------------------------------------
// globalThis-cached (what lets separate module instances/layers share it)
// ---------------------------------------------------------------------------

describe("getMockStore: globalThis cache", () => {
  it("caches the store on globalThis under MOCK_STORE_KEY", () => {
    const store = getMockStore();

    expect(globalRecord()[MOCK_STORE_KEY]).toBeDefined();
    expect(globalRecord()[MOCK_STORE_KEY]).toBe(store);
  });
});

// ---------------------------------------------------------------------------
// Seeded from fixtures but isolated (deep copy — never mutates the consts)
// ---------------------------------------------------------------------------

describe("getMockStore: fixture isolation", () => {
  it("copies the fixtures rather than referencing them", () => {
    const store = getMockStore();

    expect(store.matchups).not.toBe(fixtureMatchups);
    expect(store.matchups[0]).not.toBe(fixtureMatchups[0]);
    expect(store.matchups[0]?.answeredBy).not.toBe(fixtureMatchups[0]?.answeredBy);
  });

  it("does not mutate the exported fixture arrays when the store is mutated", () => {
    const store = getMockStore();
    const fixtureAnsweredLenBefore = fixtureMatchups[0]?.answeredBy.length ?? 0;

    store.matchups[0]?.answeredBy.push("intruder");
    store.answers.push({
      id: "x",
      matchupId: "x",
      questionId: "x",
      playerId: "x",
      text: "x",
    });

    expect(fixtureMatchups[0]?.answeredBy.length).toBe(fixtureAnsweredLenBefore);
    expect(fixtureMatchups[0]?.answeredBy).not.toContain("intruder");
  });
});

// ---------------------------------------------------------------------------
// THE KEY REGRESSION — cross-layer sharing
//
// Models the two Next server bundles (the POST route and the page server
// component) as two independently-created services. Before the fix they hold
// separate store copies, so a submit on one is invisible to the other. After
// the fix both build from the one globalThis-backed store and stay in sync.
// ---------------------------------------------------------------------------

describe("getMockStore: cross-layer sharing", () => {
  it("makes a submit on one service visible to a separately-created service", async () => {
    const store = getMockStore();

    // Two layers, both built AFTER the reset from the freshly-seeded store.
    const routeLayer = createMockGameService(getMockStore());
    const pageLayer = createMockGameService(getMockStore());

    // Derive the player who still needs to answer (no hardcoded fixture ids).
    const pending = store.matchups.find(
      (m: FixtureMatchup) => m.answeredBy.length < FULLY_ANSWERED,
    );
    expect(pending).toBeDefined();
    const playerId =
      pending!.answeredBy.includes(pending!.playerAId)
        ? pending!.playerBId
        : pending!.playerAId;

    const answers = answerEveryQuestion(store.currentWeek.questions);

    // Before: the page layer sees the player as not yet submitted.
    expect((await pageLayer.getMyWeek(playerId)).myAnswersSubmitted).toBe(false);

    // The route layer records the submission against the shared store.
    await routeLayer.submitAnswers(playerId, store.currentWeek.id, answers);

    // After: the page layer — a different service — observes the change.
    expect((await pageLayer.getMyWeek(playerId)).myAnswersSubmitted).toBe(true);
  });
});
