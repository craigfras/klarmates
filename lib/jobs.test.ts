/**
 * Tests for the scheduled-job bodies + the pure `isOutstanding` predicate
 * (slice 13).
 *
 * CONTRACT (intended new exports from "@/lib/jobs"):
 *   - isOutstanding(view: MyWeekView): boolean
 *   - draftNextWeek(deps?): Promise<{ weekId: string; questionCount: number }>
 *   - sendEndOfWeekReminders(deps?): Promise<{ sent: number }>
 *   - closeOpenWeek(deps?): Promise<{ closed: boolean; weekId?: string }>
 *
 * Each job body takes an OPTIONAL `deps` object; the defaults wire the real DB
 * collaborators (build-verified, NOT unit-tested here). We test the
 * orchestration by INJECTING fake collaborators — mirroring how
 * lib/aiGenerators.test.ts / lib/notifications.test.ts inject fakes so no DB /
 * network is touched.
 *
 * Pre-implementation, "@/lib/jobs" does not exist — the import fails to
 * resolve, so every test fails for that reason until the module is written.
 */

import { describe, it, expect, vi } from "vitest";
import type { MyWeekView, Player, Question, Recap } from "@/lib/types";
import { UPCOMING_WEEK_ID } from "@/lib/types";
import {
  isOutstanding,
  draftNextWeek,
  sendEndOfWeekReminders,
  closeOpenWeek,
} from "@/lib/jobs";

// ---------------------------------------------------------------------------
// Constants (no magic numbers / repeated literals)
// ---------------------------------------------------------------------------

const CALLED_ONCE = 1;
const NEVER_CALLED = 0;

const DRAFT_QUESTION_COUNT = 4;
const CLOSABLE_WEEK_ID = "w1";

/** Result ranks used in the close-week fan-out fixture. */
const RANK_FIRST = 1;
const RANK_SECOND = 2;

/** Expected reminder-send counts for the two roster scenarios. */
const OUTSTANDING_SENT_COUNT = 2;
const NO_ONE_OUTSTANDING_SENT_COUNT = 0;

const RECAP: Recap = { meCorrect: 3, opponentCorrect: 2, questionCount: 4 };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Builds a MyWeekView with every required field populated to a "no work left"
 * baseline (open, not bye, answered, unlocked+complete → NOT outstanding).
 * Individual tests override just the fields under test.
 */
const makeView = (overrides: Partial<MyWeekView> = {}): MyWeekView => ({
  weekId: "week-current",
  startsAt: "2026-06-29T00:00:00.000Z",
  status: "open",
  opponent: null,
  isBye: false,
  questions: [],
  myAnswersSubmitted: true,
  opponentAnswered: true,
  guessingUnlocked: true,
  guessingComplete: true,
  myCorrectGuesses: 0,
  ...overrides,
});

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  id: "p1",
  name: "Ada",
  email: "ada@getklar.com",
  isAdmin: false,
  active: true,
  ...overrides,
});

const makeQuestion = (index: number): Question => ({
  id: `q${index}`,
  orderIndex: index,
  text: `Question ${index}?`,
});

// ===========================================================================
// isOutstanding — pure "does the player still have work THIS week?" predicate
// ===========================================================================

describe("jobs: isOutstanding", () => {
  it("is true when the week is open and the player has not submitted answers", () => {
    const view = makeView({
      myAnswersSubmitted: false,
      guessingUnlocked: false,
      guessingComplete: false,
    });

    expect(isOutstanding(view)).toBe(true);
  });

  it("is true when answered + guessing unlocked but guessing is incomplete", () => {
    const view = makeView({
      myAnswersSubmitted: true,
      guessingUnlocked: true,
      guessingComplete: false,
    });

    expect(isOutstanding(view)).toBe(true);
  });

  it("is false when answered + guessing unlocked + guessing complete", () => {
    const view = makeView({
      myAnswersSubmitted: true,
      guessingUnlocked: true,
      guessingComplete: true,
    });

    expect(isOutstanding(view)).toBe(false);
  });

  it("is false on a bye week (no work regardless of other flags)", () => {
    const view = makeView({
      isBye: true,
      myAnswersSubmitted: false,
      guessingUnlocked: false,
      guessingComplete: false,
    });

    expect(isOutstanding(view)).toBe(false);
  });

  it("is false when the week is not open (closed)", () => {
    const view = makeView({
      status: "closed",
      myAnswersSubmitted: false,
      guessingUnlocked: false,
      guessingComplete: false,
    });

    expect(isOutstanding(view)).toBe(false);
  });

  it("is false when the week is not open (awaiting_approval)", () => {
    const view = makeView({
      status: "awaiting_approval",
      myAnswersSubmitted: false,
      guessingUnlocked: false,
      guessingComplete: false,
    });

    expect(isOutstanding(view)).toBe(false);
  });

  it("is false when answered but guessing is NOT yet unlocked (waiting on opponent)", () => {
    const view = makeView({
      myAnswersSubmitted: true,
      guessingUnlocked: false,
      guessingComplete: false,
    });

    expect(isOutstanding(view)).toBe(false);
  });
});

// ===========================================================================
// draftNextWeek — draft questions for the upcoming week
// ===========================================================================

describe("jobs: draftNextWeek", () => {
  it("drafts for UPCOMING_WEEK_ID and reports the question count", async () => {
    const questions = Array.from({ length: DRAFT_QUESTION_COUNT }, (_unused, i) =>
      makeQuestion(i),
    );
    const getDraftQuestions = vi.fn().mockResolvedValue(questions);

    const result = await draftNextWeek({ getDraftQuestions });

    expect(getDraftQuestions).toHaveBeenCalledTimes(CALLED_ONCE);
    expect(getDraftQuestions).toHaveBeenCalledWith(UPCOMING_WEEK_ID);
    expect(result).toEqual({
      weekId: UPCOMING_WEEK_ID,
      questionCount: DRAFT_QUESTION_COUNT,
    });
  });
});

// ===========================================================================
// sendEndOfWeekReminders — notify only ACTIVE players with outstanding work
// ===========================================================================

describe("jobs: sendEndOfWeekReminders", () => {
  it("notifies exactly the active players whose week is outstanding", async () => {
    // p1: outstanding (unanswered) → notify
    // p2: complete → skip
    // p3: outstanding (unlocked+incomplete) → notify
    // p4: bye → skip
    const p1 = makePlayer({ id: "p1", name: "Ada" });
    const p2 = makePlayer({ id: "p2", name: "Bo" });
    const p3 = makePlayer({ id: "p3", name: "Cy" });
    const p4 = makePlayer({ id: "p4", name: "Di" });

    const viewsById: Record<string, MyWeekView> = {
      p1: makeView({
        myAnswersSubmitted: false,
        guessingUnlocked: false,
        guessingComplete: false,
      }),
      p2: makeView({ guessingComplete: true }),
      p3: makeView({ guessingUnlocked: true, guessingComplete: false }),
      p4: makeView({ isBye: true }),
    };

    const listRoster = vi.fn().mockResolvedValue([p1, p2, p3, p4]);
    const getMyWeek = vi.fn(async (playerId: string) => viewsById[playerId]);
    const notify = vi.fn(async (_player: Player) => undefined);

    const result = await sendEndOfWeekReminders({
      listRoster,
      getMyWeek,
      notify,
    });

    expect(notify).toHaveBeenCalledTimes(OUTSTANDING_SENT_COUNT);
    const notified = notify.mock.calls.map(([player]) => (player as Player).id);
    expect(notified).toContain("p1");
    expect(notified).toContain("p3");
    expect(notified).not.toContain("p2");
    expect(notified).not.toContain("p4");
    expect(result).toEqual({ sent: OUTSTANDING_SENT_COUNT });
  });

  it("notifies no one and returns { sent: 0 } when nobody is outstanding", async () => {
    const p1 = makePlayer({ id: "p1" });
    const p2 = makePlayer({ id: "p2" });

    const viewsById: Record<string, MyWeekView> = {
      p1: makeView({ guessingComplete: true }),
      p2: makeView({ isBye: true }),
    };

    const listRoster = vi.fn().mockResolvedValue([p1, p2]);
    const getMyWeek = vi.fn(async (playerId: string) => viewsById[playerId]);
    const notify = vi.fn(async (_player: Player) => undefined);

    const result = await sendEndOfWeekReminders({
      listRoster,
      getMyWeek,
      notify,
    });

    expect(notify).toHaveBeenCalledTimes(NEVER_CALLED);
    expect(result).toEqual({ sent: NO_ONE_OUTSTANDING_SENT_COUNT });
  });
});

// ===========================================================================
// closeOpenWeek — close a closable week + DM results; guard on the null path
// ===========================================================================

describe("jobs: closeOpenWeek", () => {
  it("does nothing and reports not-closed when there is no closable week", async () => {
    const findClosableWeekId = vi.fn().mockResolvedValue(null);
    const close = vi.fn(async () => undefined);
    const getResults = vi.fn(async () => []);
    const notifyResult = vi.fn(async () => undefined);

    const result = await closeOpenWeek({
      findClosableWeekId,
      close,
      getResults,
      notifyResult,
    });

    // The null guard is the "no double-close / no double-DM" contract.
    expect(close).toHaveBeenCalledTimes(NEVER_CALLED);
    expect(getResults).toHaveBeenCalledTimes(NEVER_CALLED);
    expect(notifyResult).toHaveBeenCalledTimes(NEVER_CALLED);
    expect(result).toEqual({ closed: false });
  });

  it("closes the week once and DMs each result with the right args", async () => {
    const alice = makePlayer({ id: "alice", name: "Alice" });
    const bob = makePlayer({ id: "bob", name: "Bob" });

    const results = [
      { player: alice, recap: RECAP, rank: RANK_FIRST },
      { player: bob, recap: RECAP, rank: RANK_SECOND },
    ];

    const findClosableWeekId = vi.fn().mockResolvedValue(CLOSABLE_WEEK_ID);
    const close = vi.fn(async () => undefined);
    const getResults = vi.fn().mockResolvedValue(results);
    const notifyResult = vi.fn(async () => undefined);

    const result = await closeOpenWeek({
      findClosableWeekId,
      close,
      getResults,
      notifyResult,
    });

    // Closed exactly once, for the resolved week id.
    expect(close).toHaveBeenCalledTimes(CALLED_ONCE);
    expect(close).toHaveBeenCalledWith(CLOSABLE_WEEK_ID);

    // One DM per result, each with its (player, recap, rank).
    expect(notifyResult).toHaveBeenCalledTimes(results.length);
    expect(notifyResult).toHaveBeenCalledWith(alice, RECAP, RANK_FIRST);
    expect(notifyResult).toHaveBeenCalledWith(bob, RECAP, RANK_SECOND);

    expect(result).toEqual({ closed: true, weekId: CLOSABLE_WEEK_ID });
  });
});
