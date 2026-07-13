import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearAnswerDraft,
  loadAnswerDraft,
  saveAnswerDraft,
} from "@/lib/services/answerDraftStore";

// ---------------------------------------------------------------------------
// Constants — no magic literals
// ---------------------------------------------------------------------------

/** Two distinct week identifiers, to prove drafts are week-scoped. */
const WEEK_A = "week-2026-25";
const WEEK_B = "week-2026-26";

/** An empty draft — the documented "nothing saved" result. */
const EMPTY_DRAFT: Record<string, string> = {};

/** A representative questionId -> answer-text map. */
const DRAFT_A: Record<string, string> = {
  q0: "answer for q0",
  q1: "answer for q1",
  q2: "answer for q2",
  q3: "answer for q3",
};

/** A different map, saved under a different week. */
const DRAFT_B: Record<string, string> = {
  q0: "week B answer 0",
  q1: "week B answer 1",
};

/** A value that is not valid JSON — used for the corruption robustness case. */
const CORRUPT_VALUE = "}{ this is not json ::";

// ---------------------------------------------------------------------------
// Setup — real jsdom localStorage, isolated per test
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  // Unstub globals FIRST: the "localStorage unavailable" tests replace
  // `localStorage` with `undefined`, so restoring the real jsdom storage before
  // calling clear() keeps teardown from throwing on an undefined global.
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// round-trip
// ---------------------------------------------------------------------------

describe("answerDraftStore: save then load round-trips", () => {
  it("returns the exact map that was saved for the same week", () => {
    saveAnswerDraft(WEEK_A, DRAFT_A);

    expect(loadAnswerDraft(WEEK_A)).toEqual(DRAFT_A);
  });

  it("overwrites a previously-saved draft for the same week", () => {
    saveAnswerDraft(WEEK_A, DRAFT_A);
    saveAnswerDraft(WEEK_A, DRAFT_B);

    expect(loadAnswerDraft(WEEK_A)).toEqual(DRAFT_B);
  });

  it("round-trips an empty map without throwing", () => {
    saveAnswerDraft(WEEK_A, EMPTY_DRAFT);

    expect(loadAnswerDraft(WEEK_A)).toEqual(EMPTY_DRAFT);
  });
});

// ---------------------------------------------------------------------------
// nothing saved
// ---------------------------------------------------------------------------

describe("answerDraftStore: load with no saved draft", () => {
  it("returns {} when nothing has ever been saved for that week", () => {
    expect(loadAnswerDraft(WEEK_A)).toEqual(EMPTY_DRAFT);
  });
});

// ---------------------------------------------------------------------------
// week-scoping
// ---------------------------------------------------------------------------

describe("answerDraftStore: drafts are week-scoped", () => {
  it("saving under week A does not populate the draft for week B", () => {
    saveAnswerDraft(WEEK_A, DRAFT_A);

    expect(loadAnswerDraft(WEEK_B)).toEqual(EMPTY_DRAFT);
  });

  it("keeps two weeks' drafts independent at the same time", () => {
    saveAnswerDraft(WEEK_A, DRAFT_A);
    saveAnswerDraft(WEEK_B, DRAFT_B);

    expect(loadAnswerDraft(WEEK_A)).toEqual(DRAFT_A);
    expect(loadAnswerDraft(WEEK_B)).toEqual(DRAFT_B);
  });
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe("answerDraftStore: clear", () => {
  it("removes the draft for that week (subsequent load returns {})", () => {
    saveAnswerDraft(WEEK_A, DRAFT_A);
    clearAnswerDraft(WEEK_A);

    expect(loadAnswerDraft(WEEK_A)).toEqual(EMPTY_DRAFT);
  });

  it("clears only the target week and leaves other weeks untouched", () => {
    saveAnswerDraft(WEEK_A, DRAFT_A);
    saveAnswerDraft(WEEK_B, DRAFT_B);

    clearAnswerDraft(WEEK_A);

    expect(loadAnswerDraft(WEEK_A)).toEqual(EMPTY_DRAFT);
    expect(loadAnswerDraft(WEEK_B)).toEqual(DRAFT_B);
  });

  it("is a no-op (does not throw) when there is nothing to clear", () => {
    expect(() => clearAnswerDraft(WEEK_A)).not.toThrow();
    expect(loadAnswerDraft(WEEK_A)).toEqual(EMPTY_DRAFT);
  });
});

// ---------------------------------------------------------------------------
// robustness — corrupt stored value
// ---------------------------------------------------------------------------

describe("answerDraftStore: corrupt stored value", () => {
  it("returns {} (never throws) when the stored value is not valid JSON", () => {
    // Force getItem to yield a non-JSON string regardless of the (private) key
    // the store uses, so the test does not couple to the key format.
    vi.spyOn(Storage.prototype, "getItem").mockReturnValue(CORRUPT_VALUE);

    expect(() => loadAnswerDraft(WEEK_A)).not.toThrow();
    expect(loadAnswerDraft(WEEK_A)).toEqual(EMPTY_DRAFT);
  });
});

// ---------------------------------------------------------------------------
// robustness — localStorage unavailable
// ---------------------------------------------------------------------------

describe("answerDraftStore: localStorage unavailable", () => {
  it("load returns {} when the global is removed", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(() => loadAnswerDraft(WEEK_A)).not.toThrow();
    expect(loadAnswerDraft(WEEK_A)).toEqual(EMPTY_DRAFT);
  });

  it("save and clear are no-ops (do not throw) when the global is removed", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(() => saveAnswerDraft(WEEK_A, DRAFT_A)).not.toThrow();
    expect(() => clearAnswerDraft(WEEK_A)).not.toThrow();
  });

  it("does not throw when localStorage exists but its methods throw", () => {
    // A hostile/quota-exhausted storage: every access throws. The store must
    // swallow it and degrade gracefully.
    const throwing = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
      removeItem: () => {
        throw new Error("storage disabled");
      },
    };
    vi.stubGlobal("localStorage", throwing);

    expect(() => saveAnswerDraft(WEEK_A, DRAFT_A)).not.toThrow();
    expect(() => clearAnswerDraft(WEEK_A)).not.toThrow();
    expect(loadAnswerDraft(WEEK_A)).toEqual(EMPTY_DRAFT);
  });
});
