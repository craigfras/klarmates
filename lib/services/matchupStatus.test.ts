import { describe, it, expect } from "vitest";

import { getMatchupStatus } from "@/lib/services/matchupStatus";
import type { MyWeekView } from "@/lib/types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Builds a coherent default MyWeekView representing an OPEN, non-bye week where
 * nothing has been submitted yet. Each test overrides only the fields relevant
 * to the branch under test.
 */
function makeView(overrides: Partial<MyWeekView> = {}): MyWeekView {
  return {
    weekId: "week-1",
    startsAt: "2026-06-22T00:00:00.000Z",
    status: "open",
    opponent: {
      id: "p-2",
      name: "Opponent",
      email: "opp@example.com",
      isAdmin: false,
      active: true,
    },
    isBye: false,
    questions: [],
    myAnswersSubmitted: false,
    opponentAnswered: false,
    guessingUnlocked: false,
    guessingComplete: false,
    myCorrectGuesses: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Branch coverage
// ---------------------------------------------------------------------------

describe("getMatchupStatus", () => {
  it('returns "bye" when isBye is true', () => {
    expect(getMatchupStatus(makeView({ isBye: true }))).toBe("bye");
  });

  it('returns "recap" when the week is closed (not bye)', () => {
    expect(getMatchupStatus(makeView({ status: "closed" }))).toBe("recap");
  });

  it('returns "answer_needed" when my answers are not submitted (open, not bye)', () => {
    expect(
      getMatchupStatus(makeView({ myAnswersSubmitted: false })),
    ).toBe("answer_needed");
  });

  it('returns "waiting_opponent" when I have answered but the opponent has not', () => {
    expect(
      getMatchupStatus(
        makeView({ myAnswersSubmitted: true, opponentAnswered: false }),
      ),
    ).toBe("waiting_opponent");
  });

  it('returns "guessing_unlocked" when both have answered and the week is open', () => {
    expect(
      getMatchupStatus(
        makeView({
          myAnswersSubmitted: true,
          opponentAnswered: true,
          guessingUnlocked: true,
        }),
      ),
    ).toBe("guessing_unlocked");
  });

  // -------------------------------------------------------------------------
  // Guessing complete
  // -------------------------------------------------------------------------

  it('returns "guessing_unlocked" when unlocked but NOT every question guessed', () => {
    expect(
      getMatchupStatus(
        makeView({
          myAnswersSubmitted: true,
          opponentAnswered: true,
          guessingUnlocked: true,
          guessingComplete: false,
        }),
      ),
    ).toBe("guessing_unlocked");
  });

  it('returns "guessing_complete" when unlocked AND every question has been guessed', () => {
    expect(
      getMatchupStatus(
        makeView({
          myAnswersSubmitted: true,
          opponentAnswered: true,
          guessingUnlocked: true,
          guessingComplete: true,
        }),
      ),
    ).toBe("guessing_complete");
  });

  // -------------------------------------------------------------------------
  // Precedence edges
  // -------------------------------------------------------------------------

  it('bye wins over closed (isBye + status closed -> "bye")', () => {
    expect(
      getMatchupStatus(makeView({ isBye: true, status: "closed" })),
    ).toBe("bye");
  });

  it('bye wins even when answers are submitted and guessing unlocked', () => {
    expect(
      getMatchupStatus(
        makeView({
          isBye: true,
          myAnswersSubmitted: true,
          opponentAnswered: true,
          guessingUnlocked: true,
        }),
      ),
    ).toBe("bye");
  });

  it('closed beats answer_needed (closed + nothing submitted -> "recap")', () => {
    expect(
      getMatchupStatus(
        makeView({ status: "closed", myAnswersSubmitted: false }),
      ),
    ).toBe("recap");
  });

  it('closed beats waiting_opponent (closed + my answers submitted -> "recap")', () => {
    expect(
      getMatchupStatus(
        makeView({
          status: "closed",
          myAnswersSubmitted: true,
          opponentAnswered: false,
        }),
      ),
    ).toBe("recap");
  });

  it('closed beats guessing_unlocked (closed + both answered -> "recap")', () => {
    expect(
      getMatchupStatus(
        makeView({
          status: "closed",
          myAnswersSubmitted: true,
          opponentAnswered: true,
          guessingUnlocked: true,
        }),
      ),
    ).toBe("recap");
  });

  it('closed beats guessing_complete (closed + guessingComplete -> "recap")', () => {
    expect(
      getMatchupStatus(
        makeView({
          status: "closed",
          myAnswersSubmitted: true,
          opponentAnswered: true,
          guessingUnlocked: true,
          guessingComplete: true,
        }),
      ),
    ).toBe("recap");
  });

  it('answer_needed beats waiting_opponent when my answers are missing even if opponent answered', () => {
    expect(
      getMatchupStatus(
        makeView({ myAnswersSubmitted: false, opponentAnswered: true }),
      ),
    ).toBe("answer_needed");
  });

  // -------------------------------------------------------------------------
  // Sanity: guessing_unlocked aligns with the view's guessingUnlocked flag
  // -------------------------------------------------------------------------

  it('guessing_unlocked result is consistent with view.guessingUnlocked === true', () => {
    const view = makeView({
      myAnswersSubmitted: true,
      opponentAnswered: true,
      guessingUnlocked: true,
    });

    expect(getMatchupStatus(view)).toBe("guessing_unlocked");
    expect(view.guessingUnlocked).toBe(true);
  });
});
