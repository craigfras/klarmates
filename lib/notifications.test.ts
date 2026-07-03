/**
 * Tests for the slice 12 Slack DM notification builders + dispatch.
 *
 * CONTRACT (intended new exports from "@/lib/notifications"):
 *   Pure builders (each returns a SlackMessage):
 *     - buildNewWeekMessage(playerName: string, weekLink: string): SlackMessage
 *     - buildGuessingUnlockedMessage(playerName: string): SlackMessage
 *     - buildEndOfWeekReminderMessage(playerName: string): SlackMessage
 *     - buildWeeklyResultsMessage(playerName, recap, rank): SlackMessage
 *   Notify dispatchers (injectable `sendDm` seam, defaults to the real `dm`):
 *     - notifyNewWeek(player, weekLink, sendDm?)
 *     - notifyGuessingUnlocked(player, sendDm?)
 *     - notifyEndOfWeekReminder(player, sendDm?)
 *     - notifyWeeklyResults(player, recap, rank, sendDm?)
 *
 * The real Slack network call is HITL-verified; the dispatch logic is tested by
 * injecting a fake `SlackDm` sender (mirrors how lib/ai generators inject a
 * fake `complete`). Notify functions NO-OP (do not call the sender) when the
 * player has no slackUserId.
 */

import { describe, it, expect, vi } from "vitest";
import type { Player, Recap } from "@/lib/types";
import type { SlackDm, SlackMessage } from "@/lib/slack";
import {
  buildNewWeekMessage,
  buildGuessingUnlockedMessage,
  buildEndOfWeekReminderMessage,
  buildWeeklyResultsMessage,
  buildOpponentFinishedMessage,
  buildGuessingCompleteMessage,
  notifyNewWeek,
  notifyGuessingUnlocked,
  notifyEndOfWeekReminder,
  notifyWeeklyResults,
  notifyOpponentFinished,
  notifyGuessingComplete,
  notifyWeekOpened,
  notifyGuessingUnlockedAll,
} from "@/lib/notifications";

// ---------------------------------------------------------------------------
// Constants (no magic numbers / repeated strings)
// ---------------------------------------------------------------------------

const PLAYER_NAME = "Ada";
const WEEK_LINK = "https://app/guess";
const SLACK_USER_ID = "U123";

/** Branding copy: the new brand should be present, the old one gone. */
const KLARMATES_BRAND = "Klarmates";
const OLD_BRAND = "Engineer Guessing Game";

/** Recipient/finisher names for the opponent-finished nudge. */
const RECIPIENT_NAME = "Bo";
const FINISHER_NAME = "Ada";

/** Guesser + score fixture for the guessing-complete nudge. */
const GUESSER_NAME = "Alex";
const CORRECT_COUNT = 3;
const QUESTION_COUNT = 4;

/** Expected dispatch cardinalities. */
const CALLED_ONCE = 1;
const NEVER_CALLED = 0;

/** A representative weekly recap + leaderboard rank for the results message. */
const RECAP: Recap = { meCorrect: 3, opponentCorrect: 2, questionCount: 4 };
const RANK = 5;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  id: "p1",
  name: PLAYER_NAME,
  email: "ada@getklar.com",
  isAdmin: false,
  active: true,
  ...overrides,
});

/** A vi.fn() typed to the SlackDm signature so injection is type-checked. */
const makeSender = (): SlackDm => vi.fn(async () => undefined) as unknown as SlackDm;

/** Case-insensitive substring helper for resilient content assertions. */
const includesCI = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());

// ---------------------------------------------------------------------------
// buildNewWeekMessage
// ---------------------------------------------------------------------------

describe("notifications: buildNewWeekMessage", () => {
  it("produces non-empty text containing the week link and a new-week answer prompt", () => {
    const message = buildNewWeekMessage(PLAYER_NAME, WEEK_LINK);

    expect(message.text.trim().length).toBeGreaterThan(0);
    expect(message.text).toContain(WEEK_LINK);
    expect(
      includesCI(message.text, "week") || includesCI(message.text, "answer"),
    ).toBe(true);
  });

  it("is rebranded to Klarmates and no longer mentions the Engineer Guessing Game", () => {
    const message = buildNewWeekMessage(PLAYER_NAME, WEEK_LINK);

    // New branding present (case-insensitive).
    expect(includesCI(message.text, KLARMATES_BRAND)).toBe(true);
    // Old branding gone (case-insensitive).
    expect(includesCI(message.text, OLD_BRAND)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildGuessingUnlockedMessage
// ---------------------------------------------------------------------------

describe("notifications: buildGuessingUnlockedMessage", () => {
  it("produces non-empty text conveying guessing is unlocked / open", () => {
    const message = buildGuessingUnlockedMessage(PLAYER_NAME);

    expect(message.text.trim().length).toBeGreaterThan(0);
    expect(
      includesCI(message.text, "guess") &&
        (includesCI(message.text, "unlock") || includesCI(message.text, "open")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildEndOfWeekReminderMessage
// ---------------------------------------------------------------------------

describe("notifications: buildEndOfWeekReminderMessage", () => {
  it("produces non-empty text conveying a reminder to finish / outstanding work", () => {
    const message = buildEndOfWeekReminderMessage(PLAYER_NAME);

    expect(message.text.trim().length).toBeGreaterThan(0);
    expect(
      includesCI(message.text, "reminder") ||
        includesCI(message.text, "outstanding") ||
        includesCI(message.text, "finish") ||
        includesCI(message.text, "don't forget") ||
        includesCI(message.text, "dont forget"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildWeeklyResultsMessage
// ---------------------------------------------------------------------------

describe("notifications: buildWeeklyResultsMessage", () => {
  it("produces non-empty text containing the score numbers and the rank, reading like results", () => {
    const message = buildWeeklyResultsMessage(PLAYER_NAME, RECAP, RANK);

    expect(message.text.trim().length).toBeGreaterThan(0);
    // meCorrect (3) and questionCount (4) surfaced as the score.
    expect(message.text).toContain(String(RECAP.meCorrect));
    expect(message.text).toContain(String(RECAP.questionCount));
    // The leaderboard rank (5) surfaced.
    expect(message.text).toContain(String(RANK));
    expect(
      includesCI(message.text, "result") ||
        includesCI(message.text, "score") ||
        includesCI(message.text, "rank"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Notify dispatch — player HAS a slackUserId → sender called once
// ---------------------------------------------------------------------------

describe("notifications: notify* dispatch with a slack-linked player", () => {
  it("notifyNewWeek sends the new-week message to the player's slack id exactly once", async () => {
    const player = makePlayer({ slackUserId: SLACK_USER_ID });
    const sender = makeSender();

    await notifyNewWeek(player, WEEK_LINK, sender);

    expect(sender).toHaveBeenCalledTimes(CALLED_ONCE);
    const [userId, message] = (sender as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, SlackMessage];
    expect(userId).toBe(SLACK_USER_ID);
    expect(message.text).toBe(buildNewWeekMessage(player.name, WEEK_LINK).text);
  });

  it("notifyGuessingUnlocked sends the unlocked message to the player's slack id exactly once", async () => {
    const player = makePlayer({ slackUserId: SLACK_USER_ID });
    const sender = makeSender();

    await notifyGuessingUnlocked(player, sender);

    expect(sender).toHaveBeenCalledTimes(CALLED_ONCE);
    const [userId, message] = (sender as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, SlackMessage];
    expect(userId).toBe(SLACK_USER_ID);
    expect(message.text).toBe(buildGuessingUnlockedMessage(player.name).text);
  });

  it("notifyEndOfWeekReminder sends the reminder message to the player's slack id exactly once", async () => {
    const player = makePlayer({ slackUserId: SLACK_USER_ID });
    const sender = makeSender();

    await notifyEndOfWeekReminder(player, sender);

    expect(sender).toHaveBeenCalledTimes(CALLED_ONCE);
    const [userId, message] = (sender as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, SlackMessage];
    expect(userId).toBe(SLACK_USER_ID);
    expect(message.text).toBe(buildEndOfWeekReminderMessage(player.name).text);
  });

  it("notifyWeeklyResults sends the results message to the player's slack id exactly once", async () => {
    const player = makePlayer({ slackUserId: SLACK_USER_ID });
    const sender = makeSender();

    await notifyWeeklyResults(player, RECAP, RANK, sender);

    expect(sender).toHaveBeenCalledTimes(CALLED_ONCE);
    const [userId, message] = (sender as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, SlackMessage];
    expect(userId).toBe(SLACK_USER_ID);
    expect(message.text).toBe(
      buildWeeklyResultsMessage(player.name, RECAP, RANK).text,
    );
  });
});

// ---------------------------------------------------------------------------
// Notify dispatch — player has NO slackUserId → NO-OP, never calls sender
// ---------------------------------------------------------------------------

describe("notifications: notify* NO-OP when the player is not slack-linked", () => {
  it("notifyNewWeek does not call the sender when slackUserId is undefined and resolves", async () => {
    const player = makePlayer({ slackUserId: undefined });
    const sender = makeSender();

    await expect(notifyNewWeek(player, WEEK_LINK, sender)).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(NEVER_CALLED);
  });

  it("notifyNewWeek does not call the sender when slackUserId is empty string and resolves", async () => {
    const player = makePlayer({ slackUserId: "" });
    const sender = makeSender();

    await expect(notifyNewWeek(player, WEEK_LINK, sender)).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(NEVER_CALLED);
  });

  it("notifyWeeklyResults does not call the sender when slackUserId is undefined and resolves", async () => {
    const player = makePlayer({ slackUserId: undefined });
    const sender = makeSender();

    await expect(
      notifyWeeklyResults(player, RECAP, RANK, sender),
    ).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(NEVER_CALLED);
  });

  it("notifyGuessingUnlocked does not call the sender when slackUserId is empty string and resolves", async () => {
    const player = makePlayer({ slackUserId: "" });
    const sender = makeSender();

    await expect(
      notifyGuessingUnlocked(player, sender),
    ).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(NEVER_CALLED);
  });
});

// ---------------------------------------------------------------------------
// notifyWeekOpened — fan-out across a roster, skipping unlinked players
// ---------------------------------------------------------------------------
//
// CONTRACT (intended new export from "@/lib/notifications"):
//   notifyWeekOpened(
//     players: Player[],
//     weekLink: string,
//     sendDm: SlackDm = dm,
//   ): Promise<void>
//
// Sends the new-week message (notifyNewWeek) to each player. Players without a
// slackUserId are SKIPPED (no send); each slack-linked player gets exactly one
// DM whose text contains the weekLink. The sender is injectable so the fan-out
// is unit-testable without the network.
// ---------------------------------------------------------------------------

/** Slack ids for the linked fixtures in the mixed-roster scenario. */
const SLACK_ID_A = "U-AAA";
const SLACK_ID_B = "U-BBB";

/** Exact number of slack-linked players in the mixed-roster fixture below. */
const LINKED_PLAYER_COUNT = 2;

describe("notifications: notifyWeekOpened fans out to slack-linked players only", () => {
  it("calls the sender once per slack-linked player and skips the unlinked ones", async () => {
    // Two linked players + two unlinked (undefined / empty-string) players.
    const players: Player[] = [
      makePlayer({ id: "p1", name: "Ada", slackUserId: SLACK_ID_A }),
      makePlayer({ id: "p2", name: "Bo", slackUserId: undefined }),
      makePlayer({ id: "p3", name: "Cy", slackUserId: SLACK_ID_B }),
      makePlayer({ id: "p4", name: "Di", slackUserId: "" }),
    ];
    const sender = makeSender();

    await notifyWeekOpened(players, WEEK_LINK, sender);

    // Exactly one send per LINKED player; the two unlinked ones never send.
    expect(sender).toHaveBeenCalledTimes(LINKED_PLAYER_COUNT);

    const calls = (sender as unknown as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      SlackMessage,
    ][];
    const targetedIds = calls.map(([userId]) => userId);
    expect(targetedIds).toContain(SLACK_ID_A);
    expect(targetedIds).toContain(SLACK_ID_B);

    // The week link appears in every sent message's text.
    for (const [, message] of calls) {
      expect(message.text).toContain(WEEK_LINK);
    }
  });

  it("resolves without throwing and never calls the sender for an empty roster", async () => {
    const sender = makeSender();

    await expect(notifyWeekOpened([], WEEK_LINK, sender)).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(NEVER_CALLED);
  });
});

// ---------------------------------------------------------------------------
// buildOpponentFinishedMessage — opponent-finished nudge (message 1)
// ---------------------------------------------------------------------------
//
// CONTRACT (intended new export from "@/lib/notifications"):
//   buildOpponentFinishedMessage(
//     recipientName: string,
//     finisherName: string,
//   ): SlackMessage
//
// Tells the RECIPIENT (the player who has NOT answered yet) that their opponent
// (finisherName) has finished answering and it's now their turn.
// ---------------------------------------------------------------------------

describe("notifications: buildOpponentFinishedMessage", () => {
  it("names the finisher and conveys they finished plus a your-turn / unlock cue", () => {
    const message = buildOpponentFinishedMessage(RECIPIENT_NAME, FINISHER_NAME);

    expect(message.text.trim().length).toBeGreaterThan(0);
    // The opponent who finished is named.
    expect(message.text).toContain(FINISHER_NAME);
    // Conveys "finished" AND a your-turn / unlock cue.
    expect(includesCI(message.text, "finished")).toBe(true);
    expect(
      includesCI(message.text, "you're up") ||
        includesCI(message.text, "your turn") ||
        includesCI(message.text, "unlock"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// notifyOpponentFinished — dispatch of the opponent-finished nudge
// ---------------------------------------------------------------------------
//
// CONTRACT (intended new export from "@/lib/notifications"):
//   notifyOpponentFinished(
//     recipient: Player,
//     finisherName: string,
//     sendDm: SlackDm = dm,
//   ): Promise<void>
//
// Sends the built opponent-finished message to the RECIPIENT's slack id exactly
// once; NO-OPS (never calls the sender) when the recipient has no slackUserId.
// ---------------------------------------------------------------------------

describe("notifications: notifyOpponentFinished dispatch", () => {
  it("sends the opponent-finished message to the recipient's slack id exactly once", async () => {
    const recipient = makePlayer({
      name: RECIPIENT_NAME,
      slackUserId: SLACK_USER_ID,
    });
    const sender = makeSender();

    await notifyOpponentFinished(recipient, FINISHER_NAME, sender);

    expect(sender).toHaveBeenCalledTimes(CALLED_ONCE);
    const [userId, message] = (sender as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, SlackMessage];
    expect(userId).toBe(SLACK_USER_ID);
    expect(message.text).toBe(
      buildOpponentFinishedMessage(recipient.name, FINISHER_NAME).text,
    );
  });

  it("does not call the sender when the recipient's slackUserId is undefined and resolves", async () => {
    const recipient = makePlayer({
      name: RECIPIENT_NAME,
      slackUserId: undefined,
    });
    const sender = makeSender();

    await expect(
      notifyOpponentFinished(recipient, FINISHER_NAME, sender),
    ).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(NEVER_CALLED);
  });

  it("does not call the sender when the recipient's slackUserId is empty string and resolves", async () => {
    const recipient = makePlayer({ name: RECIPIENT_NAME, slackUserId: "" });
    const sender = makeSender();

    await expect(
      notifyOpponentFinished(recipient, FINISHER_NAME, sender),
    ).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(NEVER_CALLED);
  });
});

// ---------------------------------------------------------------------------
// notifyGuessingUnlockedAll — fan-out of the guessing-unlocked DM (message 2)
// ---------------------------------------------------------------------------
//
// CONTRACT (intended new export from "@/lib/notifications"):
//   notifyGuessingUnlockedAll(
//     players: Player[],
//     sendDm: SlackDm = dm,
//   ): Promise<void>
//
// DMs each slack-linked player the buildGuessingUnlockedMessage(player.name)
// message (delegating to the same guarded dispatch as notifyGuessingUnlocked).
// Unlinked players are SKIPPED; resolves without throwing on an empty roster.
// Mirrors the notifyWeekOpened fan-out tests.
// ---------------------------------------------------------------------------

describe("notifications: notifyGuessingUnlockedAll fans out to slack-linked players only", () => {
  it("calls the sender once per slack-linked player and skips the unlinked ones", async () => {
    // Two linked players + two unlinked (undefined / empty-string) players.
    const players: Player[] = [
      makePlayer({ id: "p1", name: "Ada", slackUserId: SLACK_ID_A }),
      makePlayer({ id: "p2", name: "Bo", slackUserId: undefined }),
      makePlayer({ id: "p3", name: "Cy", slackUserId: SLACK_ID_B }),
      makePlayer({ id: "p4", name: "Di", slackUserId: "" }),
    ];
    const sender = makeSender();

    await notifyGuessingUnlockedAll(players, sender);

    // Exactly one send per LINKED player; the two unlinked ones never send.
    expect(sender).toHaveBeenCalledTimes(LINKED_PLAYER_COUNT);

    const calls = (sender as unknown as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      SlackMessage,
    ][];
    const targetedIds = calls.map(([userId]) => userId);
    expect(targetedIds).toContain(SLACK_ID_A);
    expect(targetedIds).toContain(SLACK_ID_B);

    // Every sent message conveys that guessing is unlocked / open.
    for (const [, message] of calls) {
      expect(
        includesCI(message.text, "guess") &&
          (includesCI(message.text, "unlock") ||
            includesCI(message.text, "open")),
      ).toBe(true);
    }
  });

  it("resolves without throwing and never calls the sender for an empty roster", async () => {
    const sender = makeSender();

    await expect(
      notifyGuessingUnlockedAll([], sender),
    ).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(NEVER_CALLED);
  });
});

// ---------------------------------------------------------------------------
// buildGuessingCompleteMessage — guessing-complete score nudge (message 3)
// ---------------------------------------------------------------------------
//
// CONTRACT (intended new export from "@/lib/notifications"):
//   buildGuessingCompleteMessage(
//     recipientName: string,
//     guesserName: string,
//     correctCount: number,
//     questionCount: number,
//   ): SlackMessage
//
// Tells the RECIPIENT (the player whose answers were guessed) that guesserName
// has finished guessing their answers and reports the score as
// correctCount of questionCount correct. Mirrors the Klarmates-branded
// "Hi {recipientName}, ..." style of the other builders.
// ---------------------------------------------------------------------------

describe("notifications: buildGuessingCompleteMessage", () => {
  it("addresses the recipient, names the guesser, and reports the score, reading like a finished-guessing nudge", () => {
    const message = buildGuessingCompleteMessage(
      RECIPIENT_NAME,
      GUESSER_NAME,
      CORRECT_COUNT,
      QUESTION_COUNT,
    );

    // Non-empty text greeting the recipient by name.
    expect(message.text.trim().length).toBeGreaterThan(0);
    expect(message.text).toContain(RECIPIENT_NAME);

    // Names the guesser who finished.
    expect(message.text).toContain(GUESSER_NAME);

    // Surfaces the score: correctCount of questionCount.
    expect(message.text).toContain(String(CORRECT_COUNT));
    expect(message.text).toContain(String(QUESTION_COUNT));

    // Conveys "finished" AND "guess" (case-insensitive).
    expect(includesCI(message.text, "finished")).toBe(true);
    expect(includesCI(message.text, "guess")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// notifyGuessingComplete — dispatch of the guessing-complete score nudge
// ---------------------------------------------------------------------------
//
// CONTRACT (intended new export from "@/lib/notifications"):
//   notifyGuessingComplete(
//     recipient: Player,
//     guesserName: string,
//     correctCount: number,
//     questionCount: number,
//     sendDm: SlackDm = dm,
//   ): Promise<void>
//
// Sends the built guessing-complete message to the RECIPIENT's slack id exactly
// once; NO-OPS (never calls the sender) when the recipient has no slackUserId.
// Mirrors the notifyOpponentFinished dispatch tests.
// ---------------------------------------------------------------------------

describe("notifications: notifyGuessingComplete dispatch", () => {
  it("sends the guessing-complete message to the recipient's slack id exactly once", async () => {
    const recipient = makePlayer({
      name: RECIPIENT_NAME,
      slackUserId: SLACK_USER_ID,
    });
    const sender = makeSender();

    await notifyGuessingComplete(
      recipient,
      GUESSER_NAME,
      CORRECT_COUNT,
      QUESTION_COUNT,
      sender,
    );

    expect(sender).toHaveBeenCalledTimes(CALLED_ONCE);
    const [userId, message] = (sender as unknown as ReturnType<typeof vi.fn>)
      .mock.calls[0] as [string, SlackMessage];
    expect(userId).toBe(SLACK_USER_ID);
    expect(message.text).toBe(
      buildGuessingCompleteMessage(
        recipient.name,
        GUESSER_NAME,
        CORRECT_COUNT,
        QUESTION_COUNT,
      ).text,
    );
  });

  it("does not call the sender when the recipient's slackUserId is undefined and resolves", async () => {
    const recipient = makePlayer({
      name: RECIPIENT_NAME,
      slackUserId: undefined,
    });
    const sender = makeSender();

    await expect(
      notifyGuessingComplete(
        recipient,
        GUESSER_NAME,
        CORRECT_COUNT,
        QUESTION_COUNT,
        sender,
      ),
    ).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(NEVER_CALLED);
  });

  it("does not call the sender when the recipient's slackUserId is empty string and resolves", async () => {
    const recipient = makePlayer({ name: RECIPIENT_NAME, slackUserId: "" });
    const sender = makeSender();

    await expect(
      notifyGuessingComplete(
        recipient,
        GUESSER_NAME,
        CORRECT_COUNT,
        QUESTION_COUNT,
        sender,
      ),
    ).resolves.toBeUndefined();
    expect(sender).toHaveBeenCalledTimes(NEVER_CALLED);
  });
});
